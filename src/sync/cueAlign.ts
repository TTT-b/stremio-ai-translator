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

/** One fit from the pieces: a single shift when they agree, otherwise a shift that changes along the video. */
export function buildCueFit(matches: WindowMatch[]): TimingFit | undefined {
  if (matches.length < 2) return undefined;
  const sorted = [...matches].sort((p, q) => p.atMs - q.atMs);
  const offsets = sorted.map((m) => m.offsetMs);
  const share = sorted.reduce((s, m) => s + m.matched / m.usable, 0) / sorted.length;
  const parts = sorted.map((m) => ({ atSec: Math.round(m.atMs / 1000), offsetMs: m.offsetMs }));
  if (Math.max(...offsets) - Math.min(...offsets) <= SAME_SHIFT_MS) {
    return { scale: 1, offsetMs: Math.round(median(offsets)), score: share, baseline: 0, parts };
  }
  const knots = sorted.map((m) => ({ atMs: m.atMs, offsetMs: m.offsetMs }));
  return { scale: 1, offsetMs: offsets[0] as number, score: share, baseline: 0, knots, parts };
}
