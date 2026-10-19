import { describe, expect, it } from 'vitest';
import { applyFit, fitTiming, FRAME_MS, SCALE_CANDIDATES } from '../src/sync/fit';
import type { Cue } from '../src/subtitles/types';

/** Small repeatable random numbers, so every run sees the same video. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up film: the cues as they really are (the truth), and the speech they were spoken in. */
function film(minutes: number, seed: number) {
  const rand = rng(seed);
  const cues: Cue[] = [];
  let t = 20_000;
  const end = minutes * 60_000;
  while (t < end) {
    const len = 1200 + rand() * 2800;
    cues.push({
      index: cues.length + 1,
      startMs: Math.round(t),
      endMs: Math.round(t + len),
      text: 'x',
    });
    t += len + 400 + rand() * 8600;
  }
  const frames = Math.ceil(end / FRAME_MS) + 200;
  const speech = new Uint8Array(frames);
  const mark = (fromMs: number, toMs: number) => {
    for (
      let i = Math.max(0, Math.floor(fromMs / FRAME_MS));
      i < Math.min(frames, Math.ceil(toMs / FRAME_MS));
      i++
    )
      speech[i] = 1;
  };
  for (const c of cues) {
    if (rand() < 0.1) continue; // sung or foreign: spoken but not in this subtitle, or not heard
    mark(c.startMs - 100 + rand() * 200, c.endMs + rand() * 300);
  }
  // music and effects that look like speech
  for (let m = 30_000; m < end; m += 40_000 + rand() * 40_000) mark(m, m + 1000 + rand() * 5000);
  return { cues, speech };
}

/** The subtitle of a different release: its times are scale * true + offset. */
function distort(cues: Cue[], scale: number, offsetMs: number): Cue[] {
  return cues.map((c) => ({
    ...c,
    startMs: Math.round(c.startMs * scale + offsetMs),
    endMs: Math.round(c.endMs * scale + offsetMs),
  }));
}

function within(fixed: Cue[], truth: Cue[], ms: number): number {
  let ok = 0;
  fixed.forEach((c, i) => {
    if (Math.abs(c.startMs - (truth[i] as Cue).startMs) <= ms) ok++;
  });
  return ok / fixed.length;
}

describe('fitTiming on a made-up film with a known error', () => {
  const { cues: truth, speech } = film(90, 7);

  it.each([
    ['5 s late', 1, 5000],
    ['12 s early', 1, -12_400],
    ['almost right (0.8 s)', 1, 800],
    ['25 s late', 1, 25_000],
    ['25 fps subtitle on a 23.976 video, 3 s late', 25 / 23.976, 3000],
    ['23.976 fps subtitle on a 25 fps video, 5 s early', 23.976 / 25, -5000],
  ])('finds the error: %s', (_name, scale, offsetMs) => {
    const wrong = distort(truth, scale, offsetMs);
    const fit = fitTiming(wrong, speech);
    expect(fit).toBeDefined();
    const fixed = applyFit(wrong, fit!);
    expect(within(fixed, truth, 150)).toBeGreaterThanOrEqual(0.95);
    expect(within(fixed, truth, 300)).toBeGreaterThanOrEqual(0.99);
  });

  it('leaves a correct subtitle where it is', () => {
    const fit = fitTiming(truth, speech);
    const result = fit ? applyFit(truth, fit) : truth;
    expect(within(result, truth, 100)).toBe(1);
  });

  it('keeps text, order and count', () => {
    const wrong = distort(truth, 1, 4000);
    const fixed = applyFit(wrong, fitTiming(wrong, speech)!);
    expect(fixed.map((c) => c.text)).toEqual(wrong.map((c) => c.text));
    expect(fixed.map((c) => c.index)).toEqual(wrong.map((c) => c.index));
    for (let i = 1; i < fixed.length; i++)
      expect((fixed[i] as Cue).startMs).toBeGreaterThanOrEqual((fixed[i - 1] as Cue).startMs);
  });

  it('takes only a few seconds for a long film', () => {
    const long = film(150, 11);
    const wrong = distort(long.cues, 1, 6000);
    const t0 = Date.now();
    fitTiming(wrong, long.speech);
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});

describe('fitTiming refuses when it is not sure (the subtitle stays as it is)', () => {
  it('speech that does not belong to this subtitle', () => {
    const a = film(90, 21);
    const b = film(90, 99);
    expect(fitTiming(a.cues, b.speech)).toBeUndefined();
  });

  it('a repeating pattern with many equally good answers', () => {
    const frames = 90 * 60 * 20;
    const speech = new Uint8Array(frames);
    const cues: Cue[] = [];
    for (let t = 10_000; t < 90 * 60_000; t += 4000) {
      cues.push({ index: cues.length + 1, startMs: t, endMs: t + 2000, text: 'x' });
      for (let i = Math.floor((t + 1300) / FRAME_MS); i < Math.ceil((t + 3300) / FRAME_MS); i++)
        speech[i] = 1;
    }
    expect(fitTiming(cues, speech)).toBeUndefined();
  });

  it('no speech at all, or too few cues', () => {
    const { cues, speech } = film(90, 5);
    expect(fitTiming(cues, new Uint8Array(speech.length))).toBeUndefined();
    expect(fitTiming(cues.slice(0, 10), speech)).toBeUndefined();
  });
});

describe('scale candidates', () => {
  it('are the known frame-rate ratios, and include no stretch', () => {
    expect(SCALE_CANDIDATES).toContain(1);
    expect(SCALE_CANDIDATES.some((s) => Math.abs(s - 25 / 23.976) < 1e-6)).toBe(true);
    expect(SCALE_CANDIDATES.some((s) => Math.abs(s - 23.976 / 25) < 1e-6)).toBe(true);
    for (const s of SCALE_CANDIDATES) expect(s).toBeGreaterThan(0.95);
  });
});
