import { describe, expect, it } from 'vitest';
import { applyFit } from '../src/sync/fit';
import { fitSubtitleToEmbeddedCues, type ReadPiece } from '../src/sync/cueFit';
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

const stamp = (ms: number): string => {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const toSrt = (cues: Cue[]): string =>
  cues.map((c, i) => `${i + 1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.text}\n`).join('\n');

const tracks = (language: string) =>
  Buffer.from(
    JSON.stringify({
      streams: [{ index: 3, codec_name: 'subrip', tags: { language, title: 'English' } }],
    }),
  );

/** Stands in for ffmpeg: the lines of the video's own track between two times. */
const piecesOf =
  (real: Cue[], asked: number[]): ReadPiece =>
  async ({ fromSec, toSec }) => {
    asked.push(fromSec);
    return toSrt(real.filter((c) => c.startMs >= fromSec * 1000 && c.startMs < toSec * 1000));
  };

const base = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', url: 'http://x/y', language: 'en' };

describe('fitSubtitleToEmbeddedCues', () => {
  const sub = subtitle(24, 5);
  const signal = new AbortController().signal;
  const exec = async () => tracks('eng');

  it('reads two short pieces and finds one shift', async () => {
    const real = sub.map((c) => ({ ...c, startMs: c.startMs + 37_000, endMs: c.endMs + 37_000 }));
    const asked: number[] = [];
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec,
      readPiece: piecesOf(real, asked),
    });
    expect(asked).toHaveLength(2);
    expect(Math.abs((fit?.offsetMs ?? 0) - 37_000)).toBeLessThan(150);
    expect(fit?.knots).toBeUndefined();
  });

  it('reads more pieces where the shift changes, and follows it', async () => {
    // right until 12 minutes, then 2.5 seconds late
    const real = sub.map((c) => {
      const off = c.startMs < 720_000 ? 500 : 3000;
      return { ...c, startMs: c.startMs + off, endMs: c.endMs + off };
    });
    const asked: number[] = [];
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec,
      readPiece: piecesOf(real, asked),
    });
    expect(asked.length).toBeGreaterThan(2);
    expect(fit?.knots?.length).toBeGreaterThanOrEqual(3);
    const moved = applyFit(sub, fit!);
    const far = moved.filter((_, i) => {
      const t = (sub[i] as Cue).startMs;
      return t < 500_000 || t > 950_000;
    });
    const worst = Math.max(
      ...far.map((c) => {
        const i = moved.indexOf(c);
        return Math.abs(c.startMs - (real[i] as Cue).startMs);
      }),
    );
    expect(worst).toBeLessThan(700);
  });

  it('tries other places when one piece falls on a part that does not match', async () => {
    const real = sub.map((c) => ({ ...c, startMs: c.startMs + 38_000, endMs: c.endMs + 38_000 }));
    const asked: number[] = [];
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec,
      // the piece near 75% of the video has only unrelated lines (a song, say)
      readPiece: async (o) => {
        asked.push(o.fromSec);
        const lines = o.fromSec > 900 ? subtitle(24, 99) : real;
        return toSrt(
          lines.filter((c) => c.startMs >= o.fromSec * 1000 && c.startMs < o.toSec * 1000),
        );
      },
    });
    expect(asked.length).toBeGreaterThan(2);
    expect(Math.abs((fit?.offsetMs ?? 0) - 38_000)).toBeLessThan(150);
  });

  it('has nothing to say when the video has no track in that language', async () => {
    const asked: number[] = [];
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec: async () => tracks('jpn'),
      readPiece: piecesOf(sub, asked),
    });
    expect(fit).toBeUndefined();
    expect(asked).toHaveLength(0);
  });

  it('has nothing to say when the track does not match the subtitle', async () => {
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec,
      readPiece: piecesOf(subtitle(24, 99), []),
    });
    expect(fit).toBeUndefined();
  });

  it('has nothing to say when the track cannot be read', async () => {
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: sub,
      signal,
      exec,
      readPiece: async () => {
        throw new Error('exit 1');
      },
    });
    expect(fit).toBeUndefined();
  });
});

describe('fitSubtitleToEmbeddedCues on a film (frame rate and jumps)', () => {
  const film = subtitle(110, 21);
  const signal = new AbortController().signal;
  const exec = async () => tracks('eng');
  /** Share of lines that end up within 150 ms of where the video has them. */
  const exactShare = (moved: Cue[], real: Cue[]): number =>
    moved.filter((c, i) => Math.abs(c.startMs - (real[i] as Cue).startMs) <= 150).length /
    moved.length;
  const run = async (real: Cue[]) => {
    const asked: number[] = [];
    const fit = await fitSubtitleToEmbeddedCues({
      ...base,
      cues: film,
      signal,
      exec,
      readPiece: piecesOf(real, asked),
    });
    return { fit, asked };
  };

  it.each([
    ['25 fps subtitle on a 23.976 video', 25 / 23.976],
    ['23.976 fps subtitle on a 25 video', 23.976 / 25],
    ['24 fps subtitle on a 23.976 video', 24 / 23.976],
  ])('finds the stretch of a %s from three pieces', async (_name, ratio) => {
    const real = film.map((c) => ({
      ...c,
      startMs: Math.round(c.startMs * ratio + 1500),
      endMs: Math.round(c.endMs * ratio + 1500),
    }));
    const { fit, asked } = await run(real);
    expect(fit?.scale).toBeCloseTo(ratio, 3);
    expect(fit?.knots).toBeUndefined();
    expect(asked.length).toBeLessThanOrEqual(4);
    expect(exactShare(applyFit(film, fit!), real)).toBe(1);
  });

  it('finds the exact place of one jump (a scene the video has and the subtitle does not)', async () => {
    const jumpAt = film[Math.floor(film.length * 0.4)]!.startMs;
    const real = film.map((c) => {
      const off = c.startMs < jumpAt ? 1000 : 9000;
      return { ...c, startMs: c.startMs + off, endMs: c.endMs + off };
    });
    const { fit, asked } = await run(real);
    expect(fit?.scale).toBe(1);
    expect(asked.length).toBeLessThanOrEqual(10);
    expect(exactShare(applyFit(film, fit!), real)).toBeGreaterThanOrEqual(0.995);
  });

  it('follows two jumps, and keeps the shift level before the first and after the last', async () => {
    const first = film[Math.floor(film.length * 0.3)]!.startMs;
    const second = film[Math.floor(film.length * 0.7)]!.startMs;
    const real = film.map((c) => {
      const off = c.startMs < first ? 0 : c.startMs < second ? 5000 : 17_000;
      return { ...c, startMs: c.startMs + off, endMs: c.endMs + off };
    });
    const { fit } = await run(real);
    const moved = applyFit(film, fit!);
    expect(exactShare(moved, real)).toBeGreaterThanOrEqual(0.97);
    // the opening and the ending are far from any piece that was read
    expect(Math.abs(moved[0]!.startMs - real[0]!.startMs)).toBeLessThanOrEqual(150);
    const last = moved.length - 1;
    expect(Math.abs(moved[last]!.startMs - real[last]!.startMs)).toBeLessThanOrEqual(150);
  });

  it('does not take a jump for a frame-rate stretch', async () => {
    // 3.3 s between the first two pieces is what a 24 / 23.976 stretch would give; here it is a jump
    const jumpAt = film[Math.floor(film.length * 0.5)]!.startMs;
    const real = film.map((c) => {
      const off = c.startMs < jumpAt ? 0 : 3300;
      return { ...c, startMs: c.startMs + off, endMs: c.endMs + off };
    });
    const { fit } = await run(real);
    expect(fit?.scale).toBe(1);
    expect(exactShare(applyFit(film, fit!), real)).toBeGreaterThanOrEqual(0.995);
  });
});
