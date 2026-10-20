import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** A place chosen in a save dialog: absolute, an .mkv name, in a folder that exists. */
export function checkOutputPath(
  output: string,
  exists: (p: string) => boolean = existsSync,
): string {
  if (!isAbsolute(output) || extname(output).toLowerCase() !== '.mkv' || !exists(dirname(output))) {
    throw new MuxError('BAD_PATH', 'That place to save the video is not usable.');
  }
  return output;
}

/** Next to the video, named after it, never over an existing file: "Show S01E01.heb.mkv", then "... (2).mkv". */
export function outputPathFor(
  video: string,
  language: string,
  exists: (p: string) => boolean = existsSync,
): string {
  const stem = basename(video, extname(video));
  const base = join(dirname(video), `${stem}.${languageCode3(language)}`);
  let candidate = `${base}.mkv`;
  for (let n = 2; exists(candidate); n++) candidate = `${base} (${n}).mkv`;
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

export type RunFfmpeg = (ffmpeg: string, args: string[], signal: AbortSignal) => Promise<void>;

const realRun: RunFfmpeg = (ffmpeg, args, signal) =>
  new Promise((resolve, reject) => {
    const child = spawn(ffmpeg, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
    const stop = () => child.kill();
    signal.addEventListener('abort', stop, { once: true });
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
  srt: string;
  language: string;
  signal?: AbortSignal;
  run?: RunFfmpeg;
}

/** Writes the copy and returns its path. A half-written file is removed when something fails. */
export async function muxSubtitle(req: MuxRequest): Promise<string> {
  const video = req.url ? checkLocalUrl(req.url) : checkVideoPath(req.video);
  if (req.url && !req.output)
    throw new MuxError('BAD_PATH', 'No place to save the video was chosen.');
  if (!req.ffmpeg) throw new MuxError('NO_FFMPEG', 'ffmpeg was not found (it comes with Stremio).');
  const output = req.output ? checkOutputPath(req.output) : outputPathFor(video, req.language);
  const dir = mkdtempSync(join(tmpdir(), 'ai-sub-mux-'));
  const srtFile = join(dir, 'subtitle.srt');
  try {
    writeFileSync(srtFile, req.srt, 'utf8');
    await (req.run ?? realRun)(
      req.ffmpeg,
      muxArgs(video, srtFile, output, req.language),
      req.signal ?? new AbortController().signal,
    );
    // The SRT goes next to it with the same name, so any player can use it too.
    const srtOut = output.replace(/\.mkv$/, '.srt');
    if (!existsSync(srtOut)) writeFileSync(srtOut, req.srt, 'utf8');
    return output;
  } catch (err) {
    rmSync(output, { force: true });
    throw err instanceof MuxError ? err : new MuxError('FAILED', 'Could not write the video.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
