const RLM = '‏';

/** Closing tags and whitespace at the end of a line (e.g. `</i>`, `</font>`). */
const TRAILING_TAGS = /((?:<\/[a-z][a-z0-9]*>|\s)*)$/i;

const HEBREW_OR_ARABIC = /[֐-ۿ]/;
/** A run of English words (letters, digits, inner ' . -) joined by single spaces. */
const LATIN_RUN = /[A-Za-z][A-Za-z0-9'’.-]*(?: [A-Za-z0-9][A-Za-z0-9'’.-]*)*/g;

/**
 * In a Hebrew/Arabic line, puts an RLM on both sides of every English run (outside tags), so the
 * punctuation and numbers next to an English term resolve as right-to-left and stay where they
 * belong ("50 HP," not "HP, 50"). A line with no Hebrew/Arabic, and the tags themselves, are left alone.
 */
function markLatinRuns(line: string): string {
  if (!HEBREW_OR_ARABIC.test(line)) return line;
  return line
    .split(/(<[^>]*>)/)
    .map((part) =>
      part.startsWith('<')
        ? part
        : part.replace(LATIN_RUN, (run, offset: number, whole: string) => {
            const trimmed = run.replace(/[.'’-]+$/, '');
            const rest = run.slice(trimmed.length);
            const before = offset > 0 && whole[offset - 1] === RLM ? '' : RLM;
            const after = whole[offset + run.length] === RLM ? '' : RLM;
            return `${before}${trimmed}${after}${rest}`;
          }),
    )
    .join('');
}

/**
 * Optional RTL punctuation fix (config RTL_FIX), applied to every non-empty line separately.
 *
 * Players that lay a subtitle out with a left-to-right base direction place neutral characters
 * (. , ? ! : ... quotes, brackets, dashes) next to the wrong end of a Hebrew/Arabic line. Each line
 * gets a Right-to-Left Mark:
 *  - at the start, so a leading dash/quote stays on the right-hand side, and
 *  - at the end (before any closing tags such as `</i>`, whose letters are left-to-right and would
 *    otherwise pull the punctuation), so terminal punctuation is resolved as right-to-left text and
 *    is drawn on the left end of the line.
 * Doing this per line (not once per cue) keeps the second line of a two-line subtitle from
 * misbehaving. Empty lines are left alone and the function is idempotent.
 */
function fixLine(line: string): string {
  if (line.trim() === '') return line;
  let out = markLatinRuns(line);
  if (!out.startsWith(RLM)) out = RLM + out;
  const tail = TRAILING_TAGS.exec(out);
  const tagStart = tail ? out.length - tail[0].length : out.length;
  // Trailing whitespace is only layout noise; put the mark right after the last real character.
  const trimmedHead = out.slice(0, tagStart);
  if (!trimmedHead.endsWith(RLM)) out = trimmedHead + RLM + out.slice(tagStart);
  return out;
}

const LEADING_STOP = /^(-\s*)?([.!?,:;]+)\s*/;
const TRAILING_DASH = /\s-$/;
/** Share of lines that must start with a stop for a file to count as stored with flipped punctuation. */
const FLIPPED_SHARE = 0.15;
const FLIPPED_MIN_LINES = 3;

function splitTags(line: string): { open: string; body: string; close: string } {
  const m = /^((?:<[^>]+>)*)(.*?)((?:<\/[^>]+>)*)$/s.exec(line);
  return { open: m?.[1] ?? '', body: m?.[2] ?? line, close: m?.[3] ?? '' };
}

function unflipLine(line: string): string {
  if (line.trim() === '') return line;
  const { open, body: raw, close } = splitTags(line);
  let body = raw.trim();
  if (TRAILING_DASH.test(body) && !body.startsWith('-')) {
    body = `- ${body.slice(0, -2).trimEnd()}`;
  }
  const lead = LEADING_STOP.exec(body);
  if (lead) {
    const stops = [...(lead[2] ?? '')].reverse().join('');
    body = `${lead[1] ?? ''}${body.slice(lead[0].length)}${stops}`;
  }
  return `${open}${body}${close}`;
}

/**
 * Some ready-made Hebrew subtitles are stored in "visual" order: the full stop or question mark
 * sits at the START of the line and a dialogue dash at the END (".שב", "?מה -"). Shown as is, or
 * with the right-to-left fix, that puts them on the wrong side. When enough lines of the whole
 * file start with such a mark, every line is put back in logical order ("שב.", "- מה?"). A file
 * with normal punctuation is returned untouched.
 */
export function unflipPunctuation(texts: readonly string[]): string[] {
  const lines = texts.flatMap((t) => t.split('\n')).filter((l) => l.trim() !== '');
  const flipped = lines.filter((l) => LEADING_STOP.test(splitTags(l).body.trim())).length;
  if (flipped < FLIPPED_MIN_LINES || flipped / lines.length < FLIPPED_SHARE) return [...texts];
  return texts.map((t) => t.split('\n').map(unflipLine).join('\n'));
}

const LEADING_DASH = /^[-–—]+\s*/;
const TRAILING_DASH_BEFORE_STOP = /\s*[-–—]+\s*([.!?,:;]*)$/;

/**
 * Removes the dialogue dash at the start of a line and any dash at its end (before a final stop
 * too), the way ready-made subtitles mark a change of speaker. In right-to-left text they land
 * on odd sides of the line and only get in the way.
 */
export function stripDialogueDashes(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (line.trim() === '') return line;
      const { open, body, close } = splitTags(line);
      const clean = body.trim().replace(LEADING_DASH, '').replace(TRAILING_DASH_BEFORE_STOP, '$1');
      return `${open}${clean}${close}`;
    })
    .join('\n');
}

const MUSIC_NOTES = /[♪♫♬♩]+/g;

/** Removes the music note symbols of a lyric line; a line that is only notes is left alone. */
function stripMusicNotes(line: string): string {
  if (!MUSIC_NOTES.test(line)) return line;
  MUSIC_NOTES.lastIndex = 0;
  const { open, body, close } = splitTags(line);
  const clean = body
    .replace(MUSIC_NOTES, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  return /[\p{L}\p{N}]/u.test(clean) ? `${open}${clean}${close}` : line;
}

export function applyRtlFix(text: string): string {
  return text
    .split('\n')
    .map((line) => fixLine(stripMusicNotes(line)))
    .join('\n');
}
