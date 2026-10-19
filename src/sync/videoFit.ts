import type { Cue } from '../subtitles/types';
import { FRAME_MS, type TimingFit } from './fit';
import { detectSpeech, fitAcrossLevels } from './speech';

/**
 * Checks a subtitle against the sound of the playing video by listening to a few short pieces
 * (not the whole video), and returns how to move it, or undefined when it is not sure.
 */

/** Where the pieces start, as a share of the subtitle's length. */
const WINDOW_STARTS = [0.03, 0.4, 0.78];
const MIN_WINDOW_SEC = 240;
const MAX_WINDOW_SEC = 420;
/** The subtitle may be this much off; the sound array has room for it. */
const MARGIN_SEC = 100;
const DEAD_DB = -120;

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

export async function fitSubtitleToVideo(opts: VideoFitOptions): Promise<TimingFit | undefined> {
  const detect = opts.detect ?? detectSpeech;
  const lengthSec = Math.max(...opts.cues.map((c) => c.endMs), 0) / 1000;
  if (opts.cues.length < 20 || lengthSec < 300) return undefined;

  const windowSec = Math.min(MAX_WINDOW_SEC, Math.max(MIN_WINDOW_SEC, lengthSec * 0.14));
  const frames = Math.ceil(((lengthSec + MARGIN_SEC) * 1000) / FRAME_MS);
  const loudness = new Array<number>(frames).fill(DEAD_DB);
  const mask = new Uint8Array(frames);

  let done = 0;
  for (const share of WINDOW_STARTS) {
    const startSec = Math.max(0, Math.min(lengthSec * share, lengthSec - windowSec));
    const scan = await detect(
      opts.ffmpeg,
      opts.url,
      opts.signal,
      (sec) =>
        opts.onProgress?.(Math.round(((done + sec / windowSec) / WINDOW_STARTS.length) * 100)),
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
  return fitAcrossLevels(opts.cues, loudness, mask);
}
