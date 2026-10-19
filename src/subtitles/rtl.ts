const RLM = '‏';

/** Closing tags and whitespace at the end of a line (e.g. `</i>`, `</font>`). */
const TRAILING_TAGS = /((?:<\/[a-z][a-z0-9]*>|\s)*)$/i;

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
  let out = line;
  if (!out.startsWith(RLM)) out = RLM + out;
  const tail = TRAILING_TAGS.exec(out);
  const tagStart = tail ? out.length - tail[0].length : out.length;
  // Trailing whitespace is only layout noise; put the mark right after the last real character.
  const trimmedHead = out.slice(0, tagStart);
  if (!trimmedHead.endsWith(RLM)) out = trimmedHead + RLM + out.slice(tagStart);
  return out;
}

export function applyRtlFix(text: string): string {
  return text.split('\n').map(fixLine).join('\n');
}
