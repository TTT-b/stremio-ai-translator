import type { Cue } from '../subtitles/types';
import { FRAME_MS, type TimingFit } from './fit';
import { detectSpeech, fitAcrossLevels } from './speech';

/**
 * Checks a subtitle against the sound of the playing video by listening to a few short pieces
 * (not the whole video), and returns how to move it, or undefined when it is not sure.
 */

/** Where the pieces are looked for, as a share of the subtitle's length (the second round differs). */
const FIRST_ROUND = [0.1, 0.45, 0.8];
const SECOND_ROUND = [0.25, 0.62, 0.92];
const MIN_WINDOW_SEC = 240;
const MAX_WINDOW_SEC = 420;
/** Skipped at the start: an opening song says nothing about when people speak. */
const INTRO_SKIP_SEC = 120;
/** How far (share of the length) and in what steps a piece may move to find more dialogue. */
const SEARCH_SPAN = 0.08;
const SEARCH_STEP_SEC = 15;
/** The subtitle may be this much off; the sound array has room for it. */
const MARGIN_SEC = 100;
const DEAD_DB = -120;
/** The first round fills this share of the progress bar, the second round the rest. */
const FIRST_ROUND_SHARE = 0.6;

export interface VideoFitOptions {
  ffmpeg: string;
  url: string;
  cues: Cue[];
  signal: AbortSignal;
  /** Share of the listening done, 0..100. */
  onProgress?: (percent: number) => void;
  /** Reads one piece of the video's sound; replaced in tests. */
  detect?: typeof detectSpeech;
}

interface Span {
  from: number;
  to: number;
}

/** Seconds of subtitle speech inside [from, to). More dialogue = a better piece to listen to. */
function speechSeconds(cues: Cue[], from: number, to: number): number {
  let total = 0;
  for (const c of cues) {
    const a = Math.max(c.startMs / 1000, from);
    const b = Math.min(c.endMs / 1000, to);
    if (b > a) total += b - a;
  }
  return total;
}

/**
 * Picks where to listen: near each wanted place, the piece with the most dialogue, never inside
 * the opening and never overlapping a piece already taken.
 */
export function pickWindows(
  cues: Cue[],
  shares: readonly number[],
  windowSec: number,
  lengthSec: number,
  taken: Span[],
): number[] {
  const lowest = Math.min(INTRO_SKIP_SEC, Math.max(0, lengthSec - windowSec));
  const highest = Math.max(lowest, lengthSec - windowSec);
  const starts: number[] = [];
  for (const share of shares) {
    const centre = lengthSec * share - windowSec / 2;
    const reach = lengthSec * SEARCH_SPAN;
    let best: { at: number; score: number } | undefined;
    for (let at = centre - reach; at <= centre + reach; at += SEARCH_STEP_SEC) {
      const from = Math.max(lowest, Math.min(highest, at));
      const to = from + windowSec;
      if (taken.some((t) => from < t.to && to > t.from)) continue;
      const score = speechSeconds(cues, from, to);
      if (!best || score > best.score) best = { at: from, score };
    }
    if (!best) continue;
    taken.push({ from: best.at, to: best.at + windowSec });
    starts.push(best.at);
  }
  return starts;
}

export async function fitSubtitleToVideo(opts: VideoFitOptions): Promise<TimingFit | undefined> {
  const detect = opts.detect ?? detectSpeech;
  const lengthSec = Math.max(...opts.cues.map((c) => c.endMs), 0) / 1000;
  if (opts.cues.length < 20 || lengthSec < 300) return undefined;

  const windowSec = Math.min(MAX_WINDOW_SEC, Math.max(MIN_WINDOW_SEC, lengthSec * 0.14));
  const frames = Math.ceil(((lengthSec + MARGIN_SEC) * 1000) / FRAME_MS);
  const loudness = new Array<number>(frames).fill(DEAD_DB);
  const mask = new Uint8Array(frames);
  const taken: Span[] = [];

  /** Listens to one round of pieces; the progress bar covers [low, high] of 0..1. */
  const listen = async (shares: readonly number[], low: number, high: number): Promise<void> => {
    const starts = pickWindows(opts.cues, shares, windowSec, lengthSec, taken);
    let done = 0;
    for (const startSec of starts) {
      const scan = await detect(
        opts.ffmpeg,
        opts.url,
        opts.signal,
        (sec) => {
          const part = (done + Math.min(1, sec / windowSec)) / starts.length;
          opts.onProgress?.(Math.round((low + (high - low) * part) * 100));
        },
        { startSec, durationSec: windowSec },
      );
      const first = Math.round((startSec * 1000) / FRAME_MS);
      scan.loudness.forEach((v, i) => {
        if (first + i < frames) {
          loudness[first + i] = v;
          mask[first + i] = 1;
        }
      });
      done++;
    }
  };

  await listen(FIRST_ROUND, 0, FIRST_ROUND_SHARE);
  const first = fitAcrossLevels(opts.cues, loudness, mask);
  if (first) return first;
  // Not sure: listen to other pieces too, and judge again with everything heard so far.
  await listen(SECOND_ROUND, FIRST_ROUND_SHARE, 1);
  return fitAcrossLevels(opts.cues, loudness, mask);
}
