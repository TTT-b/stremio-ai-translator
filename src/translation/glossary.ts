/**
 * Per-series names glossary: deterministic extraction of "source name -> target spelling" pairs
 * from a finished translation, and the small helpers the prompt uses. No AI call is involved.
 */
import type { VideoRef } from '../sources/types';

/** Source spelling -> the spelling used in the target language. */
export type GlossaryNames = Record<string, string>;

export const MAX_NAMES_PER_SERIES = 100;
export const MAX_SERIES = 200;
/** A name must be seen in at least this many lines before a spelling is trusted. */
const MIN_LINES = 3;
/** Share of a name's lines that must hold the target word, and of that word's lines that hold the name. */
const MIN_AGREEMENT = 0.8;
/** Only the most frequent candidate names of an episode are examined. */
const MAX_CANDIDATES = 300;
const MAX_NAME_LENGTH = 40;

/** Hebrew one-letter prefixes (in, to, the, and, from, that, like) that stick to a name. */
const HEBREW_PREFIXES = 'בלהוכמש';
const INVISIBLE = /[‎‏‪-‮⁦-⁩]/g;
const WORD_EDGE = /^['’׳-]+|['’׳-]+$/g;

/** Key of a series: "imdb:tt0944947" (no season or episode). Movies have none. */
export function seriesKeyOf(
  v: Pick<VideoRef, 'type' | 'idKind' | 'externalId'>,
): string | undefined {
  return v.type === 'series' ? `${v.idKind}:${v.externalId}` : undefined;
}

const words = (text: string): string[] =>
  text
    .replace(INVISIBLE, '')
    .split(/[^\p{L}\p{M}'’׳-]+/u)
    .map((w) => w.replace(WORD_EDGE, ''))
    .filter((w) => w.length > 0);

/** The words of one translated cue; for Hebrew also the word without a one-letter prefix. */
function targetForms(text: string, code: string): { bare: Set<string>; sliced: Set<string> } {
  const bare = new Set<string>();
  const sliced = new Set<string>();
  for (const w of words(text)) {
    const word = w.toLowerCase();
    bare.add(word);
    if (code === 'he' && word.length >= 4 && HEBREW_PREFIXES.includes(word.charAt(0))) {
      sliced.add(word.slice(1));
    }
  }
  return { bare, sliced };
}

/** Capitalised source words that never occur in lower case and occur capitalised mid-sentence. */
function candidateNames(source: readonly { text: string }[]): Map<string, number[]> {
  const lower = new Set<string>();
  const midSentence = new Map<string, number>();
  const lines = new Map<string, Set<number>>();
  source.forEach((cue, index) => {
    let sentenceStart = true;
    for (const raw of cue.text.replace(/<[^>]*>/g, ' ').split(/(\s+)/)) {
      if (raw.trim() === '') continue;
      const word = raw
        .replace(/^[^\p{L}]+/u, '')
        .replace(/[^\p{L}]+$/u, '')
        .replace(/['’]s$/i, '');
      const endsSentence = /[.!?…:]["')\]]*$/.test(raw);
      if (/^\p{Ll}/u.test(word)) lower.add(word);
      else if (/^\p{Lu}[\p{L}'’-]{2,}$/u.test(word) && word !== word.toUpperCase()) {
        if (!sentenceStart) midSentence.set(word, (midSentence.get(word) ?? 0) + 1);
        const set = lines.get(word) ?? new Set<number>();
        set.add(index);
        lines.set(word, set);
      }
      sentenceStart = endsSentence;
    }
  });
  const out = new Map<string, number[]>();
  const ranked = [...midSentence.entries()]
    .filter(([w, n]) => n >= 1 && !lower.has(w.toLowerCase()) && w.length <= MAX_NAME_LENGTH)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_CANDIDATES);
  for (const [w] of ranked) {
    const at = [...(lines.get(w) ?? [])];
    if (at.length >= MIN_LINES) out.set(w, at);
  }
  return out;
}

/**
 * Pairs each recurring proper name of the source with the one target word that shows up in (almost)
 * exactly the same lines. Cues are aligned by position; a name whose spelling is not clear is left
 * out, never guessed. `dual`: each translated cue holds "original\ntranslation".
 */
export function extractNames(
  sourceCues: readonly { text: string }[],
  translatedCues: readonly { text: string }[],
  languageCode: string,
  dual: boolean,
): GlossaryNames {
  if (sourceCues.length === 0 || sourceCues.length !== translatedCues.length) return {};
  const forms = translatedCues.map((c) => {
    const text = dual ? c.text.split('\n').slice(1).join(' ') : c.text;
    return targetForms(text, languageCode);
  });
  const linesOfWord = new Map<string, Set<number>>();
  const addLine = (w: string, i: number): void => {
    const set = linesOfWord.get(w) ?? new Set<number>();
    set.add(i);
    linesOfWord.set(w, set);
  };
  forms.forEach((f, i) => {
    for (const w of f.bare) addLine(w, i);
    for (const w of f.sliced) if (!f.bare.has(w)) addLine(w, i);
  });
  const names: GlossaryNames = {};
  for (const [name, at] of candidateNames(sourceCues)) {
    const counts = new Map<string, { both: number; written: number }>();
    for (const i of at) {
      const f = forms[i];
      if (!f) continue;
      for (const w of new Set([...f.bare, ...f.sliced])) {
        const c = counts.get(w) ?? { both: 0, written: 0 };
        c.both++;
        if (f.bare.has(w)) c.written++;
        counts.set(w, c);
      }
    }
    let best: { word: string; both: number; written: number } | undefined;
    for (const [word, c] of counts) {
      const total = linesOfWord.get(word)?.size ?? 0;
      if (word.length < 2 || word === name.toLowerCase()) continue;
      if (c.both / at.length < MIN_AGREEMENT || c.both / total < MIN_AGREEMENT) continue;
      // More shared lines wins; on a tie the word as actually written beats a prefix-stripped one.
      if (!best || c.both > best.both || (c.both === best.both && c.written > best.written)) {
        best = { word, ...c };
      }
    }
    if (best) names[name] = best.word;
  }
  return names;
}

/** "Name = Spelling" lines for the names found in the given texts (kept short per request). */
export function namesForRequest(
  names: Readonly<GlossaryNames> | undefined,
  texts: readonly string[],
): string[] {
  if (!names) return [];
  const joined = texts.join('\n');
  return Object.entries(names)
    .filter(([name]) => joined.includes(name))
    .map(([name, spelling]) => `${name} = ${spelling}`);
}
