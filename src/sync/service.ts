import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { Logger } from '../logging/logger';
import type { SpokenWord } from './align';
import { transcribeVideo, type SpeechRunner } from './transcribe';
import {
  installTools,
  isInstalled,
  MODELS,
  removeTools,
  syncSupported,
  type WhisperModel,
  type ZipSpec,
} from './tools';

export interface SyncStatus {
  supported: boolean;
  state: 'unsupported' | 'missing' | 'installing' | 'ready' | 'error';
  /** Download progress while installing, 0..100. */
  percent: number;
  error?: string;
  model: string;
  /** About how much is downloaded, in MB. */
  downloadMb: number;
}

export interface LocalStream {
  infoHash: string;
  fileIdx: number;
  url: string;
}

const cacheSchema = z.object({
  v: z.literal(1),
  model: z.string(),
  words: z.array(z.tuple([z.string(), z.number(), z.number()])).max(200_000),
});

export interface SyncServiceOptions {
  dataDir: string;
  logger: Logger;
  model?: WhisperModel['name'];
  fetchImpl?: typeof fetch;
  runner?: SpeechRunner;
  /** Test hooks: pretend the platform is supported, and use other downloads. */
  supported?: boolean;
  modelSpec?: WhisperModel;
  zipSpec?: ZipSpec;
}

/**
 * Owns the speech tool: installing it, and turning a video into timed words. Only one video is
 * transcribed at a time (it uses the processor heavily), and the result is saved, so each video
 * is listened to once.
 */
export class SyncService {
  readonly model: WhisperModel;
  private state: SyncStatus['state'] = 'missing';
  private percent = 0;
  private error: string | undefined;
  private installing: Promise<void> | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly inFlight = new Map<string, Promise<SpokenWord[] | undefined>>();
  private readonly cacheDir: string;
  private readonly supported: boolean;

  constructor(private readonly opts: SyncServiceOptions) {
    this.model = opts.modelSpec ?? MODELS[opts.model ?? 'tiny.en'];
    this.cacheDir = join(opts.dataDir, 'sync-cache');
    this.supported = opts.supported ?? syncSupported();
  }

  get leadSec(): number {
    return this.model.leadSec;
  }

  ready(): boolean {
    return this.supported && isInstalled(this.opts.dataDir, this.model, this.opts.zipSpec?.sha256);
  }

  status(): SyncStatus {
    const base = {
      supported: this.supported,
      model: this.model.name,
      downloadMb: Math.round((this.model.bytes + 8_928_640) / 1_000_000),
    };
    if (!this.supported) return { ...base, state: 'unsupported', percent: 0 };
    if (this.state === 'installing') return { ...base, state: 'installing', percent: this.percent };
    if (this.ready()) return { ...base, state: 'ready', percent: 100 };
    if (this.state === 'error')
      return { ...base, state: 'error', percent: 0, ...(this.error ? { error: this.error } : {}) };
    return { ...base, state: 'missing', percent: 0 };
  }

  /** Start (or join) the download. Resolves when the tool is ready; rejects with a short reason. */
  install(): Promise<void> {
    if (!this.supported) return Promise.reject(new Error('not supported on this computer'));
    if (this.ready()) return Promise.resolve();
    if (this.installing) return this.installing;
    this.state = 'installing';
    this.percent = 0;
    this.error = undefined;
    this.opts.logger.info(
      { stage: 'CONFIG', sync: 'install-start', model: this.model.name },
      'sync tool download',
    );
    this.installing = installTools({
      dataDir: this.opts.dataDir,
      model: this.model,
      ...(this.opts.zipSpec ? { zip: this.opts.zipSpec } : {}),
      ...(this.opts.fetchImpl ? { fetchImpl: this.opts.fetchImpl } : {}),
      onProgress: (p) => {
        this.percent = p;
      },
    })
      .then(() => {
        this.state = 'missing'; // status() reports "ready" from the files
        this.opts.logger.info({ stage: 'CONFIG', sync: 'install-done' }, 'sync tool ready');
      })
      .catch((err: unknown) => {
        this.state = 'error';
        this.error = err instanceof Error ? err.message.slice(0, 120) : 'download failed';
        this.opts.logger.warn(
          { stage: 'CONFIG', sync: 'install-failed', reason: this.error },
          'sync tool download failed',
        );
        throw err;
      })
      .finally(() => {
        this.installing = undefined;
      });
    return this.installing;
  }

  remove(): void {
    removeTools(this.opts.dataDir);
    rmSync(this.cacheDir, { recursive: true, force: true });
    this.state = 'missing';
  }

  /** Forget the saved transcriptions (they are made again when needed). */
  clearCache(): void {
    rmSync(this.cacheDir, { recursive: true, force: true });
  }

  private cacheFile(stream: LocalStream): string {
    const key = createHash('sha256')
      .update(`${stream.infoHash}:${stream.fileIdx}:${this.model.name}`)
      .digest('hex')
      .slice(0, 32);
    return join(this.cacheDir, `${key}.json`);
  }

  private readCache(file: string): SpokenWord[] | undefined {
    try {
      const parsed = cacheSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (!parsed.success || parsed.data.model !== this.model.name) return undefined;
      return parsed.data.words.map(([w, start, end]) => ({ w, start, end }));
    } catch {
      return undefined;
    }
  }

  /**
   * The timed words of this video's speech, or undefined when the tool is missing or fails. The
   * first call per video takes a few minutes; later calls read the saved result.
   */
  words(
    stream: LocalStream,
    o: { ffmpeg: string; onProgress?: (percent: number) => void },
  ): Promise<SpokenWord[] | undefined> {
    if (!this.ready()) return Promise.resolve(undefined);
    const file = this.cacheFile(stream);
    const saved = this.readCache(file);
    if (saved) return Promise.resolve(saved);
    const running = this.inFlight.get(file);
    if (running) return running;
    const work = this.queue
      .catch(() => undefined)
      .then(async () => {
        const again = this.readCache(file); // an earlier call may have finished meanwhile
        if (again) return again;
        const started = Date.now();
        try {
          const words = await transcribeVideo({
            dataDir: this.opts.dataDir,
            model: this.model,
            ffmpeg: o.ffmpeg,
            streamUrl: stream.url,
            threads: Math.max(1, Math.min(4, Math.floor(cpus().length / 2))),
            ...(o.onProgress ? { onProgress: o.onProgress } : {}),
            ...(this.opts.runner ? { runner: this.opts.runner } : {}),
          });
          this.opts.logger.info(
            {
              stage: 'SOURCE',
              sync: 'transcribed',
              words: words.length,
              durationMs: Date.now() - started,
            },
            'speech transcribed',
          );
          try {
            mkdirSync(this.cacheDir, { recursive: true });
            const tmp = `${file}.tmp`;
            writeFileSync(
              tmp,
              JSON.stringify({
                v: 1,
                model: this.model.name,
                words: words.map((w) => [
                  w.w,
                  Math.round(w.start * 100) / 100,
                  Math.round(w.end * 100) / 100,
                ]),
              }),
              'utf8',
            );
            renameSync(tmp, file);
          } catch {
            /* the saved copy is a convenience */
          }
          return words;
        } catch (err) {
          this.opts.logger.warn(
            {
              stage: 'SOURCE',
              sync: 'failed',
              reason: err instanceof Error ? err.message.slice(0, 80) : 'error',
            },
            'speech transcription failed',
          );
          return undefined;
        }
      })
      .finally(() => {
        this.inFlight.delete(file);
      });
    this.queue = work;
    this.inFlight.set(file, work);
    return work;
  }
}
