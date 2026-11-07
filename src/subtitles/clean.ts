import { applyRtlFix } from './rtl';
import type { Cue, SubtitleFile } from './types';

/**
 * Subtitles made for the hard of hearing carry more than speech: who is talking ("KATARA: Water.")
 * and sounds ("(groans)", "[door slams]"). They are removed before translation, so the viewer sees
 * only what is said, and a line that was only a sound disappears. Credits ("Translated by ...",
 * "תורגם ע"י ...") and site adverts are removed too.
 */

/** A credit or advert cue: who translated, synced or uploaded the subtitle, or a site's name. */
const CREDIT = [
  /^(?:translated|translation|subtitles?|subs|captions?|synced?|synchroni[sz]ed|sync|timed|timing|encoded|edited|ripped|proofread|resynced|corrected)(?:\s*(?:&|and|\/)\s*\w+)?\s*(?:by\b|:|-)/i,
  /(?:www\.|https?:\/\/)\S+|\b(?:opensubtitles|subscene|addic7ed|podnapisi|yifysubtitles|subdl)\b/i,
  /^(?:תורגם|תורגמו|תרגום|תירגום|סנכרון|סונכרן|סונכרנו|הוכן|עריכה|עריכת תרגום|הגהה|תזמון|כתוביות)\s*(?:ע["״”']?י|על[- ]ידי|:|-)/,
];

function isCredit(text: string): boolean {
  const first =
    text
      .replace(/<[^>]*>/g, '')
      .split('\n')[0]
      ?.trim() ?? '';
  return CREDIT.some((pattern) => pattern.test(first));
}

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

/**
 * A music note written between music symbols instead of brackets ("♪ tense music plays ♪").
 * Only a short description counts; sung lyrics between the same symbols stay.
 */
const MUSIC_NOUN =
  /\b(?:music|musical|stinger|instrumental|theme|score|humming|whistling|chanting|vocali[sz]ing|singing|kalimba|guitar|piano|violin|drums?|strings|choir|orchestra)\b/i;
/** A verb that only describes the music ("plays", "swells"), at the end of a very short note. */
const MUSIC_VERB_END =
  /\b(?:plays?|playing|swells|fades|intensifies|continues|resumes|builds|starts|ends|stops)(?:\s+\w+ly)?$/i;
const MUSIC_NOTE_MAX_WORDS = 7;

function isMusicSymbolNote(words: string): boolean {
  if (!/[♪♫]/.test(words)) return false;
  const text = words
    .replace(/[♪♫#*~]/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/^[\s\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (text === '') return true;
  if (/[?!]$/.test(text)) return false;
  const count = text.split(' ').length;
  if (count > MUSIC_NOTE_MAX_WORDS) return false;
  // Descriptions are written in lower case; a capitalised short line is more likely a lyric, so it
  // goes only when it also ends in a verb that describes the music.
  const verbEnd = count <= 4 && MUSIC_VERB_END.test(text);
  return /^\p{Ll}/u.test(text)
    ? MUSIC_NOUN.test(text) || verbEnd
    : MUSIC_NOUN.test(text) && verbEnd;
}

/** The words of a line, without any tags around them. */
function cleanWords(words: string): string {
  if (isMusicSymbolNote(words)) return '';
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
    const text = isCredit(cue.text) ? '' : cleanText(cue.text);
    if (text !== '') kept.push({ ...cue, index: kept.length + 1, text });
  }
  return { ...file, cues: kept };
}

const DIRECTION_MARKS = /[‎‏]/g;

/**
 * The same cleaning for a finished translation: the AI may write a sound note of its own
 * ("[nostalgic music playing]"), which the viewer does not want. Cues left empty are dropped.
 */
export function cleanTranslated(cues: Cue[], rtl: boolean): Cue[] {
  const kept: Cue[] = [];
  for (const cue of cues) {
    const text = cleanText(cue.text.replace(DIRECTION_MARKS, ''));
    if (text !== '')
      kept.push({ ...cue, index: kept.length + 1, text: rtl ? applyRtlFix(text) : text });
  }
  return kept;
}
