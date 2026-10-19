import type { Cue } from './types';

/** A cue start counts as "the same moment" when it is within this many ms. */
export const AGREEMENT_TOLERANCE_MS = 500;
/** A file within this score of the best one is treated as equally good (keeps the popularity order). */
const TIE_MARGIN = 0.02;

/** Share of `a` cue starts that land within `tolMs` of some cue start in `b`. Timing only, no text. */
export function startAgreement(a: Cue[], b: Cue[], tolMs = AGREEMENT_TOLERANCE_MS): number {
  if (a.length === 0 || b.length === 0) return 0;
  const as = a.map((c) => c.startMs).sort((x, y) => x - y);
  const bs = b.map((c) => c.startMs).sort((x, y) => x - y);
  let j = 0;
  let hits = 0;
  for (const s of as) {
    while (j + 1 < bs.length && (bs[j + 1] as number) <= s) j++;
    const here = Math.abs((bs[j] as number) - s);
    const next = j + 1 < bs.length ? Math.abs((bs[j + 1] as number) - s) : Infinity;
    if (Math.min(here, next) <= tolMs) hits++;
  }
  return hits / as.length;
}

export interface ConsensusItem<T> {
  item: T;
  cues: Cue[];
}

export interface ConsensusResult<T> {
  winner: T;
  /** Mean agreement with the other files, same order as the input (0..1). */
  scores: number[];
}

/**
 * Picks the file whose timing most of the other files agree with. Different releases of a video
 * have different timing; files made for the same release agree with each other, so the biggest
 * group wins. Input order is the preference order (best first) and breaks near-ties.
 * Needs at least 3 files: with 2 there is no majority.
 */
export function pickByConsensus<T>(items: ConsensusItem<T>[]): ConsensusResult<T> | undefined {
  if (items.length < 3) return undefined;
  const n = items.length;
  const scores = items.map((x, i) => {
    let sum = 0;
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const y = items[k] as ConsensusItem<T>;
      sum += (startAgreement(x.cues, y.cues) + startAgreement(y.cues, x.cues)) / 2;
    }
    return sum / (n - 1);
  });
  const best = Math.max(...scores);
  const index = scores.findIndex((s) => s >= best - TIE_MARGIN);
  return { winner: (items[index] as ConsensusItem<T>).item, scores };
}
