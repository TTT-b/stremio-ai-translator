import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheKey, type FileCache, sha256 } from '../cache/fileCache';
import type { Config } from '../config/env';
import { findLanguage } from '../config/languages';
import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { selectSubtitle } from '../sources/select';
import { makeTitleResolver } from '../sources/titles';
import type { SourceSubtitleProvider, VideoRef } from '../sources/types';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import type { ChunkCue } from '../subtitles/chunk';
import { translateSubtitle, type ChunkStore } from '../translation/pipeline';
import { PROMPT_VERSION } from '../translation/prompts/v1';
import type { TranslationProvider } from '../translation/provider';

export interface JobSpec {
  video: VideoRef;
  targetLanguage: string;
  /** OpenSubtitles file hash from Stremio, when present. */
  movieHash?: string;
  /** Video file name from Stremio `extra.filename`; used for the text-search fallback. */
  filename?: string;
}

export interface JobResult {
  /** Final SRT text. */
  content: string;
  via: 'direct' | 'translated' | 'cache';
  cues: number;
}

export interface Job {
  id: string;
  spec: JobSpec;
  status: 'running' | 'done' | 'failed';
  startedAt: number;
  finishedAt?: number;
  result?: JobResult;
  error?: AppError;
  promise: Promise<void>;
}

export interface JobManagerDeps {
  /** Effective config (env + settings.json), read fresh for every job. */
  config: () => Config;
  logger: Logger;
  cache: FileCache;
  /** Directory for small job spec files so /sub URLs survive a restart. */
  jobsDir: string;
  makeSource: (config: Config, logger: Logger) => SourceSubtitleProvider;
  makeProvider: (config: Config) => TranslationProvider;
  now?: () => number;
  /** Used for title lookups (Kitsu, Cinemeta). Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** A failed job may be started again after this long. */
  retryFailedAfterMs?: number;
}

const JOB_ID = /^[0-9a-f]{32}$/;

export function isJobId(s: string): boolean {
  return JOB_ID.test(s);
}

/** Deterministic job id: same request and settings -> same job -> shared work and cache. */
export function jobIdFor(spec: JobSpec, model: string): string {
  return cacheKey({
    idKind: spec.video.idKind,
    id: spec.video.externalId,
    season: spec.video.season,
    episode: spec.video.episode,
    lang: spec.targetLanguage,
    hash: spec.movieHash,
    file: spec.filename,
    model,
    prompt: PROMPT_VERSION,
  }).slice(0, 32);
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly now: () => number;

  constructor(private readonly deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
    mkdirSync(deps.jobsDir, { recursive: true });
  }

  /** Start (or join) the job for this request. Returns immediately. */
  ensure(spec: JobSpec): Job {
    const id = jobIdFor(spec, this.deps.config().geminiModel);
    const existing = this.jobs.get(id);
    if (existing) {
      const retryable =
        existing.status === 'failed' &&
        this.now() - (existing.finishedAt ?? 0) > (this.deps.retryFailedAfterMs ?? 60_000);
      if (!retryable) return existing;
    }
    this.saveSpec(id, spec);
    const job: Job = {
      id,
      spec,
      status: 'running',
      startedAt: this.now(),
      promise: Promise.resolve(),
    };
    job.promise = this.schedule(job);
    this.jobs.set(id, job);
    return job;
  }

  /** Find a job by id, restoring it from disk after a restart. */
  get(id: string): Job | undefined {
    if (!isJobId(id)) return undefined;
    const known = this.jobs.get(id);
    if (known) return known;
    try {
      const spec = JSON.parse(
        readFileSync(join(this.deps.jobsDir, `${id}.json`), 'utf8'),
      ) as JobSpec;
      return this.ensure(spec);
    } catch {
      return undefined;
    }
  }

  /** Wait until the job settles or `ms` elapses. Never throws. */
  async waitFor(job: Job, ms: number): Promise<void> {
    if (job.status !== 'running') return;
    await Promise.race([
      job.promise,
      new Promise<void>((resolve) => setTimeout(resolve, ms).unref()),
    ]);
  }

  private saveSpec(id: string, spec: JobSpec): void {
    try {
      const file = join(this.deps.jobsDir, `${id}.json`);
      writeFileSync(`${file}.tmp`, JSON.stringify(spec), 'utf8');
      renameSync(`${file}.tmp`, file);
    } catch {
      /* best effort: only needed to survive restarts */
    }
  }

  private async acquire(): Promise<void> {
    if (this.running < this.deps.config().maxConcurrentJobs) {
      this.running++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.running--;
  }

  private async schedule(job: Job): Promise<void> {
    const log = this.deps.logger.child({
      jobId: job.id.slice(0, 8),
      idKind: job.spec.video.idKind,
      videoId: job.spec.video.externalId,
      season: job.spec.video.season,
      episode: job.spec.video.episode,
      targetLanguage: job.spec.targetLanguage,
    });
    await this.acquire();
    const started = this.now();
    try {
      job.result = await this.run(job, log);
      job.status = 'done';
      log.info(
        {
          stage: 'ASSEMBLY',
          via: job.result.via,
          cues: job.result.cues,
          durationMs: this.now() - started,
        },
        'job done',
      );
    } catch (err) {
      job.error = isAppError(err)
        ? err
        : new AppError('SOURCE_DOWNLOAD_FAILED', 'unexpected error');
      job.status = 'failed';
      log.warn(
        { errorCode: job.error.code, durationMs: this.now() - started, ...job.error.details },
        'job failed',
      );
    } finally {
      job.finishedAt = this.now();
      this.release();
    }
  }

  private async run(job: Job, log: Logger): Promise<JobResult> {
    const cfg = this.deps.config();
    const { cache } = this.deps;
    const lang = findLanguage(job.spec.targetLanguage);
    if (!lang) throw new AppError('CONFIGURATION_INVALID', 'TARGET_LANGUAGE');
    const rtl = cfg.rtlFix && lang.rtl;

    // 1. Whole-job cache: replay costs no network at all.
    const jobKey = cacheKey({ job: job.id, rtl, kind: 'job' });
    const hit = cache.get(jobKey);
    if (hit) return { content: hit.content, via: 'cache', cues: hit.cues };

    // 2. Find the best subtitle.
    const source = this.deps.makeSource(cfg, log);
    const candidates = await source.search({
      video: job.spec.video,
      languages: [...new Set([lang.code, 'en'])],
      ...(job.spec.movieHash ? { movieHash: job.spec.movieHash } : {}),
      resolveTitles: makeTitleResolver({
        video: job.spec.video,
        filename: job.spec.filename,
        logger: log,
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      }),
    });
    const selection = selectSubtitle(candidates, lang.code);
    if (selection.kind === 'none') throw new AppError('SOURCE_SUBTITLE_NOT_FOUND');
    const candidate = selection.candidate;
    log.info(
      {
        stage: 'SOURCE',
        decision: selection.kind,
        language: candidate.language,
        hashMatch: candidate.hashMatch,
      },
      'subtitle selected',
    );

    // 3. Download once per OpenSubtitles file (saves the daily download quota).
    const dlKey = cacheKey({ provider: 'opensubtitles', fileId: candidate.fileId, kind: 'source' });
    let raw = cache.get(dlKey)?.content;
    if (raw === undefined) {
      raw = (await source.download(candidate)).content;
      this.safeSet(dlKey, 'source', raw, 0, log);
    }
    const parsed = parseSubtitle(raw);
    log.info({ stage: 'PARSER', cues: parsed.cues.length, format: parsed.format }, 'source parsed');

    // 4a. Already in the target language: serve as SRT, no translation.
    if (selection.kind === 'direct') {
      const content = serializeSubtitle({ format: 'srt', cues: parsed.cues });
      this.safeSet(jobKey, 'translation', content, parsed.cues.length, log);
      return { content, via: 'direct', cues: parsed.cues.length };
    }

    // 4b. Translate (or reuse an identical earlier translation).
    const provider = this.deps.makeProvider(cfg);
    const model = provider.getModelInformation();
    const normalized = parsed.cues.map((c) => `${c.startMs}|${c.endMs}|${c.text}`).join('\n');
    const trKey = cacheKey({
      src: sha256(normalized),
      target: lang.code,
      sourceLang: candidate.language,
      provider: model.provider,
      model: model.model,
      prompt: PROMPT_VERSION,
      rtl,
      kind: 'translation',
    });
    const cached = cache.get(trKey);
    if (cached) {
      this.safeSet(jobKey, 'translation', cached.content, cached.cues, log);
      return { content: cached.content, via: 'cache', cues: cached.cues };
    }

    const chunkStore: ChunkStore = {
      keyFor: (chunk) =>
        cacheKey({
          kind: 'chunk',
          src: sha256(chunk.cues.map((c) => `${c.index}|${c.text}`).join('\n')),
          ctx: sha256(chunk.context.map((c) => `${c.id}|${c.text}`).join('\n')),
          target: lang.code,
          provider: model.provider,
          model: model.model,
          prompt: PROMPT_VERSION,
        }),
      get: (key) => {
        const hit = cache.get(key);
        if (!hit) return undefined;
        try {
          return JSON.parse(hit.content) as ChunkCue[];
        } catch {
          return undefined;
        }
      },
      set: (key, translations) =>
        this.safeSet(key, 'translation', JSON.stringify(translations), translations.length, log),
    };

    const result = await translateSubtitle(parsed, provider, {
      chunkStore,
      targetLanguageCode: lang.code,
      targetLanguageName: lang.name,
      chunkSize: cfg.chunkSize,
      concurrency: cfg.chunkConcurrency,
      maxValidationRetries: cfg.chunkMaxRetries,
      rtlFix: rtl,
      logger: log,
      logDialogue: cfg.logDialogue,
    });
    const content = serializeSubtitle({ format: 'srt', cues: result.file.cues });
    // Only fully validated translations reach this point.
    this.safeSet(trKey, 'translation', content, result.file.cues.length, log);
    this.safeSet(jobKey, 'translation', content, result.file.cues.length, log);
    return { content, via: 'translated', cues: result.file.cues.length };
  }

  /** A cache write failure must never fail the job. */
  private safeSet(
    key: string,
    kind: 'translation' | 'source',
    content: string,
    cues: number,
    log: Logger,
  ): void {
    try {
      this.deps.cache.set(key, kind, content, cues);
    } catch (err) {
      log.warn(
        { stage: 'CACHE', errorCode: isAppError(err) ? err.code : 'CACHE_WRITE_FAILED' },
        'cache write failed',
      );
    }
  }
}
