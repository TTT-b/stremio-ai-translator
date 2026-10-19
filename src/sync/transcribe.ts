import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { constants, setPriority, tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpokenWord } from './align';
import { cliPath, modelPath, toolsDir, type WhisperModel } from './tools';
import { parseWhisperJson } from './whisperJson';

/** The two programs involved; replaced in tests. */
export interface SpeechRunner {
  /** Write the audio of `url` as 16 kHz mono WAV. */
  extractAudio(ffmpeg: string, url: string, wav: string, signal: AbortSignal): Promise<void>;
  /** Run whisper-cli; `onLine` gets every line it prints to stderr. */
  transcribe(
    cli: string,
    args: string[],
    cwd: string,
    onLine: (line: string) => void,
    signal: AbortSignal,
  ): Promise<void>;
}

function run(
  cmd: string,
  args: string[],
  opts: {
    cwd?: string;
    onLine?: (line: string) => void;
    signal: AbortSignal;
    lowPriority?: boolean;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      ...(opts.cwd ? { cwd: opts.cwd } : {}),
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    if (opts.lowPriority && child.pid) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL); // keep the computer usable
      } catch {
        /* not allowed: carry on at normal priority */
      }
    }
    const kill = () => child.kill();
    opts.signal.addEventListener('abort', kill, { once: true });
    let buffer = '';
    child.stderr.on('data', (c: Buffer) => {
      buffer += c.toString('utf8');
      let nl = buffer.search(/[\r\n]/);
      while (nl >= 0) {
        opts.onLine?.(buffer.slice(0, nl));
        buffer = buffer.slice(nl + 1);
        nl = buffer.search(/[\r\n]/);
      }
    });
    child.on('error', reject);
    child.on('close', (code) => {
      opts.signal.removeEventListener('abort', kill);
      if (opts.signal.aborted) reject(new Error('stopped'));
      else if (code === 0) resolve();
      else reject(new Error(`exit ${code}`));
    });
  });
}

export const realRunner: SpeechRunner = {
  extractAudio: (ffmpeg, url, wav, signal) =>
    run(
      ffmpeg,
      [
        '-v',
        'error',
        '-nostdin',
        '-y',
        '-i',
        url,
        '-vn',
        '-map',
        '0:a:0',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        wav,
      ],
      { signal },
    ),
  transcribe: (cli, args, cwd, onLine, signal) =>
    run(cli, args, { cwd, onLine, signal, lowPriority: true }),
};

export interface TranscribeOptions {
  dataDir: string;
  model: WhisperModel;
  ffmpeg: string;
  streamUrl: string;
  threads: number;
  onProgress?: (percent: number) => void;
  runner?: SpeechRunner;
  /** Longest the whole job may take (default 45 min). */
  timeoutMs?: number;
  /** Longest reading the audio out of the video may take (default 8 min): a stalled stream ends here. */
  extractTimeoutMs?: number;
  /** Longest the speech tool may go without reporting progress (default 4 min). */
  stallMs?: number;
}

/** The words of a video's speech, with their times. Throws when the tools fail. */
export async function transcribeVideo(opts: TranscribeOptions): Promise<SpokenWord[]> {
  const runner = opts.runner ?? realRunner;
  const tmp = mkdtempSync(join(tmpdir(), 'ssub-'));
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? 45 * 60_000);
  // A video that is not being downloaded (or a tool that hangs) must not hold the single speech
  // lane for the whole 45 minutes: each phase has its own deadline.
  let phase: NodeJS.Timeout | undefined;
  const arm = (ms: number) => {
    clearTimeout(phase);
    phase = setTimeout(() => abort.abort(), ms);
  };
  try {
    const wav = join(tmp, 'audio.wav');
    opts.onProgress?.(0);
    arm(opts.extractTimeoutMs ?? 8 * 60_000);
    await runner.extractAudio(opts.ffmpeg, opts.streamUrl, wav, abort.signal);
    arm(opts.stallMs ?? 4 * 60_000);
    const out = join(tmp, 'speech');
    const args = [
      '-m',
      modelPath(opts.dataDir, opts.model),
      '-f',
      wav,
      '-t',
      String(opts.threads),
      '-bs',
      '1',
      '-bo',
      '1', // fastest decoding
      '-ng', // no GPU: the same on every computer
      '-nfa', // flash attention off: required for accurate word times
      '-nt',
      '-dtw',
      opts.model.name, // word times from dynamic time warping
      '-pp', // print progress
      '-ojf',
      '-of',
      out,
    ];
    await runner.transcribe(
      cliPath(opts.dataDir),
      args,
      toolsDir(opts.dataDir),
      (line) => {
        const m = /progress\s*=\s*(\d+)%/.exec(line);
        if (m) {
          arm(opts.stallMs ?? 4 * 60_000);
          opts.onProgress?.(Number(m[1]));
        }
      },
      abort.signal,
    );
    return parseWhisperJson(JSON.parse(readFileSync(`${out}.json`, 'utf8')));
  } finally {
    clearTimeout(timer);
    clearTimeout(phase);
    rmSync(tmp, { recursive: true, force: true });
  }
}
