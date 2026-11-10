import type { Cue } from '../subtitles/types';
import type { TimingFit } from './fit';

/**
 * Lines up a subtitle with the subtitle track that ships inside the video, by comparing when the
 * lines start (and, as a help, which words they share). The track inside the video was made for
 * this very file, so its times are the real ones.
 */

const BIN_MS = 100;
/** The subtitle may start this much too early or too late. */
const MAX_OFFSET_MS = 120_000;
/** Cues of the video's track that can be compared: not a flash of a sign or a song effect. */
const MIN_CUE_MS = 300;
const MIN_USABLE = 8;
/** A line of the track counts as matched when a subtitle line is within this of the chosen shift. */
const MATCH_MS = 400;
const MIN_MATCHED = 6;
const MIN_SHARE = 0.3;
const RUNNER_UP_APART_BINS = 30;
const RUNNER_UP_RATIO = 1.8;
/** Windows that agree to within this are taken as one shift for the whole video. */
export const SAME_SHIFT_MS = 400;
/** Pieces that agree to within this get one and the same shift; a bigger (still small) difference is followed. */
const FINE_SHIFT_MS = 100;
/** The shift may change by at most this share per second of video (a frame-rate mismatch is ~4%). */
const MAX_SLOPE = 0.05;

export interface WindowMatch {
  /** Add this to the subtitle's times to get the video's times. */
  offsetMs: number;
  matched: number;
  usable: number;
  /** Where this window is, on the subtitle's own timeline. */
  atMs: number;
}

interface Knot {
  atMs: number;
  offsetMs: number;
}

const wordsOf = (text: string): Set<string> =>
  new Set(
    text
      .replace(/\{[^}]*\}|<[^>]*>/g, ' ')
      .toLowerCase()
      .split(/[^\p{L}\p{N}']+/u)
      .filter((w) => w.length >= 3),
  );

function similarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** A typeset sign, a song effect or a flash: its start says nothing about when people talk. */
function usableRef(c: Cue): boolean {
  if (c.endMs - c.startMs < MIN_CUE_MS) return false;
  return !/\{[^}]*\\(pos|move|fad|fade|clip|org|t)\b/.test(c.text);
}

function median(values: number[]): number {
  const sorted = [...values].sort((p, q) => p - q);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/**
 * The shift between the subtitle and one piece of the video's own track, or undefined when no shift
 * clearly stands out (too few lines, or two different shifts look equally good).
 */
export function alignWindow(subCues: Cue[], refCues: Cue[]): WindowMatch | undefined {
  const refs = refCues.filter(usableRef);
  if (refs.length < MIN_USABLE || subCues.length < MIN_USABLE) return undefined;
  const subWords = subCues.map((c) => wordsOf(c.text));
  const refWords = refs.map((c) => wordsOf(c.text));
  const bins = Math.ceil((2 * MAX_OFFSET_MS) / BIN_MS) + 1;
  const hist = new Float64Array(bins);
  refs.forEach((r, i) => {
    subCues.forEach((s, j) => {
      const diff = r.startMs - s.startMs;
      if (Math.abs(diff) > MAX_OFFSET_MS) return;
      const weight = 1 + 3 * similarity(refWords[i] as Set<string>, subWords[j] as Set<string>);
      const bin = Math.floor((diff + MAX_OFFSET_MS) / BIN_MS);
      hist[bin] = (hist[bin] ?? 0) + weight;
    });
  });
  const smooth = (b: number): number => {
    let sum = 0;
    for (let k = -2; k <= 2; k++) sum += hist[b + k] ?? 0;
    return sum;
  };
  let best = 0;
  let bestScore = -1;
  for (let b = 0; b < bins; b++) {
    const v = smooth(b);
    if (v > bestScore) {
      bestScore = v;
      best = b;
    }
  }
  let second = 0;
  for (let b = 0; b < bins; b++) {
    if (Math.abs(b - best) > RUNNER_UP_APART_BINS) second = Math.max(second, smooth(b));
  }
  if (bestScore < MIN_USABLE || bestScore < second * RUNNER_UP_RATIO) return undefined;

  const centre = (best + 0.5) * BIN_MS - MAX_OFFSET_MS;
  // Each line of the track takes the subtitle line closest to this shift; the middle of those is the shift.
  const diffs: number[] = [];
  const places: number[] = [];
  for (const r of refs) {
    let pick: number | undefined;
    for (const s of subCues) {
      const d = r.startMs - s.startMs;
      const closer = pick === undefined || Math.abs(d - centre) < Math.abs(pick - centre);
      if (Math.abs(d - centre) <= MATCH_MS && closer) pick = d;
    }
    if (pick !== undefined) {
      diffs.push(pick);
      places.push(r.startMs - pick);
    }
  }
  if (diffs.length < MIN_MATCHED || diffs.length < MIN_SHARE * refs.length) return undefined;
  return {
    offsetMs: Math.round(median(diffs)),
    matched: diffs.length,
    usable: refs.length,
    atMs: Math.round(median(places)),
  };
}

const slopeOf = (a: Knot, b: Knot): number =>
  b.atMs === a.atMs
    ? 0
    : Math.max(-MAX_SLOPE, Math.min(MAX_SLOPE, (b.offsetMs - a.offsetMs) / (b.atMs - a.atMs)));

/** The shift at a time on the subtitle's timeline, for a fit made of several points (at least two). */
export function offsetAt(knots: Knot[], tMs: number): number {
  const first = knots[0] as Knot;
  const last = knots[knots.length - 1] as Knot;
  if (tMs <= first.atMs) {
    return first.offsetMs + slopeOf(first, knots[1] ?? first) * (tMs - first.atMs);
  }
  if (tMs >= last.atMs) {
    return last.offsetMs + slopeOf(knots[knots.length - 2] ?? last, last) * (tMs - last.atMs);
  }
  for (let i = 1; i < knots.length; i++) {
    const a = knots[i - 1] as Knot;
    const b = knots[i] as Knot;
    if (tMs <= b.atMs) {
      return a.offsetMs + ((tMs - a.atMs) / (b.atMs - a.atMs)) * (b.offsetMs - a.offsetMs);
    }
  }
  return last.offsetMs;
}

interface LineMatch {
  diff: number;
  startMs: number;
}

/** The subtitle line that sits at the given shift from a line of the track, if there is one. */
function lineAt(ref: Cue, subCues: Cue[], shiftMs: number): LineMatch | undefined {
  let pick: LineMatch | undefined;
  for (const s of subCues) {
    const diff = ref.startMs - s.startMs;
    if (Math.abs(diff - shiftMs) > MATCH_MS) continue;
    if (!pick || Math.abs(diff - shiftMs) < Math.abs(pick.diff - shiftMs)) {
      pick = { diff, startMs: s.startMs };
    }
  }
  return pick;
}

/** Fewest lines on each side of a jump for the place of the jump to be trusted. */
const SPLIT_MIN_SIDE = 3;
const SPLIT_MIN_SHARE = 0.6;

/**
 * A piece of the track in which the shift jumps from `beforeMs` to `afterMs` (a cut scene, an advert
 * break): the last line that still has the first shift and the first line that has the second one.
 * Undefined when the piece does not clearly hold both.
 */
export function alignSplit(
  subCues: Cue[],
  refCues: Cue[],
  beforeMs: number,
  afterMs: number,
): [WindowMatch, WindowMatch] | undefined {
  const refs = refCues.filter(usableRef).sort((p, q) => p.startMs - q.startMs);
  if (refs.length < MIN_USABLE) return undefined;
  const first = refs.map((r) => lineAt(r, subCues, beforeMs));
  const second = refs.map((r) => lineAt(r, subCues, afterMs));
  // Lines 0..k-1 on the first shift, the rest on the second: the k that explains the most lines.
  const secondFrom = new Array<number>(refs.length + 1).fill(0);
  for (let i = refs.length - 1; i >= 0; i--) {
    secondFrom[i] = (secondFrom[i + 1] as number) + (second[i] ? 1 : 0);
  }
  let best = { k: 0, a: 0, b: secondFrom[0] as number };
  let firstUpTo = 0;
  for (let k = 1; k <= refs.length; k++) {
    if (first[k - 1]) firstUpTo++;
    const b = secondFrom[k] as number;
    if (firstUpTo + b > best.a + best.b) best = { k, a: firstUpTo, b };
  }
  if (best.a < SPLIT_MIN_SIDE || best.b < SPLIT_MIN_SIDE) return undefined;
  if (best.a + best.b < SPLIT_MIN_SHARE * refs.length) return undefined;
  const left = first.slice(0, best.k).flatMap((m) => (m ? [m] : []));
  const right = second.slice(best.k).flatMap((m) => (m ? [m] : []));
  const lastLeft = left[left.length - 1] as LineMatch;
  const firstRight = right[0] as LineMatch;
  if (firstRight.startMs <= lastLeft.startMs) return undefined;
  return [
    {
      offsetMs: Math.round(median(left.map((m) => m.diff))),
      matched: left.length,
      usable: left.length,
      atMs: lastLeft.startMs,
    },
    {
      offsetMs: Math.round(median(right.map((m) => m.diff))),
      matched: right.length,
      usable: right.length,
      atMs: firstRight.startMs,
    },
  ];
}

/** Points that lie on one straight line to within this are a steady drift, not jumps. */
const LINE_TOLERANCE_MS = 250;
/** How far outside the first and last point the shift is pinned, so it stays level there. */
const LEVEL_EDGE_MS = 60_000;

/** True when the shift grows steadily along the video (a slightly different speed). */
export function isSteadyDrift(knots: Knot[]): boolean {
  const first = knots[0] as Knot;
  const last = knots[knots.length - 1] as Knot;
  if (knots.length < 3 || last.atMs === first.atMs) return false;
  const slope = (last.offsetMs - first.offsetMs) / (last.atMs - first.atMs);
  return knots.every(
    (k) =>
      Math.abs(first.offsetMs + slope * (k.atMs - first.atMs) - k.offsetMs) <= LINE_TOLERANCE_MS,
  );
}

/**
 * Where a jump most likely is between two points with different shifts: the longest silence of
 * the subtitle between them (a cut or a break does not fall inside a sentence).
 */
function jumpBetween(a: Knot, b: Knot, cues: Cue[]): Knot[] {
  const inside = cues
    .filter((c) => c.startMs >= a.atMs && c.startMs <= b.atMs)
    .sort((p, q) => p.startMs - q.startMs);
  let pick: { before: Cue; after: Cue; gap: number } | undefined;
  for (let i = 1; i < inside.length; i++) {
    const before = inside[i - 1] as Cue;
    const after = inside[i] as Cue;
    const gap = after.startMs - before.endMs;
    if (!pick || gap > pick.gap) pick = { before, after, gap };
  }
  if (!pick) return [];
  const out: Knot[] = [];
  if (pick.before.startMs > a.atMs) out.push({ atMs: pick.before.startMs, offsetMs: a.offsetMs });
  if (pick.after.startMs < b.atMs) out.push({ atMs: pick.after.startMs, offsetMs: b.offsetMs });
  return out;
}

/** The points with the shift pinned level before the first and after the last of them. */
function levelEnds(knots: Knot[]): Knot[] {
  const first = knots[0] as Knot;
  const last = knots[knots.length - 1] as Knot;
  return [
    { atMs: first.atMs - LEVEL_EDGE_MS, offsetMs: first.offsetMs },
    ...knots,
    { atMs: last.atMs + LEVEL_EDGE_MS, offsetMs: last.offsetMs },
  ];
}

/**
 * Jumps instead of slopes: the shift stays level up to each jump, and outside the first and last
 * point. Used when the points do not lie on one line, so the changes are cuts, not a drift.
 */
function withJumps(knots: Knot[], cues: Cue[]): Knot[] {
  const first = knots[0] as Knot;
  const last = knots[knots.length - 1] as Knot;
  const out: Knot[] = [{ atMs: first.atMs - LEVEL_EDGE_MS, offsetMs: first.offsetMs }];
  knots.forEach((k, i) => {
    out.push(k);
    const next = knots[i + 1];
    if (next && Math.abs(next.offsetMs - k.offsetMs) > SAME_SHIFT_MS) {
      out.push(...jumpBetween(k, next, cues));
    }
  });
  out.push({ atMs: last.atMs + LEVEL_EDGE_MS, offsetMs: last.offsetMs });
  return out.filter((k, i) => i === 0 || k.atMs > (out[i - 1] as Knot).atMs);
}

/**
 * One fit from the pieces: a single shift when they agree, otherwise a shift that changes along the
 * video. With the subtitle's own lines (`cues`), changes that are not a steady drift become jumps,
 * each placed in a silence of the subtitle.
 */
export function buildCueFit(matches: WindowMatch[], cues?: Cue[]): TimingFit | undefined {
  if (matches.length < 2) return undefined;
  const sorted = [...matches].sort((p, q) => p.atMs - q.atMs);
  const offsets = sorted.map((m) => m.offsetMs);
  const share = sorted.reduce((s, m) => s + m.matched / m.usable, 0) / sorted.length;
  const parts = sorted.map((m) => ({ atSec: Math.round(m.atMs / 1000), offsetMs: m.offsetMs }));
  const points = sorted.map((m) => ({ atMs: m.atMs, offsetMs: m.offsetMs }));
  const spread = Math.max(...offsets) - Math.min(...offsets);
  if (spread <= SAME_SHIFT_MS) {
    const one = {
      scale: 1,
      offsetMs: Math.round(median(offsets)),
      score: share,
      baseline: 0,
      parts,
    };
    // Pieces a little apart: each part of the video gets the shift of the pieces around it.
    return spread <= FINE_SHIFT_MS ? one : { ...one, knots: levelEnds(points) };
  }
  const knots =
    cues && points.length >= 3 && !isSteadyDrift(points) ? withJumps(points, cues) : points;
  return { scale: 1, offsetMs: offsets[0] as number, score: share, baseline: 0, knots, parts };
}
