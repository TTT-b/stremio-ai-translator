import type { Cue, SubtitleFile } from './types';

/**
 * Subtitles made for the hard of hearing carry more than speech: who is talking ("KATARA: Water.")
 * and sounds ("(groans)", "[door slams]"). They are removed before translation, so the viewer sees
 * only what is said, and a line that was only a sound disappears.
 */

/** A speaker label at the start of a line: capital letters, then a colon ("MAN 1:", "SOKKA (O.S.):"). */
const SPEAKER = /^(?:[-–—]\s*)?[A-Z][A-Z0-9 .'#&-]{0,24}(?:\s*\([A-Za-z. ]{1,12}\))?:\s+/;
/** A sound or action note at the start or the end of a line: a short text in () or []. Notes in the middle of a sentence are speech and stay. */
const NOTE_START = /^\s*(?:\([^()]{1,60}\)|\[[^[\]]{1,60}\])\s*/;
const NOTE_END = /\s*(?:\([^()]{1,60}\)|\[[^[\]]{1,60}\])\s*$/;
const ONLY_DASHES = /^[-–—\s]*$/;

function stripNotes(line: string): string {
  let text = line;
  for (let before = ''; before !== text;) {
    before = text;
    text = text.replace(NOTE_START, '').replace(NOTE_END, '');
  }
  return text.trim();
}

/** The words of a line, without any tags around them. */
function cleanWords(words: string): string {
  const noLabel = words.replace(SPEAKER, (m) => (/^[-–—]/.test(m) ? '- ' : ''));
  // A dash in front of a note ("- (thud)") belongs to the note.
  const dash = /^([-–—]\s*)(.*)$/.exec(noLabel);
  const noNotes = dash
    ? `${dash[1] ?? ''}${stripNotes(dash[2] ?? '')}`.trim()
    : stripNotes(noLabel);
  return ONLY_DASHES.test(noNotes) ? '' : noNotes;
}

const OPEN_TAGS = /^((?:<[^>/][^>]*>\s*)*)/;
const CLOSE_TAGS = /((?:\s*<\/[^>]+>)*)$/;

/** One line; tags around its words (<i>, <font ...>) are kept when words are left, dropped with it otherwise. */
function cleanLine(line: string): string {
  const open = OPEN_TAGS.exec(line)?.[1] ?? '';
  const rest = line.slice(open.length);
  const close = CLOSE_TAGS.exec(rest)?.[1] ?? '';
  const words = cleanWords(rest.slice(0, rest.length - close.length));
  return words === '' ? '' : `${open}${words}${close}`;
}

function cleanBody(text: string): string {
  const lines = text
    .split('\n')
    .map(cleanLine)
    .filter((l) => l !== '');
  // A dash that marked "two people talking" means nothing when only one line is left.
  const only =
    lines.length === 1 ? (lines[0] as string).replace(/^(<[^>]+>)*[-–—]\s*/, '$1') : undefined;
  return (only ?? lines.join('\n')).trim();
}

const WRAPPED = /^((?:<[^>/][^>]*>)+)([\s\S]*?)((?:<\/[^>]+>)+)$/;

/** The text of one cue without speaker labels and sound notes; empty when nothing is left. */
export function cleanText(text: string): string {
  const wrapped = WRAPPED.exec(text.trim());
  if (!wrapped) return cleanBody(text);
  const body = cleanBody(wrapped[2] as string);
  return body === '' ? '' : `${wrapped[1]}${body}${wrapped[3]}`;
}

/** The cues without labels and notes. Cues left empty are dropped and the rest are numbered again. */
export function cleanSubtitle(file: SubtitleFile): SubtitleFile {
  const kept: Cue[] = [];
  for (const cue of file.cues) {
    const text = cleanText(cue.text);
    if (text !== '') kept.push({ ...cue, index: kept.length + 1, text });
  }
  return { ...file, cues: kept };
}
