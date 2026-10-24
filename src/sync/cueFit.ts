import { spawn } from 'node:child_process';
import { defaultExec, listTextTracks, rankTracks, type Exec } from '../sources/embedded';
import { parseSubtitle } from '../subtitles/parse';
import type { Cue } from '../subtitles/types';
import { alignWindow, buildCueFit, SAME_SHIFT_MS, type WindowMatch } from './cueAlign';
import type { TimingFit } from './fit';
import { pickWindows } from './videoFit';

/**
 * Checks a subtitle against the subtitle track inside the video by reading only a few short pieces
 * of that track (not the whole file), and returns how to move the subtitle, or undefined when the
 * video has no usable track or the pieces do not give a clear answer.
 */

/** Short: a piece is read by downloading that much of the video (the track is mixed in with the picture). */
const WINDOW_SEC = 60;
/** The two pieces read first; more are read only where neighbours disagree. */
const FIRST_SHARES = [0.25, 0.75];
/** When fewer than two pieces gave an answer, these places are tried one by one (a piece can fall on a song or a quiet part). */
const RESCUE_SHARES = [0.5, 0.9, 0.1];
/** At most this many more pieces, each between the two neighbours that differ most. */
const MAX_EXTRA_PIECES = 3;
const MIN_LENGTH_SEC = 300;
const MIN_CUES = 20;
const PROBE_TIMEOUT_MS = 15_000;
const PIECE_TIMEOUT_MS = 40_000;
const MAX_PIECE_BYTES = 2 * 1024 * 1024;

export type ReadPiece = (o: {
  ffmpeg: string;
  url: string;
  streamIndex: number;
  fromSec: number;
  toSec: number;
  signal: AbortSignal;
}) => Promise<string>;

export interface CueFitOptions {
  ffmpeg: string;
  ffprobe: string;
  url: string;
  cues: Cue[];
  /** Language of the subtitle that is being checked; the track in this language is the reference. */
  language: string;
  signal: AbortSignal;
  /** Share of the reading done, 0..100. */
  onProgress?: (percent: number) => void;
  /** One line per step for the log: codes and numbers only. */
  log?: (info: Record<string, unknown>) => void;
  /** Replaced in tests. */
  exec?: Exec;
  readPiece?: ReadPiece;
}

/**
 * Reads the lines of one text track between two times, with the times the video has. ffmpeg keeps the
 * video's own timestamps with -copyts, and stops at -to instead of reading the rest of the file.
 */
export const readPieceWithFfmpeg: ReadPiece = ({
  ffmpeg,
  url,
  streamIndex,
  fromSec,
  toSec,
  signal,
}) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      ffmpeg,
      [
        '-v',
        'error',
        '-ss',
        String(fromSec),
        '-copyts',
        '-i',
        url,
        '-map',
        `0:${streamIndex}`,
        '-to',
        String(toSec),
        '-f',
        'srt',
        '-',
      ],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const stop = (): void => {
      child.kill();
    };
    const timer = setTimeout(() => {
      stop();
      reject(new Error('timeout'));
    }, PIECE_TIMEOUT_MS);
    signal.addEventListener('abort', stop, { once: true });
    child.stdout.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_PIECE_BYTES) stop();
      else chunks.push(c);
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', stop);
      if (signal.aborted) reject(new Error('stopped'));
      else if (code !== 0 && chunks.length === 0) reject(new Error(`exit ${code}`));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
  });

export async function fitSubtitleToEmbeddedCues(
  opts: CueFitOptions,
): Promise<TimingFit | undefined> {
  if (!opts.ffprobe || opts.cues.length < MIN_CUES) return undefined;
  const lengthSec = Math.max(...opts.cues.map((c) => c.endMs), 0) / 1000;
  if (lengthSec < MIN_LENGTH_SEC) return undefined;
  const exec = opts.exec ?? defaultExec;
  const read = opts.readPiece ?? readPieceWithFfmpeg;

  const probeStart = Date.now();
  let probeFailed = false;
  const tracks = await listTextTracks(opts.ffprobe, opts.url, exec, PROBE_TIMEOUT_MS).catch(() => {
    probeFailed = true;
    return [];
  });
  const track = rankTracks(tracks, opts.language, opts.language)[0]?.track;
  opts.log?.({
    cue: track ? 'track' : probeFailed ? 'probe-failed' : 'no-track',
    tracks: tracks.length,
    ms: Date.now() - probeStart,
  });
  if (!track) return undefined;
  opts.onProgress?.(3);

  const taken: { from: number; to: number }[] = [];
  const matches: WindowMatch[] = [];
  let done = 0;
  const total = FIRST_SHARES.length + RESCUE_SHARES.length;
  const readRound = async (shares: readonly number[]): Promise<void> => {
    for (const fromSec of pickWindows(opts.cues, shares, WINDOW_SEC, lengthSec, taken)) {
      let raw = '';
      const pieceStart = Date.now();
      try {
        raw = await read({
          ffmpeg: opts.ffmpeg,
          url: opts.url,
          streamIndex: track.index,
          fromSec,
          toSec: fromSec + WINDOW_SEC,
          signal: opts.signal,
        });
      } catch {
        if (opts.signal.aborted) throw new Error('stopped');
      }
      done++;
      opts.onProgress?.(Math.round((done / total) * 100));
      const ref = raw ? parseSubtitle(raw, 'srt').cues : [];
      const hit = alignWindow(opts.cues, ref);
      opts.log?.({
        cue: 'piece',
        fromSec: Math.round(fromSec),
        ms: Date.now() - pieceStart,
        lines: ref.length,
        ...(hit
          ? { matched: hit.matched, usable: hit.usable, offsetMs: hit.offsetMs }
          : { unsure: true }),
      });
      if (hit) matches.push(hit);
    }
  };

  await readRound(FIRST_SHARES);
  for (const share of RESCUE_SHARES) {
    if (matches.length >= 2) break;
    await readRound([share]);
  }
  if (matches.length < 2) return undefined;
  for (let extra = 0; extra < MAX_EXTRA_PIECES; extra++) {
    const sorted = [...matches].sort((p, q) => p.atMs - q.atMs);
    let widest: { mid: number; gap: number } | undefined;
    for (let i = 1; i < sorted.length; i++) {
      const a = sorted[i - 1] as WindowMatch;
      const b = sorted[i] as WindowMatch;
      const differ = Math.abs(b.offsetMs - a.offsetMs);
      if (differ > SAME_SHIFT_MS && (!widest || differ > widest.gap)) {
        widest = { mid: (a.atMs + b.atMs) / 2, gap: differ };
      }
    }
    if (!widest) break;
    const before = matches.length;
    await readRound([widest.mid / 1000 / lengthSec]);
    if (matches.length === before) break;
  }
  return buildCueFit(matches);
}
