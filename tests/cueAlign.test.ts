import { describe, expect, it } from 'vitest';
import { alignWindow, buildCueFit, offsetAt } from '../src/sync/cueAlign';
import { applyFit } from '../src/sync/fit';
import type { Cue } from '../src/subtitles/types';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = [
  'house',
  'dragon',
  'sword',
  'friend',
  'magic',
  'battle',
  'island',
  'promise',
  'night',
];

/** A made-up subtitle: lines of a few words at uneven gaps. */
function subtitle(minutes: number, seed: number): Cue[] {
  const rand = rng(seed);
  const cues: Cue[] = [];
  let t = 20_000;
  while (t < minutes * 60_000) {
    const len = 1200 + rand() * 2500;
    const text = Array.from({ length: 4 }, () => WORDS[Math.floor(rand() * WORDS.length)]).join(
      ' ',
    );
    cues.push({ index: cues.length + 1, startMs: Math.round(t), endMs: Math.round(t + len), text });
    t += len + 500 + rand() * 6000;
  }
  return cues;
}

const shift = (cues: Cue[], offset: (c: Cue) => number): Cue[] =>
  cues.map((c) => ({ ...c, startMs: c.startMs + offset(c), endMs: c.endMs + offset(c) }));

const between = (cues: Cue[], from: number, to: number): Cue[] =>
  cues.filter((c) => c.startMs >= from && c.startMs < to);

describe('alignWindow', () => {
  const sub = subtitle(24, 5);

  it('finds a shift of 37 seconds from two minutes of the video track', () => {
    const real = shift(sub, () => 37_000);
    const hit = alignWindow(sub, between(real, 600_000, 720_000));
    expect(hit).toBeDefined();
    expect(Math.abs(hit!.offsetMs - 37_000)).toBeLessThan(150);
    expect(hit!.matched).toBeGreaterThanOrEqual(6);
  });

  it('copes with a track that has other wording and some missing lines', () => {
    const rand = rng(11);
    const real = shift(sub, () => -4000)
      .filter(() => rand() > 0.2)
      .map((c) => ({ ...c, text: rand() > 0.5 ? 'something else entirely' : c.text }));
    const hit = alignWindow(sub, between(real, 300_000, 420_000));
    expect(hit).toBeDefined();
    expect(Math.abs(hit!.offsetMs + 4000)).toBeLessThan(150);
  });

  it('says nothing when the track is another film', () => {
    const other = subtitle(24, 77);
    expect(alignWindow(sub, between(other, 600_000, 720_000))).toBeUndefined();
  });

  it('ignores flashes and typeset signs of an anime track', () => {
    const real = shift(sub, () => 2000);
    const noisy = [
      ...between(real, 600_000, 720_000),
      ...Array.from({ length: 40 }, (_, i) => ({
        index: 900 + i,
        startMs: 600_000 + i * 2900,
        endMs: 600_000 + i * 2900 + 100,
        text: '{\\pos(10,10)}x',
      })),
    ];
    const hit = alignWindow(sub, noisy);
    expect(Math.abs((hit?.offsetMs ?? 0) - 2000)).toBeLessThan(150);
  });
});

describe('buildCueFit', () => {
  const sub = subtitle(24, 9);

  it('uses one shift when the pieces agree', () => {
    const real = shift(sub, () => 5000);
    const a = alignWindow(sub, between(real, 300_000, 420_000))!;
    const b = alignWindow(sub, between(real, 1_000_000, 1_120_000))!;
    const fit = buildCueFit([a, b])!;
    expect(fit.knots).toBeUndefined();
    expect(Math.abs(fit.offsetMs - 5000)).toBeLessThan(150);
  });

  it('follows a shift that grows along the video', () => {
    // 1 second late at the start, 3.5 seconds late at the end
    const real = shift(sub, (c) => 1000 + (2500 * c.startMs) / 1_440_000);
    const points = [300_000, 650_000, 1_100_000].map((from) =>
      alignWindow(sub, between(real, from, from + 120_000))!,
    );
    const fit = buildCueFit(points)!;
    expect(fit.knots).toHaveLength(3);
    const moved = applyFit(sub, fit);
    const worst = Math.max(...moved.map((c, i) => Math.abs(c.startMs - (real[i] as Cue).startMs)));
    expect(worst).toBeLessThan(600);
  });

  it('needs two pieces', () => {
    const real = shift(sub, () => 1000);
    const a = alignWindow(sub, between(real, 300_000, 420_000))!;
    expect(buildCueFit([a])).toBeUndefined();
  });
});

describe('offsetAt', () => {
  const knots = [
    { atMs: 100_000, offsetMs: 1000 },
    { atMs: 200_000, offsetMs: 2000 },
  ];
  it('is in proportion between the points and keeps going past them', () => {
    expect(offsetAt(knots, 150_000)).toBeCloseTo(1500);
    expect(offsetAt(knots, 300_000)).toBeCloseTo(3000);
    expect(offsetAt(knots, 0)).toBeCloseTo(0);
  });
  it('never lets the shift change faster than a frame-rate mismatch would', () => {
    const steep = [
      { atMs: 100_000, offsetMs: 0 },
      { atMs: 110_000, offsetMs: 9000 },
    ];
    expect(offsetAt(steep, 210_000)).toBeLessThanOrEqual(9000 + 0.05 * 100_000 + 1);
  });
});
