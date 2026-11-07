import type { SubtitleFile } from './types';

/**
 * Who is who: names of characters whose gender the source itself makes clear, found by plain code
 * (no AI request). They are handed to the translator so it does not have to guess "he" or "she"
 * for every line. A name without clear evidence is left out, so a wrong hint is rare.
 */

type Gender = 'male' | 'female';

const MALE_TITLES = 'Mr|Mister|Sir|Lord|King|Prince|Uncle|Father|Master|Prof';
const FEMALE_TITLES = 'Mrs|Ms|Miss|Madam|Lady|Queen|Princess|Aunt|Mother|Auntie';
const TITLE_NAME = new RegExp(
  `\\b(${MALE_TITLES}|${FEMALE_TITLES})\\.?\\s+([A-Z][a-z]{1,20})\\b`,
  'g',
);
const MALE_WORD = /\b(?:he|him|his|himself)\b/gi;
const FEMALE_WORD = /\b(?:she|her|hers|herself)\b/gi;
/** A speaker label at the start of a line: [Nisha], (Nisha) or NISHA: */
const LABEL =
  /^\s*(?:[-–—]\s*)?(?:<[^>]+>\s*)*(?:\[([A-Z][A-Za-z'-]{1,20})\]|\(([A-Z][A-Za-z'-]{1,20})\)|([A-Z][A-Za-z'-]{1,20}):)/;
const NOT_NAMES = new Set(['narrator', 'man', 'woman', 'boy', 'girl', 'all', 'both', 'crowd']);
const MIN_EVIDENCE = 2;
const MAX_CAST = 30;
/** How strongly a title in front of a name counts, against a pronoun near it. */
const TITLE_WEIGHT = 3;

function plain(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function count(re: RegExp, text: string): number {
  return text.match(re)?.length ?? 0;
}

function capitalise(name: string): string {
  return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
}

/** The names that speak in the file (from labels), and the ones that follow a title. */
function candidates(texts: string[]): Map<string, { male: number; female: number }> {
  const found = new Map<string, { male: number; female: number }>();
  const add = (raw: string): string | undefined => {
    const name = capitalise(raw);
    if (NOT_NAMES.has(name.toLowerCase())) return undefined;
    if (!found.has(name)) found.set(name, { male: 0, female: 0 });
    return name;
  };
  for (const text of texts) {
    for (const line of text.split('\n')) {
      const m = LABEL.exec(line);
      const label = m?.[1] ?? m?.[2] ?? m?.[3];
      if (label) add(label);
    }
  }
  for (const text of texts) {
    for (const m of plain(text).matchAll(TITLE_NAME)) {
      const name = add(m[2] as string);
      if (!name) continue;
      const score = found.get(name) as { male: number; female: number };
      if (new RegExp(`^(?:${MALE_TITLES})$`).test(m[1] as string)) score.male += TITLE_WEIGHT;
      else score.female += TITLE_WEIGHT;
    }
  }
  return found;
}

/**
 * The cast with known gender, as short lines for the translator ("Nisha: female"). Pronouns
 * after a mention of the name (in the same sentence) and titles ("Mrs. Lee") count.
 */
export function buildCast(file: SubtitleFile): string[] {
  const texts = file.cues.map((c) => c.text);
  const found = candidates(texts);
  if (found.size === 0) return [];
  const flat = texts.map(plain);
  for (const [name, score] of found) {
    const mention = new RegExp(`\\b${name}\\b`, 'i');
    flat.forEach((line) => {
      // Skip the label itself so "Nisha:" is not counted as being talked about.
      const body = line.replace(
        new RegExp(`^(?:[-–—]\\s*)?(?:\\[${name}\\]|\\(${name}\\)|${name}:)`, 'i'),
        '',
      );
      const at = body.search(mention);
      if (at < 0) return;
      // Only the rest of the same sentence: a pronoun in the next line may be about someone else.
      const near = body.slice(at + name.length).split(/[.!?]/)[0] ?? '';
      score.male += count(MALE_WORD, near);
      score.female += count(FEMALE_WORD, near);
    });
  }
  const cast: string[] = [];
  for (const [name, { male, female }] of found) {
    const gender: Gender | undefined =
      male >= MIN_EVIDENCE && male >= female * 2
        ? 'male'
        : female >= MIN_EVIDENCE && female >= male * 2
          ? 'female'
          : undefined;
    if (gender) cast.push(`${name}: ${gender}`);
  }
  return cast.slice(0, MAX_CAST);
}
