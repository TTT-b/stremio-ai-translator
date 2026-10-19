import { spawn } from 'node:child_process';
import type { Cue } from '../subtitles/types';
import { FRAME_MS, fitTiming, type TimingFit } from './fit';

/**
 * Finds WHEN someone is talking in a video, from the loudness of its voice band only. No words and
 * no model: ffmpeg gives 8 kHz mono sound, and each 50 ms frame is marked "speech" or not.
 */

const SAMPLE_RATE = 8000;
const SAMPLES_PER_FRAME = (SAMPLE_RATE * FRAME_MS) / 1000;

/** Silence shorter than this between two bursts is part of the same sentence. */
const FILL_GAP_FRAMES = 5; // 250 ms
/** A burst shorter than this is a click or a door, not a word. */
const MIN_BURST_FRAMES = 4; // 200 ms
/** Frames quieter than this (dB) are digital silence and do not count towards the noise floor. */
const DEAD_DB = -80;

/** Loudness of one frame in dB (full scale = 0). */
export function frameDb(samples: Int16Array, from: number, to: number): number {
  let sum = 0;
  for (let i = from; i < to; i++) {
    const v = (samples[i] as number) / 32768;
    sum += v * v;
  }
  const rms = Math.sqrt(sum / Math.max(1, to - from));
  return rms > 0 ? 20 * Math.log10(rms) : -120;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

/**
 * Turns the loudness of every frame into speech on/off. The threshold follows the film: between its
 * quiet floor and its loud parts, so a quiet drama and a loud action film both work.
 */
export function speechFromLoudness(db: ArrayLike<number>, level = 0.4): Uint8Array {
  const out = new Uint8Array(db.length);
  const live: number[] = [];
  for (let i = 0; i < db.length; i++) if ((db[i] as number) > DEAD_DB) live.push(db[i] as number);
  if (live.length < 200) return out;
  live.sort((a, b) => a - b);
  const floor = percentile(live, 0.2);
  const loud = percentile(live, 0.95);
  if (loud - floor < 6) return out; // flat sound: nothing to tell speech apart from
  const threshold = floor + level * (loud - floor);
  for (let i = 0; i < db.length; i++) if ((db[i] as number) > threshold) out[i] = 1;

  // Join close bursts, then drop the very short ones.
  let lastOn = -1;
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    if (lastOn >= 0 && i - lastOn - 1 <= FILL_GAP_FRAMES) out.fill(1, lastOn, i);
    lastOn = i;
  }
  let start = -1;
  for (let i = 0; i <= out.length; i++) {
    if (i < out.length && out[i]) {
      if (start < 0) start = i;
    } else if (start >= 0) {
      if (i - start < MIN_BURST_FRAMES) out.fill(0, start, i);
      start = -1;
    }
  }
  return out;
}

export interface SpeechScan {
  /** Loudness of every frame (dB), so other thresholds can be tried. */
  loudness: number[];
  /** One entry per FRAME_MS: 1 = speech. */
  speech: Uint8Array;
  /** Seconds of video that were read. */
  seconds: number;
}

/**
 * Reads the audio of `url` (a file or a stream address) and marks the speech.
 * The voice band is cut out in ffmpeg (bass and hiss are mostly music and noise).
 */
export function detectSpeech(
  ffmpeg: string,
  url: string,
  signal: AbortSignal,
  onProgress?: (seconds: number) => void,
  window?: { startSec: number; durationSec: number },
): Promise<SpeechScan> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        ...(window ? ['-ss', String(window.startSec)] : []),
        '-i',
        url,
        ...(window ? ['-t', String(window.durationSec)] : []),
        '-vn',
        '-map',
        '0:a:0',
        '-af',
        'highpass=f=200,lowpass=f=3400',
        '-ac',
        '1',
        '-ar',
        String(SAMPLE_RATE),
        '-f',
        's16le',
        '-',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const kill = () => child.kill();
    signal.addEventListener('abort', kill, { once: true });
    const db: number[] = [];
    let carry = Buffer.alloc(0);
    child.stdout.on('data', (chunk: Buffer) => {
      const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
      const frameBytes = SAMPLES_PER_FRAME * 2;
      const whole = Math.floor(buf.length / frameBytes) * frameBytes;
      const samples = new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + whole));
      for (let f = 0; f * SAMPLES_PER_FRAME < samples.length; f++) {
        db.push(frameDb(samples, f * SAMPLES_PER_FRAME, (f + 1) * SAMPLES_PER_FRAME));
      }
      carry = Buffer.from(buf.subarray(whole));
      onProgress?.((db.length * FRAME_MS) / 1000);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      signal.removeEventListener('abort', kill);
      if (signal.aborted) reject(new Error('stopped'));
      else if (code !== 0 && db.length === 0) reject(new Error(`exit ${code}`));
      else
        resolve({
          loudness: db,
          speech: speechFromLoudness(db),
          seconds: (db.length * FRAME_MS) / 1000,
        });
    });
  });
}

/** Thresholds tried between the film's quiet floor and its loud parts; real films need different ones. */
const LEVELS = [0.5, 0.6, 0.7, 0.8];
/** Two thresholds must give the same shift within this many ms for the answer to be trusted. */
const AGREE_MS = 200;

/**
 * Fits the subtitle at several speech thresholds and returns a result only when at least two of them
 * agree on the shift (a threshold that is wrong for this film gives nothing or something different).
 */
export function fitAcrossLevels(
  cues: Cue[],
  loudness: ArrayLike<number>,
  mask?: Uint8Array,
): TimingFit | undefined {
  const fits: TimingFit[] = [];
  for (const level of LEVELS) {
    const fit = fitTiming(cues, speechFromLoudness(loudness, level), mask ? { mask } : {});
    if (fit) fits.push(fit);
  }
  // The biggest group of thresholds that agree on stretch and shift wins; its middle shift is used.
  let group: TimingFit[] = [];
  for (const anchor of fits) {
    const near = fits.filter(
      (f) => f.scale === anchor.scale && Math.abs(f.offsetMs - anchor.offsetMs) <= AGREE_MS,
    );
    if (near.length > group.length) group = near;
  }
  if (group.length < 2) return undefined;
  const offsets = group.map((f) => f.offsetMs).sort((x, y) => x - y);
  const best = group.reduce((p, q) => (q.score > p.score ? q : p));
  return { ...best, offsetMs: offsets[Math.floor(offsets.length / 2)] as number };
}
