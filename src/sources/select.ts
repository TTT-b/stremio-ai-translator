import type { SubtitleCandidate } from './types';

export type Selection =
  | { kind: 'direct'; candidate: SubtitleCandidate }
  | { kind: 'translate'; candidate: SubtitleCandidate }
  | { kind: 'none' };

/** Higher is better: hash match, human-made, not hearing-impaired, then popularity/rating. */
export function score(c: SubtitleCandidate): number {
  return (
    (c.hashMatch ? 1_000_000 : 0) +
    (c.machineTranslated ? 0 : 100_000) +
    (c.hearingImpaired ? 0 : 10_000) +
    Math.min(c.downloadCount, 9_999) +
    Math.min(Math.max(c.rating, 0), 10) * 100
  );
}

const byScore = (a: SubtitleCandidate, b: SubtitleCandidate) => score(b) - score(a);

/**
 * 1. A subtitle already in the target language is served directly (no translation).
 * 2. Otherwise the best English source is translated.
 * 3. Otherwise the best subtitle in any other language.
 */
export function selectSubtitle(
  candidates: SubtitleCandidate[],
  targetLanguage: string,
  sourceLanguage = 'en',
): Selection {
  const norm = (l: string) => l.toLowerCase().split('-')[0];
  const target = candidates.filter((c) => norm(c.language) === norm(targetLanguage));
  const targetBest = [...target].sort(byScore)[0];
  if (targetBest) return { kind: 'direct', candidate: targetBest };

  const others = candidates.filter((c) => norm(c.language) !== norm(targetLanguage));
  const english = others.filter((c) => norm(c.language) === norm(sourceLanguage));
  const best = [...(english.length > 0 ? english : others)].sort(byScore)[0];
  return best ? { kind: 'translate', candidate: best } : { kind: 'none' };
}
