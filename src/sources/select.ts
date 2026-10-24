import type { SubtitleCandidate } from './types';

export type Selection =
  | { kind: 'direct'; candidate: SubtitleCandidate }
  | { kind: 'translate'; candidate: SubtitleCandidate }
  | { kind: 'none' };

/** How much one place in the user's source order is worth: more than any quality term below. */
const RANK_STEP = 2_000_000;
const MAX_RANKS = 3;
/** A subtitle made for the very same release as the playing file: above the source order. */
const RELEASE_WEIGHT = 30_000_000;

const FILE_EXTENSION = /.(srt|ass|ssa|vtt|sub|zip|mkv|mp4|avi|webm|m4v)$/i;
const NOISE_WORDS = new Set([
  'srt',
  'ass',
  'eng',
  'en',
  'english',
  'subs',
  'subtitle',
  'subtitles',
]);

/** The words of a file or release name that tell releases apart (group, source, resolution...). */
function releaseWords(name: string): Set<string> {
  const words = name
    .replace(FILE_EXTENSION, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 2 && !NOISE_WORDS.has(w));
  return new Set(words);
}

/** 0..1: how much the subtitle's release name and the video's file name have in common. */
export function releaseSimilarity(subtitleName: string, videoName: string | undefined): number {
  if (!videoName) return 0;
  const a = releaseWords(subtitleName);
  const b = releaseWords(videoName);
  if (a.size === 0 || b.size === 0) return 0;
  let common = 0;
  for (const w of a) if (b.has(w)) common++;
  return common / (a.size + b.size - common);
}

/**
 * Higher is better: hash match (exact timing), a release name like the playing file's, the
 * user's source order, human-made, a single
 * episode over a season pack, not hearing-impaired, then popularity/rating.
 */
export function score(c: SubtitleCandidate, videoName?: string): number {
  const rank = Math.min(c.providerRank ?? MAX_RANKS - 1, MAX_RANKS - 1);
  return (
    (c.hashMatch ? 100_000_000 : 0) +
    Math.round(releaseSimilarity(c.fileName, videoName) * RELEASE_WEIGHT) +
    (MAX_RANKS - 1 - rank) * RANK_STEP +
    (c.machineTranslated ? 0 : 100_000) +
    (c.pack ? 0 : 50_000) +
    (c.hearingImpaired ? 0 : 10_000) +
    Math.min(c.downloadCount, 9_999) +
    Math.min(Math.max(c.rating, 0), 10) * 100
  );
}

const byScore =
  (videoName?: string) =>
  (a: SubtitleCandidate, b: SubtitleCandidate): number =>
    score(b, videoName) - score(a, videoName);

/** Candidates in the same language as `language`, best first. */
export function rankSameLanguage(
  candidates: SubtitleCandidate[],
  language: string,
  videoName?: string,
): SubtitleCandidate[] {
  const norm = (l: string) => l.toLowerCase().split('-')[0];
  return candidates.filter((c) => norm(c.language) === norm(language)).sort(byScore(videoName));
}

/**
 * 1. A subtitle already in the target language is served directly (no translation).
 * 2. Otherwise the best English source is translated.
 * 3. Otherwise the best subtitle in any other language.
 */
export function selectSubtitle(
  candidates: SubtitleCandidate[],
  targetLanguage: string,
  sourceLanguage = 'en',
  videoName?: string,
): Selection {
  const norm = (l: string) => l.toLowerCase().split('-')[0];
  const target = candidates.filter((c) => norm(c.language) === norm(targetLanguage));
  const targetBest = [...target].sort(byScore(videoName))[0];
  if (targetBest) return { kind: 'direct', candidate: targetBest };

  const others = candidates.filter((c) => norm(c.language) !== norm(targetLanguage));
  const english = others.filter((c) => norm(c.language) === norm(sourceLanguage));
  const best = [...(english.length > 0 ? english : others)].sort(byScore(videoName))[0];
  return best ? { kind: 'translate', candidate: best } : { kind: 'none' };
}
