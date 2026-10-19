import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheKey, type FileCache, sha256 } from '../cache/fileCache';
import type { Config } from '../config/env';
import { findLanguage } from '../config/languages';
import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { rankSameLanguage, selectSubtitle } from '../sources/select';
import {
  findStream,
  findStreamWaiting,
  loadEmbeddedSubtitle,
  locateTools,
} from '../sources/embedded';
import { alignCues, type SpokenWord } from '../sync/align';
import { applyFit, type TimingFit } from '../sync/fit';
import type { LocalStream } from '../sync/service';
import { cinemetaTitle, kitsuTitles, makeTitleResolver, parseFilename } from '../sources/titles';
import type { Library } from './library';
import type { SourceSubtitleProvider, SubtitleCandidate, VideoRef } from '../sources/types';
import { type ConsensusItem, pickByConsensus } from '../subtitles/consensus';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import type { ChunkCue } from '../subtitles/chunk';
import { stripForeignScripts } from '../subtitles/validate';
import type { Cue } from '../subtitles/types';
import { CancelledError, translateSubtitle, type ChunkStore } from '../translation/pipeline';
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
  /** Cache entries that belong to this subtitle (for the library's delete). */
  cacheKeys?: string[];
  /** False when the timing is only a best guess (OpenSubtitles fallback): the job is checked again later. */
  exact?: boolean;
  /**
   * For the library: taken from the video itself (or a hash match), placed on the speech (very
   * close, not exact), or only guessed?
   */
  timing?: 'exact' | 'speech' | 'estimated';
}

export interface Job {
  id: string;
  spec: JobSpec;
  /** pending: waiting for the user's OK (ask mode). cancelled: the user cancelled it. */
  status: 'pending' | 'running' | 'done' | 'failed' | 'cancelled';
  startedAt: number;
  finishedAt?: number;
  result?: JobResult;
  error?: AppError;
  /** Lines finished so far / total lines of this media file. */
  progress?: { done: number; total: number };
  /** What the job is doing now, so the page can say where it is. */
  stage?: 'queued' | 'local' | 'sync' | 'search' | 'translate';
  /** Progress of listening to the video while the stage is 'sync', 0..100. */
  syncPercent?: number;
  /** Display name for the queue (filled in shortly after the job is created). */
  title?: string;
  /** Set when the user cancelled it; the translation stops before its next request. */
  cancelled?: boolean;
  /** Ends the wait for a running job right away (set while it runs). */
  abort?: () => void;
  /** Set while the job is in a step the user may skip (video's own subtitle, listening to the video). */
  skipNow?: () => void;
  promise: Promise<void>;
}

/** One line of the queue shown on the main screen. */
export interface QueueItem {
  id: string;
  title: string;
  season?: number;
  episode?: number;
  state: 'pending' | 'queued' | 'running';
  percent: number | null;
  /** The step the user may skip right now: looking inside the video, or listening to it. */
  skippable?: 'local' | 'sync';
}

/** The speech tool, as the manager uses it (see sync/service.ts). */
export interface SyncPort {
  ready(): boolean;
  readonly leadSec: number;
  words(
    stream: LocalStream,
    o: { ffmpeg: string; onProgress?: (percent: number) => void },
  ): Promise<SpokenWord[] | undefined>;
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
  /** Source used only to read the daily allowance (read-only); defaults to makeSource. */
  makeQuotaSource?: (config: Config, logger: Logger) => SourceSubtitleProvider;
  now?: () => number;
  /** Used for title lookups (Kitsu, Cinemeta). Injectable for tests. */
  fetchImpl?: typeof fetch;
  /** A failed job may be started again after this long. */
  retryFailedAfterMs?: number;
  /** After a cancel, a new request for the same video starts again only after this long (default 20 s). */
  cancelCooldownMs?: number;
  /** A finished job with guessed timing is checked again after this long (default 15 s). */
  refreshGuessAfterMs?: number;
  /** Hard caps so one stuck step can never block the queue (defaults: 2 min 20 s, 2 min, 1 hour). */
  limits?: {
    embeddedCapMs?: number;
    sourceCapMs?: number;
    jobCapMs?: number;
    speechCapMs?: number;
  };
  /** Precise sync by speech (optional): listens to the video and puts the subtitle on the words. */
  sync?: SyncPort;
  /** Test hooks: where the playing video is on Stremio's server, and which ffmpeg to use. */
  findStream?: (
    serverUrl: string,
    filename: string,
    fetchImpl?: typeof fetch,
  ) => Promise<LocalStream | undefined>;
  ffmpegFor?: (cfg: Config) => string | undefined;
  /** Checks a subtitle's timing against the video's sound (a few short pieces); optional. */
  speechFit?: (o: {
    url: string;
    ffmpeg: string;
    cues: Cue[];
    signal: AbortSignal;
    onProgress?: (percent: number) => void;
  }) => Promise<TimingFit | undefined>;
  /** When set, every finished subtitle is listed here so the user can review and delete it. */
  library?: Library;
  /** Ask mode: called once when a new request is waiting for the user's OK (for a notification). */
  onPending?: (item: { title: string; season?: number; episode?: number }) => void;
  /** Developer test mode: made-up subtitles are not listed in the library. */
  testMode?: () => boolean;
  /** Reads a subtitle track from the playing video file. Injectable for tests. */
  loadEmbedded?: typeof loadEmbeddedSubtitle;
}

const JOB_ID = /^[0-9a-f]{32}$/;

/** Where a job's source subtitle came from and what to do with it. */
interface ChosenSource {
  kind: 'direct' | 'translate';
  language: string;
  raw: string;
  /** Timing is known to match this exact video (its own subtitle, or a file-hash match). */
  exact: boolean;
}
/**
 * Version of the rules that choose the source subtitle. It is part of the whole-job cache key, so
 * subtitles made under older rules (which may be out of sync) are made again, instead of being
 * replayed forever. Bump it whenever the choice of source changes. Translations themselves are
 * cached by their text, so redoing a job with an unchanged source costs no AI requests.
 * 2: subtitle inside the video file first, timing consensus among downloads.
 * 3: wait a few seconds for Stremio's server to load the torrent before giving up on that.
 * 4: also use subtitle files that ship in the same torrent as the video.
 * 5: a result from the OpenSubtitles fallback is kept apart and checked again, so the video's own
 *    subtitle is used once the video is on Stremio's local server.
 * 6: precise sync by speech is part of the key (turning it on makes subtitles again).
 * 7: lines placed on the speech stay on screen at least one second.
 * 8: stray letters of any foreign alphabet are removed, also from subtitles made before.
 */
const SOURCE_LOGIC_VERSION = 9;

/** Files compared for timing when there is no hash match. Each uncached one costs a download. */
const CONSENSUS_POOL_SIZE = 3;
const CONSENSUS_MIN_LEFT = 30;
const QUOTA_REFRESH_MS = 10 * 60_000;
/** After a cancel, the same request is not started again by itself for this long (auto mode). */
const CANCEL_COOLDOWN_MS = 20_000;

/** Race a promise against a timer. The loser keeps running in the background, but nobody waits for it. */
function withCap<T>(work: Promise<T>, ms: number, onTimeout: () => T | Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      try {
        resolve(onTimeout());
      } catch (err) {
        reject(err);
      }
    }, ms);
    timer.unref();
  });
  return Promise.race([work, cap]).finally(() => clearTimeout(timer));
}

export function isJobId(s: string): boolean {
  return JOB_ID.test(s);
}

/** Deterministic job id: same request and settings -> same job -> shared work and cache. */
export function jobIdFor(spec: JobSpec, model: string, dual = false): string {
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
    ...(dual ? { dual } : {}),
  }).slice(0, 32);
}

/** Requests for the same episode in the same language are one thing to the user (Stremio asks twice). */
function videoKey(spec: JobSpec): string {
  const v = spec.video;
  return [v.idKind, v.externalId, v.season ?? '', v.episode ?? '', spec.targetLanguage].join(':');
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly now: () => number;
  private linesTranslated = 0;
  /** Size of the subtitle files translated this session, in bytes. */
  private bytesTranslated = 0;
  private started = 0;
  private lastFailed = false;
  private lastErrorCode: string | null = null;
  private rateLimited = 0;
  /** Downloads OpenSubtitles said are left today, from the latest download. */
  private downloadsLeft: number | undefined;
  /** The account's daily allowance as last reported by OpenSubtitles. */
  private quota: { limit: number; left: number } | undefined;
  /** Files downloaded from SubDL this session (SubDL does not report a daily allowance). */
  private subdlDownloads = 0;
  /** Steps the user has skipped, per episode: every request for it (another file, a re-ask) skips them too. */
  private readonly skipped = new Map<string, Set<'local' | 'sync'>>();
  private quotaCheckedAt = 0;
  private quotaChecking = false;
  /** Translations in progress, by translation cache key, so identical requests share one. */
  private readonly translating = new Map<
    string,
    { work: ReturnType<typeof translateSubtitle>; watchers: Set<Job>; lead: Job }
  >();

  constructor(private readonly deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
    mkdirSync(deps.jobsDir, { recursive: true });
  }

  /** Start (or join) the job for this request. Returns immediately. */
  ensure(spec: JobSpec, restored = false): Job {
    const cfg = this.deps.config();
    const id = jobIdFor(spec, cfg.aiModel, cfg.dualSubtitles);
    const existing = this.jobs.get(id);
    if (existing) {
      const retryable =
        (existing.status === 'failed' &&
          this.now() - (existing.finishedAt ?? 0) > (this.deps.retryFailedAfterMs ?? 60_000)) ||
        // After a cancel Stremio asks again within seconds; that must not undo the user's answer.
        // Ask mode only asks again, so it may restart at once.
        (existing.status === 'cancelled' &&
          (cfg.translationMode === 'ask' ||
            this.now() - (existing.finishedAt ?? 0) >
              (this.deps.cancelCooldownMs ?? CANCEL_COOLDOWN_MS)));
      // A finished subtitle whose timing was only a guess is checked again: the video's own
      // subtitle may be available now (the stream was not on Stremio's local server before).
      const refresh =
        existing.status === 'done' &&
        existing.result?.exact === false &&
        this.now() - (existing.finishedAt ?? 0) > (this.deps.refreshGuessAfterMs ?? 15_000);
      if (!retryable && !refresh) return existing;
    }
    // A fresh wait for an episode starts with no skipped steps.
    if (
      ![...this.jobs.values()].some(
        (j) =>
          (j.status === 'pending' || j.status === 'running') && videoKey(j.spec) === videoKey(spec),
      )
    ) {
      this.skipped.delete(videoKey(spec));
    }
    this.saveSpec(id, spec);
    this.started++;
    // Ask mode: a subtitle made before is served at once; a new one waits for the user's OK, and
    // choosing another video drops the ones still waiting.
    const ask = cfg.translationMode === 'ask' && !this.deps.library?.has(id);
    const firstOfEpisode =
      !restored &&
      ![...this.jobs.values()].some(
        (j) => j.status === 'pending' && videoKey(j.spec) === videoKey(spec),
      );
    // A job brought back from disk for an old /sub address must not push out what the user is
    // deciding about now.
    if (ask && !restored) {
      for (const other of this.jobs.values()) {
        if (other.status === 'pending' && videoKey(other.spec) !== videoKey(spec)) {
          this.jobs.delete(other.id);
        }
      }
    }
    const job: Job = {
      id,
      spec,
      status: ask ? 'pending' : 'running',
      startedAt: this.now(),
      stage: 'queued',
      promise: Promise.resolve(),
    };
    if (!ask) job.promise = this.schedule(job);
    this.jobs.set(id, job);
    void this.titleFor(job).then((t) => {
      job.title = t;
      // One notification per episode, and none for a request dropped meanwhile.
      if (job.status !== 'pending' || this.jobs.get(job.id) !== job || !firstOfEpisode) return;
      const v = job.spec.video;
      this.deps.onPending?.({
        title: t,
        ...(v.season !== undefined ? { season: v.season } : {}),
        ...(v.episode !== undefined ? { episode: v.episode } : {}),
      });
    });
    return job;
  }

  /** Jobs for the same episode as `id` (itself included): what one click of the user applies to. */
  private siblings(id: string): Job[] {
    const job = this.jobs.get(id);
    if (!job) return [];
    const key = videoKey(job.spec);
    return [...this.jobs.values()].filter((j) => videoKey(j.spec) === key);
  }

  /** The user said yes: start the jobs of this episode that were waiting for approval. */
  approve(id: string): boolean {
    let started = false;
    for (const job of this.siblings(id)) {
      if (job.status !== 'pending') continue;
      job.status = 'running';
      job.stage = 'queued';
      job.startedAt = this.now();
      job.promise = this.schedule(job);
      started = true;
    }
    return started;
  }

  /** The user said no: drop the waiting jobs of this episode, or stop queued and running ones. */
  cancel(id: string): boolean {
    let done = false;
    for (const job of this.siblings(id)) {
      if (job.status === 'pending') {
        this.jobs.delete(job.id);
        done = true;
      } else if (job.status === 'running') {
        job.cancelled = true;
        job.abort?.();
        if (job.stage === 'queued') {
          // Still waiting for a free slot: it is over now, not when a slot opens up.
          job.status = 'cancelled';
          job.finishedAt = this.now();
        }
        done = true;
      }
    }
    return done;
  }

  /** Another request for this episode already has its subtitle (Stremio asks again with another file). */
  private episodeServed(job: Job): boolean {
    const key = videoKey(job.spec);
    return [...this.jobs.values()].some(
      (j) => j !== job && j.status === 'done' && videoKey(j.spec) === key,
    );
  }

  /** The user said skip: give up the current slow step (video's own subtitle, speech) and go on. */
  skip(id: string): boolean {
    const jobs = this.siblings(id).filter((j) => j.status === 'running' && j.skipNow);
    const step = this.skippableStep(jobs);
    const first = jobs[0];
    if (!step || !first) return false;
    // The step is skipped for the whole episode, also for a request that reaches it later.
    const key = videoKey(first.spec);
    this.skipped.set(key, (this.skipped.get(key) ?? new Set()).add(step));
    for (const job of jobs) if (job.stage === step) job.skipNow?.();
    return true;
  }

  /** The step one Skip applies to: the earliest one any request of the episode is in. */
  private skippableStep(jobs: Job[]): 'local' | 'sync' | undefined {
    if (jobs.some((j) => j.skipNow && j.stage === 'local')) return 'local';
    if (jobs.some((j) => j.skipNow && j.stage === 'sync')) return 'sync';
    return undefined;
  }

  /** Runs `work`, but returns `fallback` at once if the user skips this step. */
  private async skippable<T>(
    job: Job,
    step: 'local' | 'sync',
    start: (wasSkipped: () => boolean) => Promise<T>,
    fallback: T,
  ): Promise<T> {
    // Already skipped for this episode by an earlier click: do not even start.
    if (this.skipped.get(videoKey(job.spec))?.has(step)) return fallback;
    let flag = false;
    const skipped = new Promise<T>((resolve) => {
      job.skipNow = () => {
        flag = true;
        resolve(fallback);
      };
    });
    const work = start(() => flag);
    work.catch(() => undefined); // if skipped, it ends by itself in the background
    try {
      return await Promise.race([work, skipped]);
    } finally {
      delete job.skipNow;
    }
  }

  /** What the user can still act on, one line per episode: waiting for approval, queued or running. */
  queue(): QueueItem[] {
    const groups = new Map<string, Job[]>();
    for (const j of this.jobs.values()) {
      if (j.status !== 'pending' && j.status !== 'running') continue;
      const key = videoKey(j.spec);
      groups.set(key, [...(groups.get(key) ?? []), j]);
    }
    // Once one request for an episode has produced its subtitle, the requests that were already
    // waiting at that moment are not shown any more: they are the same episode asked for again
    // (another file). A request made after that is a new wait and is shown.
    for (const [key, active] of groups) {
      const startedFirst = Math.min(...active.map((j) => j.startedAt));
      const served = [...this.jobs.values()].some(
        (j) =>
          j.status === 'done' && videoKey(j.spec) === key && (j.finishedAt ?? 0) >= startedFirst,
      );
      if (served) groups.delete(key);
    }
    const items: QueueItem[] = [];
    for (const jobs of groups.values()) {
      const first = jobs[0] as Job;
      const running = jobs.filter((j) => j.status === 'running' && j.stage !== 'queued');
      const state: QueueItem['state'] = running.length
        ? 'running'
        : jobs.some((j) => j.status === 'running')
          ? 'queued'
          : 'pending';
      const percents = jobs.flatMap((j) =>
        j.progress && j.progress.total > 0
          ? [Math.min(100, Math.floor((j.progress.done / j.progress.total) * 100))]
          : [],
      );
      const v = first.spec.video;
      const skippable = this.skippableStep(running);
      items.push({
        id: first.id,
        title: jobs.find((j) => j.title)?.title ?? v.externalId,
        ...(v.season !== undefined ? { season: v.season } : {}),
        ...(v.episode !== undefined ? { episode: v.episode } : {}),
        state,
        percent: percents.length ? Math.max(...percents) : null,
        ...(skippable ? { skippable } : {}),
      });
    }
    return items;
  }

  /** Live numbers for the status card. Counts this app session only. */
  stats(): {
    state: 'waiting' | 'translating' | 'ratelimited' | 'idle' | 'error';
    running: number;
    linesTranslated: number;
    bytesTranslated: number;
    progress: { done: number; total: number; percent: number } | null;
    stage: Job['stage'] | null;
    /** While a video is being listened to: how far it is, 0..100. */
    syncPercent: number | null;
    /** Code of the latest failure while the state is 'error' (never text from the video). */
    lastError: string | null;
    /** OpenSubtitles daily downloads: allowed and left, or null when not known (yet). */
    quota: { limit: number; left: number } | null;
    /** Downloads from SubDL this session. */
    subdlDownloads: number;
    queue: QueueItem[];
  } {
    const running = [...this.jobs.values()].filter((j) => j.status === 'running').length;
    const state =
      running > 0
        ? this.rateLimited > 0
          ? 'ratelimited'
          : 'translating'
        : this.started === 0
          ? 'waiting'
          : this.lastFailed
            ? 'error'
            : 'idle';
    // The file being worked on now, else the most recent one that reported progress.
    const withProgress = [...this.jobs.values()].filter((j) => j.progress);
    // While something is running, the card describes that, never an earlier finished subtitle.
    const runningWithProgress = withProgress.filter((j) => j.status === 'running');
    const current = running > 0 ? runningWithProgress.pop() : withProgress.pop();
    const p = current?.progress;
    const progress =
      p && p.total > 0
        ? {
            done: p.done,
            total: p.total,
            percent: Math.min(100, Math.floor((p.done / p.total) * 100)),
          }
        : null;
    const latest = [...this.jobs.values()].filter((j) => j.status === 'running').pop();
    const stage = latest?.stage ?? null;
    return {
      state,
      running,
      linesTranslated: this.linesTranslated,
      bytesTranslated: this.bytesTranslated,
      progress,
      stage,
      syncPercent: stage === 'sync' ? (latest?.syncPercent ?? 0) : null,
      lastError: state === 'error' ? this.lastErrorCode : null,
      quota: this.quota ? { ...this.quota } : null,
      subdlDownloads: this.subdlDownloads,
      queue: this.queue(),
    };
  }

  /**
   * Ask OpenSubtitles how many downloads the account has left today. At most once every 10
   * minutes, never in parallel, and a failure only leaves the old number in place.
   */
  async refreshQuota(): Promise<void> {
    const nowMs = (this.deps.now ?? Date.now)();
    if (this.quotaChecking || nowMs - this.quotaCheckedAt < QUOTA_REFRESH_MS) return;
    this.quotaChecking = true;
    this.quotaCheckedAt = nowMs;
    try {
      const cfg = this.deps.config();
      const found = await (this.deps.makeQuotaSource ?? this.deps.makeSource)(
        cfg,
        this.deps.logger,
      ).quota?.();
      if (found) {
        this.quota = found;
        this.downloadsLeft = found.left;
      }
    } catch {
      // the meter is optional
    } finally {
      this.quotaChecking = false;
    }
  }

  /** Forget finished jobs so a cleared cache is not shadowed by results kept in memory. */
  forgetFinished(): void {
    for (const [id, job] of this.jobs) {
      if (job.status !== 'running' && job.status !== 'pending') this.jobs.delete(id);
    }
  }

  /** Forget one finished job (its subtitle was deleted); a running job is left alone. */
  forget(id: string): void {
    const status = this.jobs.get(id)?.status;
    if (status !== 'running' && status !== 'pending') this.jobs.delete(id);
  }

  /** List a finished subtitle in the library. Best effort: never affects the job. */
  private async record(job: Job, result: JobResult, log: Logger): Promise<void> {
    const library = this.deps.library;
    if (!library || !result.cacheKeys || this.deps.testMode?.()) return;
    try {
      const v = job.spec.video;
      const title = await this.titleFor(job);
      library.add({
        id: job.id,
        kind: v.type,
        titleKey: `${v.idKind}:${v.externalId}`,
        title,
        ...(v.season !== undefined ? { season: v.season } : {}),
        ...(v.episode !== undefined ? { episode: v.episode } : {}),
        language: job.spec.targetLanguage,
        cues: result.cues,
        bytes: Buffer.byteLength(result.content, 'utf8'),
        createdAt: this.now(),
        keys: result.cacheKeys.slice(0, 5000),
        ...(result.timing ? { timing: result.timing } : {}),
      });
    } catch {
      log.warn({ stage: 'CACHE', errorCode: 'CACHE_WRITE_FAILED' }, 'library entry not saved');
    }
  }

  /** Display name for the library: the metadata title when known, else the file name, else the id. */
  private async titleFor(job: Job): Promise<string> {
    const v = job.spec.video;
    const f = this.deps.fetchImpl ?? fetch;
    try {
      if (v.idKind === 'kitsu') {
        const name = (await kitsuTitles(v.externalId, f))[0];
        if (name) return name;
      } else if (v.imdbId) {
        const name = await cinemetaTitle(v.type, v.imdbId, f);
        if (name) return name;
      }
    } catch {
      /* offline or unknown id: fall through */
    }
    const guess = job.spec.filename ? parseFilename(job.spec.filename) : undefined;
    return guess?.title ?? v.externalId;
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
      return this.ensure(spec, true);
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
    // Cancelling ends the wait at once, even while the job is still in the queue.
    const cancelSignal = new Promise<'cancelled'>((resolve) => {
      job.abort = () => resolve('cancelled');
    });
    await this.acquire();
    const started = this.now();
    try {
      if (job.cancelled) throw new CancelledError();
      const jobCap = this.deps.limits?.jobCapMs ?? 60 * 60_000;
      const work = withCap(this.run(job, log), jobCap, () => {
        throw new AppError('PROVIDER_TIMEOUT', `stuck in stage ${job.stage ?? '?'}`);
      });
      const outcome = await Promise.race([work, cancelSignal]);
      if (outcome === 'cancelled') {
        work.catch(() => undefined); // it stops by itself before its next request
        throw new CancelledError();
      }
      job.result = outcome;
      job.status = 'done';
      this.lastFailed = false;
      this.lastErrorCode = null;
      void this.record(job, job.result, log);
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
      if (err instanceof CancelledError) {
        job.status = 'cancelled';
        log.info({ stage: 'ASSEMBLY', durationMs: this.now() - started }, 'job cancelled');
      } else {
        job.error = isAppError(err)
          ? err
          : new AppError('SOURCE_DOWNLOAD_FAILED', 'unexpected error');
        job.status = 'failed';
        this.lastFailed = true;
        this.lastErrorCode = job.error.code;
        log.warn(
          { errorCode: job.error.code, durationMs: this.now() - started, ...job.error.details },
          'job failed',
        );
      }
    } finally {
      delete job.abort;
      job.finishedAt = this.now();
      this.release();
    }
  }

  /** After the user cancelled, stop at the next step instead of finishing the whole lookup. */
  private stopIfCancelled(job: Job): void {
    if (job.cancelled) throw new CancelledError();
  }

  private async run(job: Job, log: Logger): Promise<JobResult> {
    const cfg = this.deps.config();
    const { cache } = this.deps;
    const lang = findLanguage(job.spec.targetLanguage);
    if (!lang) throw new AppError('CONFIGURATION_INVALID', 'TARGET_LANGUAGE');
    // Always on for right-to-left languages; RTL_FIX=false is the only way to opt out.
    const rtl = cfg.rtlFix && lang.rtl;

    // 1. Whole-job cache: replay costs no network at all.
    const dual = cfg.dualSubtitles;
    const syncOn = cfg.preciseSync && !!this.deps.sync?.ready();
    const jobKey = cacheKey({
      job: job.id,
      rtl,
      ...(dual ? { dual } : {}),
      ...(syncOn ? { sync: true } : {}),
      sourceLogic: SOURCE_LOGIC_VERSION,
      kind: 'job',
    });
    // A subtitle made from OpenSubtitles while the video's own subtitle was not available (the video
    // was not on Stremio's local server yet) is kept under another key and checked again later.
    const tryLocal = cfg.embeddedSubtitles && !!job.spec.filename;
    const fallbackKey = cacheKey({
      job: job.id,
      rtl,
      ...(dual ? { dual } : {}),
      ...(syncOn ? { sync: true } : {}),
      sourceLogic: SOURCE_LOGIC_VERSION,
      kind: 'job-fallback',
    });
    // Everything deleted together with this subtitle if the user removes it from the library.
    const keys = new Set<string>([jobKey, fallbackKey]);
    const hit = cache.get(jobKey);
    if (hit) {
      job.progress = { done: hit.cues, total: hit.cues };
      return {
        content: hit.content,
        via: 'cache',
        cues: hit.cues,
        cacheKeys: [jobKey, fallbackKey],
        exact: true,
      };
    }
    const fallback = tryLocal ? cache.get(fallbackKey) : undefined;

    // 2. Find the best subtitle: the one inside the playing video file first (exact timing, no
    // download), then OpenSubtitles.
    job.stage = 'local';
    let chosen = await this.skippable(
      job,
      'local',
      (wasSkipped) =>
        withCap(
          this.embeddedSource(
            job,
            cfg,
            lang.code,
            log,
            !!fallback || this.episodeServed(job),
            wasSkipped,
          ),
          this.deps.limits?.embeddedCapMs ?? 140_000, // one try is 30 s; a loading video gets up to 2 min
          () => {
            log.warn({ stage: 'SOURCE', embedded: 'cap' }, 'embedded lookup took too long');
            return undefined;
          },
        ),
      undefined,
    );
    this.stopIfCancelled(job);
    if (!chosen && fallback) {
      // Still not available: keep what OpenSubtitles gave last time.
      job.progress = { done: fallback.cues, total: fallback.cues };
      return {
        content: fallback.content,
        via: 'cache',
        cues: fallback.cues,
        cacheKeys: [jobKey, fallbackKey],
        exact: false,
        timing: 'estimated',
      };
    }
    let placedOnSpeech = false;
    if (!chosen) {
      // Precise sync: listen to the video once (a few minutes, then remembered) and use the words.
      if (syncOn && job.spec.filename) job.stage = 'sync';
      const words =
        syncOn && job.spec.filename
          ? await this.skippable(job, 'sync', () => this.listen(job, cfg, log), undefined)
          : undefined;
      this.stopIfCancelled(job); // the speech tool itself cannot be stopped half way
      job.stage = 'search';
      const search = (forceLanguage?: string) =>
        withCap(
          this.openSubtitlesSource(job, cfg, lang.code, log, forceLanguage),
          this.deps.limits?.sourceCapMs ?? 120_000,
          () => {
            throw new AppError('SOURCE_DOWNLOAD_FAILED', 'source search timed out');
          },
        );
      chosen = await search(words ? 'en' : undefined);
      if (words && this.deps.sync) {
        const aligned =
          chosen.language === 'en'
            ? alignCues(parseSubtitle(chosen.raw).cues, words, { leadSec: this.deps.sync.leadSec })
            : undefined;
        if (aligned) {
          placedOnSpeech = true;
          log.info(
            {
              stage: 'SOURCE',
              sync: 'aligned',
              matched: Math.round(aligned.matchedRatio * 100),
              cues: aligned.cues.length,
            },
            'subtitle placed on the speech',
          );
          chosen = {
            kind: chosen.kind,
            language: 'en',
            raw: serializeSubtitle({ format: 'srt', cues: aligned.cues }),
            exact: true,
          };
        } else if (chosen.language === 'en' && lang.code !== 'en') {
          // The English text did not match the speech: use what would have been chosen anyway.
          log.info(
            { stage: 'SOURCE', sync: 'not-matching' },
            'subtitle text does not match the speech',
          );
          chosen = await search();
        }
      }
      // No exact timing: listen to a few short pieces of the video and move the subtitle onto them.
      if (!placedOnSpeech && !chosen.exact && this.deps.speechFit && job.spec.filename) {
        job.stage = 'sync';
        const picked = chosen;
        const moved = await this.skippable(
          job,
          'sync',
          (wasSkipped) => this.fitToSpeech(job, cfg, log, picked, wasSkipped),
          undefined,
        );
        this.stopIfCancelled(job);
        if (moved) {
          placedOnSpeech = true;
          chosen = moved;
        }
      }
    }
    // Only a subtitle known to match this video goes under the main key.
    const outKey = chosen.exact || !tryLocal ? jobKey : fallbackKey;
    const exact = chosen.exact || !tryLocal;
    const timing: 'exact' | 'speech' | 'estimated' = placedOnSpeech
      ? 'speech'
      : chosen.exact
        ? 'exact'
        : 'estimated';
    this.stopIfCancelled(job);
    const raw = chosen.raw;
    const parsed = parseSubtitle(raw);
    log.info({ stage: 'PARSER', cues: parsed.cues.length, format: parsed.format }, 'source parsed');
    job.progress = { done: 0, total: parsed.cues.length };
    job.stage = 'translate';

    // 4a. Already in the target language: serve as SRT, no translation.
    if (chosen.kind === 'direct') {
      const content = serializeSubtitle({ format: 'srt', cues: parsed.cues });
      this.safeSet(outKey, 'translation', content, parsed.cues.length, log);
      job.progress = { done: parsed.cues.length, total: parsed.cues.length };
      return {
        content,
        via: 'direct',
        cues: parsed.cues.length,
        cacheKeys: [...keys],
        exact,
        timing,
      };
    }

    // 4b. Translate (or reuse an identical earlier translation).
    const provider = this.deps.makeProvider(cfg);
    const model = provider.getModelInformation();
    const normalized = parsed.cues.map((c) => `${c.startMs}|${c.endMs}|${c.text}`).join('\n');
    const trKey = cacheKey({
      src: sha256(normalized),
      target: lang.code,
      sourceLang: chosen.language,
      provider: model.provider,
      model: model.model,
      prompt: PROMPT_VERSION,
      rtl,
      ...(dual ? { dual } : {}),
      kind: 'translation',
    });
    keys.add(trKey);
    const cached = cache.get(trKey);
    if (cached) {
      // A translation made before stray foreign letters were removed is cleaned now (no AI request).
      const fixed = this.cleanCachedTranslation(cached.content, parsed.cues, lang.code);
      if (fixed) {
        log.info(
          { stage: 'VALIDATION' },
          'removed stray foreign-script letters from a saved subtitle',
        );
        this.safeSet(trKey, 'translation', fixed, cached.cues, log);
        cached.content = fixed;
      }
      this.safeSet(outKey, 'translation', cached.content, cached.cues, log);
      job.progress = { done: parsed.cues.length, total: parsed.cues.length };
      return {
        content: cached.content,
        via: 'cache',
        cues: cached.cues,
        cacheKeys: [...keys],
        exact,
      };
    }

    const chunkStore: ChunkStore = {
      keyFor: (chunk) => {
        const key = cacheKey({
          kind: 'chunk',
          src: sha256(chunk.cues.map((c) => `${c.index}|${c.text}`).join('\n')),
          ctx: sha256(
            [...chunk.context, ...chunk.upcoming].map((c) => `${c.id}|${c.text}`).join('\n'),
          ),
          target: lang.code,
          provider: model.provider,
          model: model.model,
          prompt: PROMPT_VERSION,
        });
        keys.add(key);
        return key;
      },
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

    // Stremio often asks for the same subtitle twice at once (two job ids, one text). The second
    // request waits for the first translation instead of paying the AI for it again.
    const sharing = this.translating.get(trKey);
    const watchers = sharing?.watchers ?? new Set<Job>([job]);
    if (sharing) {
      watchers.add(job);
      if (sharing.lead.progress) job.progress = { ...sharing.lead.progress };
    }
    const work =
      sharing?.work ??
      translateSubtitle(parsed, provider, {
        chunkStore,
        targetLanguageCode: lang.code,
        targetLanguageName: lang.name,
        chunkSize: cfg.chunkSize,
        concurrency: cfg.chunkConcurrency,
        maxValidationRetries: cfg.chunkMaxRetries,
        rtlFix: rtl,
        dualSubtitles: dual,
        isCancelled: () => [...watchers].every((w) => w.cancelled),
        requestGapMs: cfg.chunkDelayMs,
        onRateLimitWait: (d) => {
          this.rateLimited = Math.max(0, this.rateLimited + d);
        },
        onProgress: (done, total) => {
          for (const w of watchers) w.progress = { done, total };
        },
        logger: log,
        logDialogue: cfg.logDialogue,
      });
    if (!sharing) {
      this.translating.set(trKey, { work, watchers, lead: job });
      const forget = (): void => void this.translating.delete(trKey);
      work.then(forget, forget);
    }
    const result = await work;
    watchers.delete(job);
    job.progress = { done: result.file.cues.length, total: result.file.cues.length };
    const content = serializeSubtitle({ format: 'srt', cues: result.file.cues });
    // Only fully validated translations reach this point.
    this.safeSet(trKey, 'translation', content, result.file.cues.length, log);
    this.safeSet(outKey, 'translation', content, result.file.cues.length, log);
    if (!sharing) {
      this.linesTranslated += result.file.cues.length;
      this.bytesTranslated += Buffer.byteLength(content);
    }
    keys.add(trKey);
    return {
      content,
      via: 'translated',
      cues: result.file.cues.length,
      cacheKeys: [...keys],
      exact,
      timing,
    };
  }

  /** Listen to the playing video through Stremio's server; the words with times, or undefined. */
  private async listen(job: Job, cfg: Config, log: Logger): Promise<SpokenWord[] | undefined> {
    const sync = this.deps.sync;
    if (!sync || !job.spec.filename) return undefined;
    const ffmpeg = this.deps.ffmpegFor
      ? this.deps.ffmpegFor(cfg)
      : locateTools(cfg.ffmpegPath)?.ffmpeg;
    if (!ffmpeg) return undefined;
    try {
      const stream = this.deps.findStream
        ? await this.deps.findStream(cfg.stremioServerUrl, job.spec.filename, this.deps.fetchImpl)
        : await findStreamWaiting(cfg.stremioServerUrl, job.spec.filename, {
            fetchImpl: this.deps.fetchImpl,
          });
      if (!stream) {
        log.info({ stage: 'SOURCE', sync: 'not-local' }, 'precise sync skipped');
        return undefined;
      }
      job.stage = 'sync';
      job.syncPercent = 0;
      return await sync.words(stream, {
        ffmpeg,
        onProgress: (p) => {
          job.syncPercent = p;
        },
      });
    } catch {
      return undefined;
    } finally {
      delete job.syncPercent;
    }
  }

  /**
   * Moves a guessed-timing subtitle onto the video's real speech. Returns the moved subtitle, or
   * undefined (leave it as it is) when the video is not on this computer, it is not sure, or it took too long.
   */
  private async fitToSpeech(
    job: Job,
    cfg: Config,
    log: Logger,
    picked: ChosenSource,
    wasSkipped: () => boolean,
  ): Promise<ChosenSource | undefined> {
    const fit = this.deps.speechFit;
    const filename = job.spec.filename;
    const ffmpeg = this.deps.ffmpegFor
      ? this.deps.ffmpegFor(cfg)
      : locateTools(cfg.ffmpegPath)?.ffmpeg;
    if (!fit || !filename || !ffmpeg) return undefined;
    const abort = new AbortController();
    const watch = setInterval(() => {
      if (job.cancelled || wasSkipped()) abort.abort();
    }, 500);
    const cap = setTimeout(() => abort.abort(), this.deps.limits?.speechCapMs ?? 300_000);
    try {
      const find = this.deps.findStream ?? findStream;
      const stream = await find(cfg.stremioServerUrl, filename, this.deps.fetchImpl);
      if (!stream) return undefined;
      job.syncPercent = 0;
      const cues = parseSubtitle(picked.raw).cues;
      const result = await fit({
        url: stream.url,
        ffmpeg,
        cues,
        signal: abort.signal,
        onProgress: (p) => {
          job.syncPercent = p;
        },
      });
      if (!result) {
        log.info({ stage: 'SOURCE', sync: 'fit-unsure' }, 'timing left as it was');
        return undefined;
      }
      log.info(
        {
          stage: 'SOURCE',
          sync: 'fitted',
          offsetMs: result.offsetMs,
          scale: Math.round(result.scale * 10000) / 10000,
        },
        'subtitle moved onto the speech',
      );
      return {
        ...picked,
        raw: serializeSubtitle({ format: 'srt', cues: applyFit(cues, result) }),
        exact: true,
      };
    } catch {
      return undefined;
    } finally {
      clearInterval(watch);
      clearTimeout(cap);
      delete job.syncPercent;
    }
  }

  /** A text subtitle track inside the video that is playing (Stremio's local server), if any. */
  private async embeddedSource(
    job: Job,
    cfg: Config,
    target: string,
    log: Logger,
    quick = false,
    wasSkipped: () => boolean = () => false,
  ): Promise<ChosenSource | undefined> {
    if (!cfg.embeddedSubtitles || !job.spec.filename) return undefined;
    const load = this.deps.loadEmbedded ?? loadEmbeddedSubtitle;
    const found = await load(
      { filename: job.spec.filename, targetLanguage: target },
      {
        serverUrl: cfg.stremioServerUrl,
        ffmpegPath: cfg.ffmpegPath,
        logger: log,
        // A recheck (a guessed-timing subtitle was already served) tries once, without the long wait.
        ...(quick ? { waitMs: 0, retryBudgetMs: 0 } : {}),
        shouldStop: () => !!job.cancelled || wasSkipped(),
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      },
    );
    if (!found) return undefined;
    const kind = found.language.toLowerCase() === target.toLowerCase() ? 'direct' : 'translate';
    return { kind, language: found.language, raw: found.raw, exact: true };
  }

  /** The best subtitle OpenSubtitles has: search, timing consensus, then download. */
  private async openSubtitlesSource(
    job: Job,
    cfg: Config,
    target: string,
    log: Logger,
    /** Take the best subtitle in this language even if the target language has one. */
    forceLanguage?: string,
  ): Promise<ChosenSource> {
    const { cache } = this.deps;
    const lang = { code: target };
    const source = this.deps.makeSource(cfg, log);
    await this.refreshQuota(); // at most every 10 minutes; a failure changes nothing
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
    let selection = selectSubtitle(candidates, lang.code);
    const forced = forceLanguage ? rankSameLanguage(candidates, forceLanguage)[0] : undefined;
    if (forced) {
      selection = { kind: forceLanguage === lang.code ? 'direct' : 'translate', candidate: forced };
    }
    if (selection.kind === 'none') throw new AppError('SOURCE_SUBTITLE_NOT_FOUND');
    let candidate = selection.candidate;
    log.info(
      {
        stage: 'SOURCE',
        decision: selection.kind,
        provider: candidate.provider ?? 'opensubtitles',
        candidates: candidates.length,
        language: candidate.language,
        hashMatch: candidate.hashMatch,
      },
      'subtitle selected',
    );

    // 3. Download once per OpenSubtitles file (saves the daily download quota).
    const fetchRaw = async (c: SubtitleCandidate): Promise<string> => {
      const key = cacheKey({
        provider: c.provider ?? 'opensubtitles',
        fileId: c.fileId,
        kind: 'source',
      });
      const known = cache.get(key)?.content;
      if (known !== undefined) return known;
      const dl = await source.download(c);
      if (c.provider === 'subdl') this.subdlDownloads++;
      this.downloadsLeft = dl.remaining ?? this.downloadsLeft;
      if (this.quota && dl.remaining !== undefined) this.quota.left = dl.remaining;
      this.safeSet(key, 'source', dl.content, 0, log);
      return dl.content;
    };

    // 3a. No hash match means the timing may belong to another release of the video. Compare a
    // few files of the same language and take the one whose timing most of the others share.
    // Skipped when few downloads are left today: each file compared costs one.
    // Only when OpenSubtitles has said plenty are left (a free account has few per day): the
    // first subtitle of a session never triggers it, so an account is never drained blindly.
    // The OpenSubtitles daily limit is the one being protected, so only its files are compared.
    const isSubdl = (c: SubtitleCandidate) => c.provider === 'subdl';
    if (
      !candidate.hashMatch &&
      !isSubdl(candidate) &&
      this.downloadsLeft !== undefined &&
      this.downloadsLeft >= CONSENSUS_MIN_LEFT
    ) {
      const pool = rankSameLanguage(
        candidates.filter((c) => !isSubdl(c)),
        candidate.language,
      ).slice(0, CONSENSUS_POOL_SIZE);
      if (pool.length >= 3) {
        const loaded: ConsensusItem<SubtitleCandidate>[] = [];
        for (const c of pool) {
          try {
            loaded.push({ item: c, cues: parseSubtitle(await fetchRaw(c)).cues });
          } catch (err) {
            const code = isAppError(err) ? err.code : 'UNKNOWN';
            log.warn({ stage: 'SOURCE', fileId: c.fileId, errorCode: code }, 'consensus skip');
          }
        }
        const picked = pickByConsensus(loaded);
        if (picked) {
          log.info(
            {
              stage: 'SOURCE',
              compared: loaded.length,
              scores: picked.scores.map((s) => Math.round(s * 100)),
              changed: picked.winner.fileId !== candidate.fileId,
            },
            'timing consensus',
          );
          candidate = picked.winner;
        }
      }
    }
    // 3b. When OpenSubtitles has no downloads left, use the second provider's file instead.
    const spare = () => rankSameLanguage(candidates.filter(isSubdl), candidate.language)[0];
    if (this.downloadsLeft === 0 && !isSubdl(candidate)) candidate = spare() ?? candidate;
    let raw: string;
    try {
      raw = await fetchRaw(candidate);
    } catch (err) {
      const alt =
        isAppError(err) && err.code === 'SOURCE_QUOTA_EXCEEDED' && !isSubdl(candidate)
          ? spare()
          : undefined;
      if (!alt) throw err;
      log.info({ stage: 'SOURCE', provider: 'subdl' }, 'OpenSubtitles limit reached, using SubDL');
      candidate = alt;
      raw = await fetchRaw(candidate);
    }
    return {
      kind: selection.kind,
      language: candidate.language,
      raw,
      exact: candidate.hashMatch,
    };
  }

  /** The saved subtitle without stray foreign letters, or undefined when it was already clean. */
  private cleanCachedTranslation(content: string, source: Cue[], code: string): string | undefined {
    try {
      const file = parseSubtitle(content);
      if (file.cues.length !== source.length) return undefined;
      const cleaned = stripForeignScripts(
        source,
        file.cues.map((c, i) => ({ id: String((source[i] as Cue).index), text: c.text })),
        code,
      );
      if (cleaned.every((c, i) => c.text === (file.cues[i] as Cue).text)) return undefined;
      return serializeSubtitle({
        format: file.format,
        cues: file.cues.map((c, i) => ({ ...c, text: (cleaned[i] as ChunkCue).text })),
      });
    } catch {
      return undefined;
    }
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
