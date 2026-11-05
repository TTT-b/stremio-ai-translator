import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { stripOverrideTags } from '../subtitles/parse';
import { basename, dirname, extname, isAbsolute, join } from 'node:path';

/**
 * Puts a finished subtitle into a copy of a video file as an extra, switchable subtitle track.
 * The picture and sound are copied as they are (no re-encoding), so it takes seconds and keeps the
 * quality. The result is an MKV next to the original; the original is never touched.
 */

export const VIDEO_EXTENSIONS = ['.mkv', '.mp4', '.avi', '.mov', '.m4v', '.webm', '.ts', '.wmv'];

const LANGUAGE_CODES: Record<string, string> = {
  he: 'heb',
  iw: 'heb',
  en: 'eng',
  ar: 'ara',
  ru: 'rus',
  es: 'spa',
  fr: 'fre',
  de: 'ger',
  it: 'ita',
  pt: 'por',
  tr: 'tur',
  nl: 'dut',
  pl: 'pol',
  uk: 'ukr',
  fa: 'per',
  hi: 'hin',
  ja: 'jpn',
  ko: 'kor',
  zh: 'chi',
};

/** The three-letter code Matroska uses for a language ("he" -> "heb"); "und" when unknown. */
export function languageCode3(language: string): string {
  const base = language.toLowerCase().split(/[-_]/)[0] ?? '';
  return LANGUAGE_CODES[base] ?? (/^[a-z]{3}$/.test(base) ? base : 'und');
}

export type MuxErrorCode = 'BAD_PATH' | 'NOT_A_VIDEO' | 'NO_FFMPEG' | 'FAILED';

export class MuxError extends Error {
  constructor(
    readonly code: MuxErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MuxError';
  }
}

/** Checks a path chosen by the user: absolute, an existing file, a known video type. */
export function checkVideoPath(
  video: unknown,
  exists: (p: string) => boolean = existsSync,
): string {
  if (
    typeof video !== 'string' ||
    video.length === 0 ||
    video.length > 1000 ||
    video.includes('\0')
  ) {
    throw new MuxError('BAD_PATH', 'No video file chosen.');
  }
  if (!isAbsolute(video) || !exists(video))
    throw new MuxError('BAD_PATH', 'The file was not found.');
  if (!VIDEO_EXTENSIONS.includes(extname(video).toLowerCase())) {
    throw new MuxError('NOT_A_VIDEO', 'This is not a video file.');
  }
  return video;
}

/** Only Stremio's own server on this computer may be read as a video address. */
export function checkLocalUrl(url: string): string {
  if (!/^http:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):\d{1,5}\//.test(url)) {
    throw new MuxError('BAD_PATH', 'The video address is not on this computer.');
  }
  return url;
}

/** The copy is an MKV (every track kept) or an MP4 (plays in the built-in players of iPad, iPhone and phones). */
export type MuxFormat = 'mkv' | 'mp4';

const formatOf = (path: string): MuxFormat =>
  extname(path).toLowerCase() === '.mp4' ? 'mp4' : 'mkv';

/** A place chosen in a save dialog: absolute, an .mkv or .mp4 name, in a folder that exists. */
export function checkOutputPath(
  output: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const ext = extname(output).toLowerCase();
  if (!isAbsolute(output) || (ext !== '.mkv' && ext !== '.mp4') || !exists(dirname(output))) {
    throw new MuxError('BAD_PATH', 'That place to save the video is not usable.');
  }
  return output;
}

/** Next to the video, named after it, never over an existing file: "Show S01E01.heb.mkv", then "... (2).mkv". */
export function outputPathFor(
  video: string,
  language: string,
  exists: (p: string) => boolean = existsSync,
  format: MuxFormat = 'mkv',
): string {
  const stem = basename(video, extname(video));
  const base = join(dirname(video), `${stem}.${languageCode3(language)}`);
  let candidate = `${base}.${format}`;
  for (let n = 2; exists(candidate); n++) candidate = `${base} (${n}).${format}`;
  return candidate;
}

/**
 * ffmpeg arguments: everything from the video is kept, the new subtitle is added as the FIRST
 * subtitle track (so its language/name apply to track 0) and is marked as the default one.
 */
export function muxArgs(video: string, srt: string, output: string, language: string): string[] {
  const code = languageCode3(language);
  return [
    '-v',
    'error',
    '-nostdin',
    '-i',
    video,
    '-i',
    srt,
    '-map',
    '1:0',
    '-map',
    '0:v',
    '-map',
    '0:a?',
    '-map',
    '0:s?',
    '-map',
    '0:t?',
    '-map_chapters',
    '0',
    '-c',
    'copy',
    '-c:s',
    'srt',
    '-metadata:s:s:0',
    `language=${code}`,
    '-metadata:s:s:0',
    'title=AI translation',
    '-disposition:s:0',
    'default',
    output,
  ];
}

/** The first video and audio codec of a file, as ffmpeg names them ("hevc", "aac"). */
export interface MediaCodecs {
  video?: string;
  audio?: string;
}

/** Reads the codecs from what `ffmpeg -i file` prints about its streams. */
export function parseCodecs(ffmpegOutput: string): MediaCodecs {
  const video = /Stream #\d+:\d+[^\n]*?: Video: ([a-z0-9_]+)/i.exec(ffmpegOutput)?.[1];
  const audio = /Stream #\d+:\d+[^\n]*?: Audio: ([a-z0-9_]+)/i.exec(ffmpegOutput)?.[1];
  return {
    ...(video ? { video: video.toLowerCase() } : {}),
    ...(audio ? { audio: audio.toLowerCase() } : {}),
  };
}

/** Audio that iPad, iPhone and phones play from an MP4 without conversion; anything else becomes AAC. */
const MP4_SAFE_AUDIO = ['aac', 'ac3', 'eac3', 'mp3', 'alac'];

/**
 * ffmpeg arguments for the MP4 copy: the picture is copied, audio is copied when a phone can play
 * it (else AAC), and ONLY the new subtitle is kept (as mov_text, the one MP4 subtitle type those
 * players show) as the first and default track. HEVC is tagged hvc1, which Apple players require.
 */
export function mp4Args(
  video: string,
  srt: string,
  output: string,
  language: string,
  codecs: MediaCodecs,
): string[] {
  const code = languageCode3(language);
  const copyAudio = codecs.audio !== undefined && MP4_SAFE_AUDIO.includes(codecs.audio);
  return [
    '-v',
    'error',
    '-nostdin',
    '-i',
    video,
    '-i',
    srt,
    '-map',
    '1:0',
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-map_chapters',
    '0',
    '-c:v',
    'copy',
    ...(codecs.video === 'hevc' ? ['-tag:v', 'hvc1'] : []),
    '-c:a',
    copyAudio ? 'copy' : 'aac',
    '-c:s',
    'mov_text',
    '-metadata:s:s:0',
    `language=${code}`,
    '-metadata:s:s:0',
    'title=AI translation',
    '-disposition:s:0',
    'default',
    '-movflags',
    '+faststart',
    output,
  ];
}

/** How far ffmpeg has got: seconds of video written, the video's length when known, bytes written. */
export interface MuxProgress {
  doneSec: number;
  totalSec: number | undefined;
  bytes: number;
}

export type RunFfmpeg = (
  ffmpeg: string,
  args: string[],
  signal: AbortSignal,
  onProgress?: (p: MuxProgress) => void,
) => Promise<void>;

/** Parses 'Duration: 00:23:40.12' from ffmpeg's header text into seconds. */
export function parseDurationSec(text: string): number | undefined {
  const m = /Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/.exec(text);
  if (!m) return undefined;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/** Looks at a video's streams (replaced in tests). */
export type ProbeCodecs = (
  ffmpeg: string,
  input: string,
  signal: AbortSignal,
) => Promise<MediaCodecs>;

const PROBE_MAX_MS = 20_000;

const realProbe: ProbeCodecs = (ffmpeg, input, signal) =>
  new Promise((resolve) => {
    let text = '';
    const child = spawn(ffmpeg, ['-hide_banner', '-nostdin', '-i', input], {
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      child.kill();
      resolve(parseCodecs(text));
    };
    const timer = setTimeout(finish, PROBE_MAX_MS);
    signal.addEventListener('abort', finish, { once: true });
    child.stderr.on('data', (d: Buffer) => {
      if (text.length < 200_000) text += d.toString('utf8');
    });
    child.once('error', finish);
    child.once('close', finish);
  });

const realRun: RunFfmpeg = (ffmpeg, args, signal, onProgress) =>
  new Promise((resolve, reject) => {
    const withProgress = onProgress ? ['-progress', 'pipe:1', '-nostats', ...args] : args;
    const child = spawn(ffmpeg, withProgress, {
      windowsHide: true,
      stdio: ['ignore', onProgress ? 'pipe' : 'ignore', onProgress ? 'pipe' : 'ignore'],
    });
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
    let totalSec: number | undefined;
    let header = '';
    let doneSec = 0;
    let bytes = 0;
    let pending = '';
    if (onProgress) {
      child.stderr?.on('data', (d: Buffer) => {
        if (totalSec === undefined && header.length < 20_000) {
          header += d.toString('utf8');
          totalSec = parseDurationSec(header);
        }
      });
      child.stdout?.on('data', (d: Buffer) => {
        pending += d.toString('utf8');
        const lines = pending.split(/\r?\n/);
        pending = lines.pop() ?? '';
        for (const line of lines) {
          const [key, value] = line.split('=');
          if (key === 'out_time_us' || key === 'out_time_ms')
            doneSec = Math.max(0, Number(value)) / 1e6;
          else if (key === 'total_size') bytes = Math.max(0, Number(value)) || 0;
          else if (key === 'progress') onProgress({ doneSec, totalSec, bytes });
        }
      });
    }
    child.once('error', reject);
    child.once('close', (code) => {
      signal.removeEventListener('abort', stop);
      if (code === 0) resolve();
      else reject(new MuxError('FAILED', `ffmpeg stopped with code ${code}`));
    });
  });

export interface MuxRequest {
  ffmpeg: string | undefined;
  /** A file on this computer (checked) ... */
  video?: unknown;
  /** ... or the address of the video on Stremio's own server (loopback only). */
  url?: string;
  /** Exact output file chosen by the user (a save dialog); default: next to the video. */
  output?: string;
  /** Kind of copy when no exact place was chosen (a chosen place decides by its .mkv / .mp4 name). */
  format?: MuxFormat;
  srt: string;
  language: string;
  signal?: AbortSignal;
  run?: RunFfmpeg;
  probe?: ProbeCodecs;
  onProgress?: (p: MuxProgress) => void;
}

/** Writes the copy and returns its path. A half-written file is removed when something fails. */
export async function muxSubtitle(req: MuxRequest): Promise<string> {
  const video = req.url ? checkLocalUrl(req.url) : checkVideoPath(req.video);
  if (req.url && !req.output)
    throw new MuxError('BAD_PATH', 'No place to save the video was chosen.');
  if (!req.ffmpeg) throw new MuxError('NO_FFMPEG', 'ffmpeg was not found (it comes with Stremio).');
  const output = req.output
    ? checkOutputPath(req.output)
    : outputPathFor(video, req.language, existsSync, req.format ?? 'mkv');
  const format = formatOf(output);
  const dir = mkdtempSync(join(tmpdir(), 'ai-sub-mux-'));
  const srtFile = join(dir, 'subtitle.srt');
  try {
    const srt = stripOverrideTags(req.srt);
    writeFileSync(srtFile, srt, 'utf8');
    const signal = req.signal ?? new AbortController().signal;
    const args =
      format === 'mp4'
        ? mp4Args(
            video,
            srtFile,
            output,
            req.language,
            await (req.probe ?? realProbe)(req.ffmpeg, video, signal),
          )
        : muxArgs(video, srtFile, output, req.language);
    await (req.run ?? realRun)(req.ffmpeg, args, signal, req.onProgress);
    // The SRT goes next to it with the same name, so any player can use it too.
    const srtOut = output.replace(/\.(mkv|mp4)$/i, '.srt');
    if (!existsSync(srtOut)) writeFileSync(srtOut, srt, 'utf8');
    return output;
  } catch (err) {
    rmSync(output, { force: true });
    throw err instanceof MuxError ? err : new MuxError('FAILED', 'Could not write the video.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
