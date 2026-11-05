import { AppError } from '../errors';
import type { ChunkCue } from './chunk';
import type { Cue } from './types';

/** Alphabets a target language may use (Unicode script names). */
type CheckedScript =
  | 'Hebrew'
  | 'Arabic'
  | 'Cyrillic'
  | 'Han'
  | 'Hiragana'
  | 'Katakana'
  | 'Hangul'
  | 'Devanagari'
  | 'Greek';

/**
 * Scripts each target language legitimately uses. Latin letters, digits and punctuation are never
 * checked (names and brands stay in Latin). A language missing here is not checked at all.
 */
const TARGET_SCRIPTS: Record<string, readonly CheckedScript[]> = {
  he: ['Hebrew'],
  ar: ['Arabic'],
  fa: ['Arabic'],
  ru: ['Cyrillic'],
  uk: ['Cyrillic'],
  el: ['Greek'],
  hi: ['Devanagari'],
  ja: ['Han', 'Hiragana', 'Katakana'],
  ko: ['Hangul', 'Han'],
  zh: ['Han'],
  en: [],
  es: [],
  fr: [],
  de: [],
  it: [],
  pt: [],
  pl: [],
  nl: [],
  tr: [],
  ro: [],
};

/**
 * Letters of any alphabet other than the target language's own and Latin (names and brands stay in
 * Latin). Anything else is a model slip, e.g. a Georgian or Ethiopic letter inside a Hebrew word.
 */
const foreignLetters = new Map<string, RegExp>();
function foreignLettersFor(own: readonly CheckedScript[]): RegExp {
  const key = own.join(',');
  let re = foreignLetters.get(key);
  if (!re) {
    const allowed = [...own, 'Latin'].map((x) => `\\p{Script=${x}}`).join('');
    re = new RegExp(`[^${allowed}\\P{L}]+`, 'gu');
    foreignLetters.set(key, re);
  }
  return re;
}

/** Remove letters of foreign alphabets that the source line did not itself contain. */
function stripForeign(sourceText: string, translated: string, own: readonly CheckedScript[]) {
  const out = translated.replace(foreignLettersFor(own), (run) =>
    [...run].filter((ch) => sourceText.includes(ch)).join(''),
  );
  if (out === translated) return translated;
  // Tidy the gap a removed word leaves behind.
  return out
    .split('\n')
    .map((l) => l.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n');
}

/**
 * Silently remove stray letters from a foreign alphabet (for example one Arabic letter inside a
 * Hebrew word) from the translation. Scripts the source line itself contains and the target
 * language's own scripts are kept; Latin letters, digits and punctuation are never touched.
 * A line left empty is reported by `findChunkProblems`. Returns the same array if nothing changed.
 */
export function stripForeignScripts(
  source: Cue[],
  translations: ChunkCue[],
  targetLanguageCode: string,
): ChunkCue[] {
  const own = TARGET_SCRIPTS[targetLanguageCode.toLowerCase()];
  if (!own) return translations;
  const sourceById = new Map(source.map((c) => [String(c.index), c.text]));
  let changed = false;
  const cleaned = translations.map((t) => {
    const src = sourceById.get(t?.id);
    if (src === undefined || typeof t.text !== 'string') return t;
    const text = stripForeign(src, t.text, own);
    if (text === t.text) return t;
    changed = true;
    return { ...t, text };
  });
  return changed ? cleaned : translations;
}

const LATIN_WORD = /\p{Script=Latin}{2,}/gu;
/** Short Latin tokens a translation may add on its own (units, common abbreviations). */
const ALLOWED_LATIN = new Set(['ok', 'tv', 'kg', 'km', 'cm', 'mm', 'ml', 'vs', 'dj', 'ps', 'pm']);

/**
 * Ids of lines whose translation holds a Latin word that is not in the source line, for a target
 * language that is not written in Latin (a leftover like "lad" inside a Hebrew sentence). Words
 * the source line itself has (names, brands) and ALL-CAPS abbreviations are fine. A hint for one
 * repair attempt, never a reason to fail a chunk.
 */
export function findSuspiciousLines(
  source: Cue[],
  translations: ChunkCue[],
  targetLanguageCode: string,
): string[] {
  const own = TARGET_SCRIPTS[targetLanguageCode.toLowerCase()];
  if (!own || own.length === 0) return [];
  const sourceById = new Map(source.map((c) => [String(c.index), c.text.toLowerCase()]));
  const ids: string[] = [];
  for (const t of translations) {
    const src = sourceById.get(t?.id);
    if (src === undefined || typeof t.text !== 'string') continue;
    const words = t.text.match(LATIN_WORD) ?? [];
    const stray = words.some(
      (w) =>
        !(w === w.toUpperCase()) &&
        !ALLOWED_LATIN.has(w.toLowerCase()) &&
        !src.includes(w.toLowerCase()),
    );
    if (stray) ids.push(t.id);
  }
  return ids;
}

/**
 * Check one chunk's translation against its source. Returns a list of problems
 * (empty = valid). Problem strings contain IDs only, never dialogue.
 */
export function findChunkProblems(source: Cue[], translations: ChunkCue[]): string[] {
  const problems: string[] = [];
  const expected = new Set(source.map((c) => String(c.index)));
  const seen = new Map<string, string>();

  for (const t of translations) {
    if (typeof t?.id !== 'string' || typeof t?.text !== 'string') {
      problems.push('malformed translation entry');
      continue;
    }
    if (!expected.has(t.id)) problems.push(`unknown id ${t.id}`);
    else if (seen.has(t.id)) problems.push(`duplicate id ${t.id}`);
    else seen.set(t.id, t.text);
  }
  for (const c of source) {
    const id = String(c.index);
    const out = seen.get(id);
    if (out === undefined) problems.push(`missing id ${id}`);
    else if (c.text.trim() !== '' && out.trim() === '') problems.push(`empty translation id ${id}`);
    else if (/```/.test(out)) problems.push(`markdown fence in id ${id}`);
  }
  return problems;
}

/** Final whole-file check: same cue count, order and timestamps as the source. */
export function assertSameStructure(source: Cue[], result: Cue[]): void {
  if (source.length !== result.length) {
    throw new AppError('FINAL_SUBTITLE_INVALID', `cue count ${source.length} -> ${result.length}`);
  }
  for (let i = 0; i < source.length; i++) {
    const a = source[i] as Cue;
    const b = result[i] as Cue;
    if (a.startMs !== b.startMs || a.endMs !== b.endMs) {
      throw new AppError('FINAL_SUBTITLE_INVALID', `timestamp mismatch at cue ${a.index}`);
    }
    if (a.text.trim() !== '' && b.text.trim() === '') {
      throw new AppError('FINAL_SUBTITLE_INVALID', `empty text at cue ${a.index}`);
    }
  }
}
