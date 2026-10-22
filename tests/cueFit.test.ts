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
