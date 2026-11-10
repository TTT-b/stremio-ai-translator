import { createSyncProgress } from './progress';
import { spawn } from 'node:child_process';
import { defaultExec, listTextTracks, rankTracks, type Exec } from '../sources/embedded';
import { parseSubtitle } from '../subtitles/parse';
import type { Cue } from '../subtitles/types';
import { alignSplit, alignWindow, buildCueFit, SAME_SHIFT_MS, type WindowMatch } from './cueAlign';
import { applyFit, SCALE_CANDIDATES, type TimingFit } from './fit';
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
/**
 * At most this many more pieces, each in the middle of a gap whose two ends differ. Halving a gap
 * of an hour down to one piece takes about six, so two jumps fit; a jump is then found exactly, not guessed.
 */
const MAX_EXTRA_PIECES = 16;
/** Read as well once a jump is known to exist: near the start and the end of the video. */
const EDGE_SHARES = [0.06, 0.94];
/** No further piece is started for narrowing a jump after this long; what is known by then is used. */
const NARROWING_BUDGET_MS = 150_000;
/** A stretch is trusted when this many pieces agree on it. */
const STRETCH_MIN_PIECES = 3;
/** Where a piece that confirms a stretch is read (the next place only when the one before gave nothing). */
const STRETCH_CHECK_SHARES = [0.5, 0.38, 0.62];
/** A jump that is known to within this (two pieces already touch) cannot be narrowed by reading. */
const MIN_GAP_MS = 15_000;
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
  /**
   * Share of the reading done, 0..100. `estimated` is true when the number only moved because time
   * passed (nothing arrived from the video yet).
   */
  onProgress?: (percent: number, estimated?: boolean) => void;
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
    if (signal.aborted) {
      reject(new Error('stopped'));
      return;
    }
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

interface Stretch {
  scale: number;
  /** One per piece that matched the stretched subtitle; they agree on the shift. */
  hits: WindowMatch[];
}

const spreadOf = (hits: WindowMatch[]): number =>
  Math.max(...hits.map((h) => h.offsetMs)) - Math.min(...hits.map((h) => h.offsetMs));

/**
 * A subtitle made for another frame rate (25 against 23.976, say) drifts steadily, up to minutes in
 * a film, so its pieces never agree on one shift. Here the subtitle is stretched by each known
 * frame-rate ratio and compared again with the pieces already read (nothing new is downloaded);
 * the ratio under which the most pieces agree on a single shift is returned.
 */
export function findStretch(cues: Cue[], pieces: Cue[][]): Stretch | undefined {
  let best: (Stretch & { matched: number }) | undefined;
  for (const scale of SCALE_CANDIDATES) {
    if (scale === 1) continue;
    const stretched = cues.map((c) => ({
      ...c,
      startMs: Math.round(c.startMs * scale),
      endMs: Math.round(c.endMs * scale),
    }));
    const hits = pieces.flatMap((ref) => alignWindow(stretched, ref) ?? []);
    if (hits.length < 2 || spreadOf(hits) > SAME_SHIFT_MS) continue;
    const matched = hits.reduce((n, h) => n + h.matched, 0);
    const better =
      !best ||
      hits.length > best.hits.length ||
      (hits.length === best.hits.length && matched > best.matched);
    if (better) best = { scale, hits, matched };
  }
  return best ? { scale: best.scale, hits: best.hits } : undefined;
}

/** The fit of a stretch: the ratio and the one shift its pieces agree on. */
function stretchFit(stretch: Stretch): TimingFit {
  const offsets = stretch.hits.map((h) => h.offsetMs).sort((p, q) => p - q);
  const hits = stretch.hits;
  return {
    scale: stretch.scale,
    offsetMs: offsets[Math.floor(offsets.length / 2)] as number,
    score: hits.reduce((n, h) => n + h.matched / h.usable, 0) / hits.length,
    baseline: 0,
    parts: hits.map((h) => ({ atSec: Math.round(h.atMs / 1000), offsetMs: h.offsetMs })),
  };
}

const gapKey = (a: WindowMatch, b: WindowMatch): string => `${a.atMs}|${b.atMs}`;

/**
 * The two neighbouring pieces whose different shifts leave the most lines in doubt (how far apart
 * they are times how much they differ), skipping gaps that are already narrow or could not be read.
 */
function worstGap(
  matches: WindowMatch[],
  dead: ReadonlySet<string>,
): { a: WindowMatch; b: WindowMatch } | undefined {
  const sorted = [...matches].sort((p, q) => p.atMs - q.atMs);
  let worst: { a: WindowMatch; b: WindowMatch; harm: number } | undefined;
  for (let i = 1; i < sorted.length; i++) {
    const a = sorted[i - 1] as WindowMatch;
    const b = sorted[i] as WindowMatch;
    const differ = Math.abs(b.offsetMs - a.offsetMs);
    const span = b.atMs - a.atMs;
    if (differ <= SAME_SHIFT_MS || span <= MIN_GAP_MS || dead.has(gapKey(a, b))) continue;
    const harm = differ * span;
    if (!worst || harm > worst.harm) worst = { a, b, harm };
  }
  return worst;
}

export async function fitSubtitleToEmbeddedCues(
  opts: CueFitOptions,
): Promise<TimingFit | undefined> {
  if (opts.signal.aborted) throw new Error('stopped');
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
  const progress = createSyncProgress((p, estimated) => opts.onProgress?.(p, estimated));
  // A piece gives no sign of life until it is done, so the bar is moved by the time it has been running.
  const clock = setInterval(() => progress.tick(), 1000);
  try {
    const taken: { from: number; to: number }[] = [];
    const matches: WindowMatch[] = [];
    const pieces: Cue[][] = [];
    /** Reads the pieces that start at these seconds; returns the lines of those that gave no shift. */
    const readAt = async (starts: readonly number[]): Promise<Cue[][]> => {
      const unsure: Cue[][] = [];
      for (const fromSec of starts) {
        let raw = '';
        const pieceStart = Date.now();
        progress.begin();
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
        progress.finish();
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
        if (ref.length > 0) pieces.push(ref);
        if (hit) matches.push(hit);
        else unsure.push(ref);
      }
      return unsure;
    };
    const readRound = (shares: readonly number[], reachSec?: number): Promise<Cue[][]> =>
      readAt(pickWindows(opts.cues, shares, WINDOW_SEC, lengthSec, taken, reachSec));
    /** A frame-rate stretch is looked for only when the pieces do not already agree on one shift. */
    const stretchNow = (): Stretch | undefined =>
      matches.length >= 2 && spreadOf(matches) <= SAME_SHIFT_MS
        ? undefined
        : findStretch(opts.cues, pieces);

    await readRound(FIRST_SHARES);
    let stretch = stretchNow();
    for (const share of RESCUE_SHARES) {
      if (matches.length >= 2 || stretch) break;
      progress.needMore(1);
      await readRound([share]);
      stretch = stretchNow();
    }
    // Two pieces can agree on a stretch by chance (one jump of the right size); a third settles it.
    for (const share of STRETCH_CHECK_SHARES) {
      if (!stretch || stretch.hits.length >= STRETCH_MIN_PIECES) break;
      // The piece is chosen on the video's own clock: where the stretched subtitle has dialogue.
      const onVideo = applyFit(opts.cues, stretchFit(stretch));
      const videoSec = Math.max(...onVideo.map((c) => c.endMs), 0) / 1000;
      progress.needMore(1);
      await readAt(pickWindows(onVideo, [share], WINDOW_SEC, videoSec, taken));
      stretch = stretchNow();
    }
    if (stretch && stretch.hits.length >= STRETCH_MIN_PIECES) {
      opts.log?.({ cue: 'stretch', scale: Math.round(stretch.scale * 10000) / 10000 });
      return stretchFit(stretch);
    }
    if (matches.length < 2) return undefined;

    // Where neighbours differ, the shift jumps somewhere between them: halve the gap until it is found.
    const dead = new Set<string>();
    // A video that jumps once may jump again near its start or end, outside the pieces read so far.
    if (spreadOf(matches) > SAME_SHIFT_MS) {
      progress.needMore(EDGE_SHARES.length);
      await readRound(EDGE_SHARES);
    }
    for (let extra = 0; extra < MAX_EXTRA_PIECES; extra++) {
      if (Date.now() - probeStart > NARROWING_BUDGET_MS) break;
      const gap = worstGap(matches, dead);
      if (!gap) break;
      const { a, b } = gap;
      const before = matches.length;
      const spanSec = (b.atMs - a.atMs) / 1000;
      // The video's own time of the middle of the gap (the track's pieces are cut by video time).
      const midSec = ((a.atMs + b.atMs) / 2 + (a.offsetMs + b.offsetMs) / 2) / 1000;
      progress.needMore(1);
      const unsure =
        spanSec <= 2 * WINDOW_SEC
          ? await readAt([Math.max(0, midSec - WINDOW_SEC / 2)])
          : await readRound([midSec / lengthSec], (spanSec - WINDOW_SEC) / 4);
      for (const ref of unsure) {
        const split = alignSplit(opts.cues, ref, a.offsetMs, b.offsetMs);
        if (!split) continue;
        opts.log?.({ cue: 'jump', atSec: Math.round(split[1].atMs / 1000) });
        matches.push(...split);
        // The jump is now known to the line: nothing between these two is left to read.
        dead.add(gapKey(split[0], split[1]));
      }
      if (matches.length === before) dead.add(gapKey(a, b));
    }
    return buildCueFit(matches, opts.cues);
  } finally {
    clearInterval(clock);
  }
}
