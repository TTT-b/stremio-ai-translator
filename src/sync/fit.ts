import type { Cue } from '../subtitles/types';

/**
 * Finds how a subtitle's timing differs from the real speech of the video, as a constant offset
 * plus (rarely) a frame-rate stretch, and moves every cue to fix it. It compares only WHEN there is
 * speech with WHEN the subtitle is shown: no words, so it works in every language.
 *
 * A fit is returned only when it is clearly better than leaving the subtitle alone. Anything
 * unclear returns undefined, and the caller keeps the subtitle exactly as it was.
 */

/** One frame of the speech signal, in milliseconds. */
export const FRAME_MS = 50;

const FPS = [23.976, 24, 25, 29.97, 30];

/** Stretches a subtitle made for one frame rate gets on a video of another (1 = none). */
export const SCALE_CANDIDATES: readonly number[] = (() => {
  const byKey = new Map<number, number>([[10000, 1]]);
  for (const x of FPS) {
    for (const y of FPS) {
      const r = x / y;
      if (r > 0.95 && r < 1.05 && !byKey.has(Math.round(r * 10000))) {
        byKey.set(Math.round(r * 10000), r);
      }
    }
  }
  return [...byKey.values()].sort((p, q) => p - q);
})();

export interface FitOptions {
  /** Largest shift looked for either way (default 40 s). */
  maxOffsetMs?: number;
  /** Lowest agreement score to accept (default 0.10). */
  minScore?: number;
  /** How much better than the untouched subtitle the score must be (default 0.04). */
  minGain?: number;
  /** A wrong peak must stay below this share of the best score (default 0.85). */
  maxRunnerUp?: number;
}

export interface TimingFit {
  /** new time = scale * old time + offsetMs */
  scale: number;
  offsetMs: number;
  /** Agreement of the fitted subtitle with the speech, -1..1. */
  score: number;
  /** Agreement of the untouched subtitle, for comparison. */
  baseline: number;
}

interface Curve {
  scale: number;
  /** Agreement score for each shift, index 0 = -maxLag. */
  r: Float64Array;
}

function activity(cues: Cue[], scale: number, frames: number): Uint8Array {
  const sub = new Uint8Array(frames);
  for (const c of cues) {
    const a = Math.max(0, Math.floor((c.startMs * scale) / FRAME_MS));
    const b = Math.min(frames, Math.ceil((c.endMs * scale) / FRAME_MS));
    for (let i = a; i < b; i++) sub[i] = 1;
  }
  return sub;
}

/** Agreement (a correlation between two on/off signals) for every shift in -maxLag..maxLag frames. */
function curve(
  sub: Uint8Array,
  speech: Uint8Array,
  speechOn: number,
  maxLag: number,
): Float64Array {
  const n = speech.length;
  const ones: number[] = [];
  for (let i = 0; i < sub.length; i++) if (sub[i]) ones.push(i);
  const subOn = ones.length;
  const out = new Float64Array(2 * maxLag + 1);
  if (subOn === 0 || speechOn === 0) return out;
  const ps = subOn / n;
  const pv = speechOn / n;
  const denom = Math.sqrt(ps * (1 - ps) * pv * (1 - pv));
  if (denom === 0) return out;
  const idx = Int32Array.from(ones);
  for (let k = 0; k <= 2 * maxLag; k++) {
    const lag = k - maxLag;
    let n11 = 0;
    for (let j = 0; j < idx.length; j++) {
      const t = (idx[j] as number) + lag;
      if (t >= 0 && t < n && speech[t]) n11++;
    }
    out[k] = (n11 / n - ps * pv) / denom;
  }
  return out;
}

function peak(r: Float64Array): { k: number; v: number } {
  let k = 0;
  for (let i = 1; i < r.length; i++) if ((r[i] as number) > (r[k] as number)) k = i;
  return { k, v: r[k] as number };
}

/**
 * @param cues the subtitle's cues, with the timing to be checked
 * @param speech one entry per FRAME_MS of the video: 1 where someone is talking, else 0
 */
export function fitTiming(
  cues: Cue[],
  speech: Uint8Array,
  opts: FitOptions = {},
): TimingFit | undefined {
  const minScore = opts.minScore ?? 0.1;
  const minGain = opts.minGain ?? 0.04;
  const maxRunnerUp = opts.maxRunnerUp ?? 0.85;
  const maxLag = Math.round((opts.maxOffsetMs ?? 40_000) / FRAME_MS);
  if (cues.length < 20 || speech.length < 400) return undefined;
  let speechOn = 0;
  for (let i = 0; i < speech.length; i++) if (speech[i]) speechOn++;

  const curves: Curve[] = SCALE_CANDIDATES.map((scale) => ({
    scale,
    r: curve(activity(cues, scale, speech.length), speech, speechOn, maxLag),
  }));
  const plain = curves.find((c) => c.scale === 1) as Curve;
  const baseline = plain.r[maxLag] as number;

  // The best shift of every stretch; an odd stretch is chosen only when it clearly beats no stretch.
  const none = { scale: 1, ...peak(plain.r) };
  let stretched: { scale: number; k: number; v: number } | undefined;
  for (const c of curves) {
    if (c.scale === 1) continue;
    const p = peak(c.r);
    if (!stretched || p.v > stretched.v) stretched = { scale: c.scale, ...p };
  }
  const best = stretched && stretched.v > none.v + 0.02 ? stretched : none;
  if (best.v < minScore) return undefined;

  const chosen = curves.find((c) => c.scale === best.scale) as Curve;
  // The runner-up: the best agreement away from the winning shift (a repeating pattern has many).
  const away = Math.round(1000 / FRAME_MS);
  let second = -1;
  for (let k = 0; k < chosen.r.length; k++) {
    if (Math.abs(k - best.k) > away && (chosen.r[k] as number) > second)
      second = chosen.r[k] as number;
  }
  if (second > best.v * maxRunnerUp) return undefined;

  // Between two frames: the top of a parabola through the three scores around the peak.
  let lag = best.k - maxLag;
  const lo = chosen.r[best.k - 1];
  const hi = chosen.r[best.k + 1];
  if (lo !== undefined && hi !== undefined) {
    const d = lo - 2 * best.v + hi;
    if (d < 0) lag += Math.max(-0.5, Math.min(0.5, (0.5 * (lo - hi)) / d));
  }
  const offsetMs = Math.round(lag * FRAME_MS);

  const unchanged = best.scale === 1 && Math.abs(offsetMs) < 100;
  if (!unchanged && best.v - baseline < minGain) return undefined;
  return { scale: best.scale, offsetMs, score: best.v, baseline };
}

/** The cues moved by a fit. Text, order and count stay as they were. */
export function applyFit(cues: Cue[], fit: TimingFit): Cue[] {
  return cues.map((c) => {
    const startMs = Math.max(0, Math.round(c.startMs * fit.scale + fit.offsetMs));
    const endMs = Math.max(startMs + 1, Math.round(c.endMs * fit.scale + fit.offsetMs));
    return { ...c, startMs, endMs };
  });
}
