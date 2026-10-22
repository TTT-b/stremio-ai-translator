import { describe, expect, it } from 'vitest';
import { applyFit, FRAME_MS } from '../src/sync/fit';
import type { Cue } from '../src/subtitles/types';
import { fitSubtitleToVideo, pickWindows } from '../src/sync/videoFit';
import type { detectSpeech } from '../src/sync/speech';

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A made-up film: its true cues and the loudness of every frame of its sound. */
function film(minutes: number, seed: number) {
  const rand = rng(seed);
  const cues: Cue[] = [];
  let t = 15_000;
  const end = minutes * 60_000;
  while (t < end) {
    const len = 1200 + rand() * 2800;
    cues.push({
      index: cues.length + 1,
      startMs: Math.round(t),
      endMs: Math.round(t + len),
      text: 'x',
    });
    t += len + 400 + rand() * 7600;
  }
  const db = Array.from({ length: Math.ceil(end / FRAME_MS) + 400 }, (_, i) => -58 + ((i * 7) % 5));
  for (const c of cues) {
    if (rand() < 0.1) continue;
    const a = Math.floor((c.startMs - 80 + rand() * 160) / FRAME_MS);
    const b = Math.ceil((c.endMs + rand() * 200) / FRAME_MS);
    for (let i = Math.max(0, a); i < b; i++) db[i] = -22 + ((i * 3) % 6);
  }
  return { cues, db };
}

/** Stands in for ffmpeg: hands out only the asked piece of the film's sound. */
const fakeDetect =
  (db: number[], asked: { startSec: number; durationSec: number }[]): typeof detectSpeech =>
  async (_ffmpeg, _url, _signal, _progress, window) => {
    const w = window as { startSec: number; durationSec: number };
    asked.push(w);
    const from = Math.round((w.startSec * 1000) / FRAME_MS);
    const loudness = db.slice(from, from + Math.round((w.durationSec * 1000) / FRAME_MS));
    return { loudness, speech: new Uint8Array(loudness.length), seconds: w.durationSec };
  };

const shifted = (cues: Cue[], off: number): Cue[] =>
  cues.map((c) => ({ ...c, startMs: c.startMs + off, endMs: c.endMs + off }));

describe('fitSubtitleToVideo', { timeout: 30_000 }, () => {
  const { cues: truth, db } = film(40, 3);
  const base = { ffmpeg: 'ffmpeg', url: 'http://x/y', signal: new AbortController().signal };

  it('finds the shift from three short pieces, not the whole video', async () => {
    const asked: { startSec: number; durationSec: number }[] = [];
    const wrong = shifted(truth, 9000);
    const fit = await fitSubtitleToVideo({ ...base, cues: wrong, detect: fakeDetect(db, asked) });
    expect(asked).toHaveLength(3);
    const heard = asked.reduce((s, w) => s + w.durationSec, 0);
    expect(heard).toBeLessThan(0.6 * 40 * 60);
    expect(fit).toBeDefined();
    const fixed = applyFit(wrong, fit!);
    const bad = fixed.filter((c, i) => Math.abs(c.startMs - (truth[i] as Cue).startMs) > 300);
    expect(bad.length / fixed.length).toBeLessThan(0.02);
  });

  it('reports what is left off in each piece: about nothing for a plain shift', async () => {
    const fit = await fitSubtitleToVideo({
      ...base,
      cues: shifted(truth, 9000),
      detect: fakeDetect(db, []),
    });
    expect(fit?.parts).toHaveLength(3);
    for (const p of fit!.parts!) expect(Math.abs(p.offsetMs ?? 99_999)).toBeLessThan(400);
  });

  it('shows a shift that changes during the video in the pieces', async () => {
    // the first half of the subtitle is 9 s early, the second half 12 s: one shift cannot fit both
    const half = truth.length / 2;
    const bent = truth.map((c, i) => {
      const off = i < half ? 9000 : 12_000;
      return { ...c, startMs: c.startMs + off, endMs: c.endMs + off };
    });
    const fit = await fitSubtitleToVideo({ ...base, cues: bent, detect: fakeDetect(db, []) });
    if (!fit) return; // not sure is an allowed answer; a wrong confident one is not tested here
    const lefts = fit.parts!.map((p) => p.offsetMs);
    expect(lefts.some((v) => v === null || Math.abs(v) > 1000)).toBe(true);
  });

  it('leaves alone a subtitle that is already right', async () => {
    const fit = await fitSubtitleToVideo({ ...base, cues: truth, detect: fakeDetect(db, []) });
    const result = fit ? applyFit(truth, fit) : truth;
    expect(result.every((c, i) => Math.abs(c.startMs - (truth[i] as Cue).startMs) <= 100)).toBe(
      true,
    );
  });

  it('is not sure about the sound of another film', async () => {
    const other = film(40, 91);
    const fit = await fitSubtitleToVideo({
      ...base,
      cues: shifted(truth, 5000),
      detect: fakeDetect(other.db, []),
    });
    expect(fit).toBeUndefined();
  });

  it('never listens to the opening, and the pieces do not overlap', async () => {
    const asked: { startSec: number; durationSec: number }[] = [];
    await fitSubtitleToVideo({
      ...base,
      cues: shifted(truth, 4000),
      detect: fakeDetect(db, asked),
    });
    const sorted = [...asked].sort((a, b) => a.startSec - b.startSec);
    expect(sorted[0]!.startSec).toBeGreaterThanOrEqual(120);
    sorted.slice(1).forEach((w, i) => {
      expect(w.startSec).toBeGreaterThanOrEqual(sorted[i]!.startSec + sorted[i]!.durationSec);
    });
  });

  it('moves a piece to where there is more dialogue', () => {
    const quiet: Cue[] = Array.from({ length: 30 }, (_, i) => ({
      index: i + 1,
      startMs: i * 4000,
      endMs: i * 4000 + 500,
      text: 'x',
    }));
    const busy: Cue[] = Array.from({ length: 120 }, (_, i) => ({
      index: 31 + i,
      startMs: 700_000 + i * 2000,
      endMs: 700_000 + i * 2000 + 1800,
      text: 'x',
    }));
    const [start] = pickWindows([...quiet, ...busy], [0.5], 240, 1500, []);
    expect(start!).toBeGreaterThan(630);
    expect(start!).toBeLessThanOrEqual(750);
  });

  it('listens to more pieces when the first ones were not clear, then decides on all of them', async () => {
    const asked: { startSec: number; durationSec: number }[] = [];
    const noise = film(40, 91).db;
    const real = fakeDetect(db, asked);
    const noisy = fakeDetect(noise, asked);
    let calls = 0;
    const detect: typeof detectSpeech = (...args) => (calls++ < 3 ? noisy(...args) : real(...args));
    const wrong = shifted(truth, 9000);
    const fit = await fitSubtitleToVideo({ ...base, cues: wrong, detect });
    expect(asked.length).toBeGreaterThan(3);
    expect(fit).toBeDefined();
    expect(Math.abs(fit!.offsetMs + 9000)).toBeLessThan(300);
  });

  it('does nothing for a very short or tiny subtitle', async () => {
    expect(
      await fitSubtitleToVideo({ ...base, cues: truth.slice(0, 10), detect: fakeDetect(db, []) }),
    ).toBeUndefined();
  });
});
