import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  backgroundSync,
  buildQueue,
  exactComing,
  totalEtaSec,
  translateEtaSec,
  type JobStats,
} from './jobStatus';
import { autoRetryDelayMs } from './autoRetry';

/** The "subtitles ready" notice waits this long for a timing check to finish, then is sent anyway. */
const FINISHED_NOTICE_MAX_WAIT_MS = 10 * 60_000;
import { cacheKey, sha256 } from '../cache/fileCache';
import type { Config } from '../config/env';
import { findLanguage } from '../config/languages';
import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { SourceId } from '../sources/ordered';
import { rankSameLanguage, selectSubtitle } from '../sources/select';
import { findStream, loadEmbeddedSubtitle, locateTools } from '../sources/embedded';
import { applyFit, type TimingFit } from '../sync/fit';
import { cinemetaTitle, kitsuTitles, makeTitleResolver, parseFilename } from '../sources/titles';
import type { SubtitleCandidate } from '../sources/types';
import { type ConsensusItem, pickByConsensus } from '../subtitles/consensus';
import { buildCast } from '../subtitles/cast';
import { cleanSubtitle, cleanTranslated } from '../subtitles/clean';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import type { ChunkCue } from '../subtitles/chunk';
import { stripForeignScripts } from '../subtitles/validate';
import { withPartialNotice } from '../stremio/placeholder';
import type { Cue } from '../subtitles/types';
import { ModelFallbackProvider } from '../translation/fallback';
import {
  CancelledError,
  translateSubtitle,
  type ChunkOutcome,
  type ChunkStore,
} from '../translation/pipeline';
import { PROMPT_VERSION } from '../translation/prompts/v1';

import {
  isJobId,
  jobIdFor,
  originOf,
  partsText,
  videoKey,
  withCap,
  SOURCE_LOGIC_VERSION,
  PARTIAL_MIN_TOTAL_CUES,
  PARTIAL_FRACTION,
  UPGRADE_NOTICE_MS,
  SYNC_WAIT_MS,
  SYNC_NO_DATA_MS,
  SYNC_FIND_WAIT_MS,
  SYNC_FIND_EVERY_MS,
  STALL_AFTER_MS,
  CONSENSUS_POOL_SIZE,
  CONSENSUS_MIN_LEFT,
  QUOTA_REFRESH_MS,
  CANCEL_COOLDOWN_MS,
  type ChosenSource,
  type Job,
  type JobManagerDeps,
  type JobResult,
  type JobSpec,
  type QueueItem,
  type SoundFit,
} from './jobTypes';
export { isJobId, jobIdFor, partsText } from './jobTypes';
export type {
  Job,
  JobManagerDeps,
  JobResult,
  JobSpec,
  QueueItem,
  SubtitleOrigin,
} from './jobTypes';

/** The fit would leave the subtitle where it is (no stretch, under 0.1 s): nothing to move. */
function isNoShift(fit: TimingFit): boolean {
  return fit.scale === 1 && Math.abs(fit.offsetMs) < 100 && !fit.parts?.length;
}

export class JobManager {
  private readonly jobs = new Map<string, Job>();
  private running = 0;
  /** Chunks being translated right now, so two jobs for the same text ask the AI only once. */
  private readonly chunksInFlight = new Map<string, Promise<ChunkOutcome>>();
  private readonly waiting: (() => void)[] = [];
  private readonly now: () => number;
  private linesTranslated = 0;
  /** Size of the subtitle files translated this session, in bytes. */
  private bytesTranslated = 0;
  private started = 0;
  private lastFailed = false;
  private lastErrorCode: string | null = null;
  /** Automatic restarts waiting for their time, by episode (see autoRetry.ts). */
  private readonly autoRetries = new Map<string, { at: number; timer: NodeJS.Timeout }>();
  /** Automatic tries already made per episode, forgotten once it is done or cancelled. */
  private readonly autoRetryTries = new Map<string, number>();
  private rateLimited = 0;
  /** The user paused translating: no new part is sent to the AI until they continue. */
  private paused = false;
  private pausedAt = 0;
  private readonly pauseWaiters: { wake: () => void; cancelled: () => boolean }[] = [];
  /** The job the status card follows, so two jobs running together do not make the bar jump. */
  private shownJobId: string | undefined;
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
  /** The latest background upgrade, for the notice on the main screen. */
  private lastUpgrade: {
    title: string;
    season?: number;
    episode?: number;
    at: number;
  } | null = null;
  /** The subtitle Stremio took last (shown on the main screen for a while). */
  private lastDelivered: {
    title: string;
    season?: number;
    episode?: number;
    via: string;
    /** Who gave the source subtitle (OpenSubtitles, SubDL, Jimaku), when known. */
    source?: string;
    at: number;
  } | null = null;
  /** Episodes (with language) whose lines were already counted in `linesTranslated` this session. */
  private countedVideos = new Set<string>();
  /** When each episode last got a failure notice, so Stremio's repeated requests notify once. */
  private failureNoticeAt = new Map<string, number>();
  /** How the latest background sound check ended (shown on the main screen for a while). */
  private lastSync: {
    title: string;
    season?: number;
    episode?: number;
    outcome: 'moved' | 'kept' | 'inSync' | 'unavailable';
    offsetMs?: number;
    at: number;
  } | null = null;
  /** Translations in progress, by translation cache key, so identical requests share one. */
  private readonly translating = new Map<
    string,
    {
      work: ReturnType<typeof translateSubtitle>;
      watchers: Set<Job>;
      lead: Job;
      kicks: Set<() => void>;
    }
  >();

  /** Source downloads in progress, by source cache key, so one file is downloaded once. */
  private readonly downloading = new Map<string, Promise<string>>();

  constructor(private readonly deps: JobManagerDeps) {
    this.now = deps.now ?? Date.now;
    mkdirSync(deps.jobsDir, { recursive: true });
  }

  /** Start (or join) the job for this request. Returns immediately. */
  ensure(spec: JobSpec, restored = false, force = false): Job {
    const cfg = this.deps.config();
    const id = jobIdFor(spec, cfg.aiModel, cfg.dualSubtitles);
    const existing = this.jobs.get(id);
    if (existing) {
      const retryable =
        (force && (existing.status === 'failed' || existing.status === 'cancelled')) ||
        (existing.status === 'failed' &&
          !this.autoRetries.has(videoKey(spec)) &&
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
    const target = this.jobs.get(id);
    if (target) this.clearAutoRetry(videoKey(target.spec), true);
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
    this.releaseCancelledWaiters();
    return done;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause or continue translating. Parts already sent to the AI finish; no new part is sent until
   * the user continues. The time spent paused is not counted in the time estimate.
   */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    if (paused) {
      this.pausedAt = this.now();
      return;
    }
    const pausedMs = this.now() - this.pausedAt;
    for (const job of this.jobs.values()) {
      if (job.status !== 'running') continue;
      if (job.translateStartedAt !== undefined) job.translateStartedAt += pausedMs;
      if (job.progressAt !== undefined) job.progressAt = this.now(); // not a stall: it was paused
    }
    for (const waiter of this.pauseWaiters.splice(0)) waiter.wake();
  }

  /**
   * Resolves at once, or when the user continues if translating is paused. A request that is
   * cancelled meanwhile is let go too (it stops right after), so Cancel works while paused.
   */
  waitWhilePaused(cancelled: () => boolean = () => false): Promise<void> {
    if (!this.paused) return Promise.resolve();
    return new Promise((wake) => this.pauseWaiters.push({ wake, cancelled }));
  }

  private releaseCancelledWaiters(): void {
    for (let i = this.pauseWaiters.length - 1; i >= 0; i--) {
      const waiter = this.pauseWaiters[i];
      if (waiter?.cancelled()) {
        this.pauseWaiters.splice(i, 1);
        waiter.wake();
      }
    }
  }

  /** A translation that has had no news for a while: the AI is probably not answering. */
  private isStalled(job: Job): boolean {
    return (
      !this.paused &&
      job.status === 'running' &&
      job.stage === 'translate' &&
      job.progressAt !== undefined &&
      this.now() - job.progressAt > (this.deps.stallAfterMs ?? STALL_AFTER_MS)
    );
  }

  /** The sound check is waiting for the video's data (nothing new for a while). */
  private isSyncStalled(job: Job): boolean {
    return (
      job.status === 'running' &&
      job.stage === 'sync' &&
      job.syncProgressAt !== undefined &&
      this.now() - job.syncProgressAt > (this.deps.stallAfterMs ?? STALL_AFTER_MS)
    );
  }

  /** The latest cancelled or failed request, unless something newer already covers the same video. */
  private restartable(): Job | undefined {
    const all = [...this.jobs.values()];
    const last = all
      .filter((j) => j.status === 'failed' || j.status === 'cancelled')
      .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];
    if (!last) return undefined;
    const covered = all.some(
      (j) =>
        j !== last &&
        videoKey(j.spec) === videoKey(last.spec) &&
        (j.status === 'done' || j.status === 'running' || j.status === 'pending'),
    );
    return covered ? undefined : last;
  }

  /** Is there something the "Continue" button can do right now? */
  resumable(): boolean {
    const last = this.restartable();
    return (
      [...this.jobs.values()].some((j) => this.isStalled(j) || this.isSyncStalled(j)) ||
      // A failure that is being restarted by itself needs no button.
      (!!last && !this.autoRetries.has(videoKey(last.spec)))
    );
  }

  /** Seconds until the next automatic restart, or null when none is waiting. */
  private autoRetryInSec(): number | null {
    let soonest: number | null = null;
    for (const { at } of this.autoRetries.values()) {
      if (soonest === null || at < soonest) soonest = at;
    }
    return soonest === null ? null : Math.max(0, Math.ceil((soonest - this.now()) / 1000));
  }

  private clearAutoRetry(key: string, forgetTries: boolean): void {
    const waiting = this.autoRetries.get(key);
    if (waiting) clearTimeout(waiting.timer);
    this.autoRetries.delete(key);
    if (forgetTries) this.autoRetryTries.delete(key);
  }

  /** A failure that passes by itself (daily limit, busy AI): start the request again when it should. */
  private scheduleAutoRetry(job: Job, log: Logger): void {
    const err = job.error;
    if (!err || job.spec.prefetch) return;
    const key = videoKey(job.spec);
    const tries = this.autoRetryTries.get(key) ?? 0;
    const delay = autoRetryDelayMs(err.code, err.details['scope'], tries, this.now());
    if (delay === null) return;
    this.clearAutoRetry(key, false);
    this.autoRetryTries.set(key, tries + 1);
    const timer = setTimeout(() => this.runAutoRetry(key, job.spec, log), delay);
    timer.unref();
    this.autoRetries.set(key, { at: this.now() + delay, timer });
    log.info(
      { stage: 'API', errorCode: err.code, retryInSec: Math.round(delay / 1000), tries: tries + 1 },
      'will try again by itself',
    );
  }

  private runAutoRetry(key: string, spec: JobSpec, log: Logger): void {
    this.autoRetries.delete(key);
    const covered = [...this.jobs.values()].some(
      (j) =>
        videoKey(j.spec) === key &&
        (j.status === 'done' || j.status === 'running' || j.status === 'pending'),
    );
    if (covered) return;
    log.info({ stage: 'API' }, 'trying again by itself');
    const job = this.ensure(spec, false, true);
    if (job.status === 'pending') this.approve(job.id);
  }

  /**
   * The user pressed Continue. A translation that stopped getting answers is cut and asked again
   * (finished parts are kept); a cancelled or failed request starts again from what was saved.
   */
  resume(): 'kicked' | 'restarted' | 'none' {
    // Waiting for the video's sound: give that step up and go on with the subtitle as it is.
    const waiting = [...this.jobs.values()].find((j) => this.isSyncStalled(j));
    if (waiting && this.skip(waiting.id)) return 'kicked';
    const stalled = [...this.jobs.values()].filter((j) => this.isStalled(j));
    if (stalled.length > 0) {
      let cut = 0;
      for (const job of stalled) cut += job.kick?.() ?? 0;
      return cut > 0 ? 'kicked' : 'none';
    }
    const last = this.restartable();
    if (!last) return 'none';
    const job = this.ensure(last.spec, false, true);
    if (job.status === 'pending') this.approve(job.id); // pressing Continue is the user's OK
    return 'restarted';
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
    return buildQueue([...this.jobs.values()], (running) => this.skippableStep(running));
  }

  /** Translations running on a model other than the chosen one (auto-switch while it is overloaded). */
  private readonly fallbackProviders = new Set<ModelFallbackProvider>();

  private modelSwitch(): { from: string; to: string } | null {
    for (const p of this.fallbackProviders) {
      const to = p.activeModel();
      const from = p.getModelInformation().model;
      if (to !== from) return { from, to };
    }
    return null;
  }

  /** Live numbers for the status card. Counts this app session only. */
  stats(): JobStats {
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
    const withProgress = [...this.jobs.values()].filter(
      (j) => j.progress && j.status !== 'cancelled',
    );
    // While something is running, the card describes that, never an earlier finished subtitle.
    const runningWithProgress = withProgress.filter((j) => j.status === 'running');
    const candidates = running > 0 ? runningWithProgress : withProgress;
    // Keep following the same job while it is still a candidate: with two jobs running together the
    // bar would otherwise jump between them.
    const current =
      candidates.find((j) => j.id === this.shownJobId) ?? candidates[candidates.length - 1];
    this.shownJobId = current?.id;
    const p = current?.progress;
    const etaSec = current && p ? translateEtaSec(current, p, this.paused, this.now()) : null;
    const progress =
      p && p.total > 0
        ? {
            done: p.done,
            total: p.total,
            percent: Math.min(100, Math.floor((p.done / p.total) * 100)),
            etaSec,
          }
        : null;
    const latest = [...this.jobs.values()].filter((j) => j.status === 'running').pop();
    const stage = latest?.stage ?? null;
    const backgroundSyncView = backgroundSync([...this.jobs.values()], this.now());
    return {
      state,
      running,
      linesTranslated: this.linesTranslated,
      bytesTranslated: this.bytesTranslated,
      progress,
      paused: this.paused,
      totalEtaSec: totalEtaSec(current, progress, backgroundSyncView, this.now()),
      stage,
      syncPercent: stage === 'sync' ? (latest?.syncPercent ?? 0) : null,
      lastError: state === 'error' ? this.lastErrorCode : null,
      quota: this.quota ? { ...this.quota } : null,
      resumable: this.resumable(),
      autoRetryInSec: this.autoRetryInSec(),
      upgrade:
        this.lastUpgrade && this.now() - this.lastUpgrade.at < UPGRADE_NOTICE_MS
          ? { ...this.lastUpgrade }
          : null,
      subdlDownloads: this.subdlDownloads,
      exactComing: exactComing([...this.jobs.values()], (j) => this.canUpgrade(j)),
      modelSwitch: this.modelSwitch(),
      backgroundSync: backgroundSyncView,
      lastDelivered:
        this.lastDelivered && this.now() - this.lastDelivered.at < UPGRADE_NOTICE_MS
          ? { ...this.lastDelivered }
          : null,
      lastSync:
        this.lastSync && this.now() - this.lastSync.at < UPGRADE_NOTICE_MS
          ? { ...this.lastSync }
          : null,
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
        ...(result.source ? { source: result.source } : {}),
        ...(job.spec.filename ? { filename: job.spec.filename.slice(0, 300) } : {}),
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
  /**
   * The subtitle to give Stremio while the translation is still running (or stopped half way):
   * the translated start plus a note line. Undefined when there is no part yet.
   */
  partialSrt(job: Job, lang: 'he' | 'en', stopped: boolean): string | undefined {
    const part = job.partial;
    if (!part) return undefined;
    let cues = part.cues;
    let untilMs = part.untilMs;
    if (job.lateMove) {
      cues = applyFit(cues, job.lateMove);
      const tail = applyFit([{ index: 0, startMs: 0, endMs: untilMs, text: '' }], job.lateMove)[0];
      untilMs = tail?.endMs ?? untilMs;
    }
    part.served = true;
    return withPartialNotice(cues, untilMs, lang, stopped);
  }

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
      this.clearAutoRetry(videoKey(job.spec), true);
      // A subtitle served from the cache counts for the session once (new translations count themselves).
      if (outcome.via === 'cache' && !job.spec.prefetch) {
        this.countLines(job, outcome.cues, Buffer.byteLength(outcome.content));
      }
      const partialWasShown = job.partial?.served === true;
      delete job.partial;
      if (!job.spec.prefetch) {
        this.lastFailed = false;
        this.lastErrorCode = null;
      }
      void this.record(job, job.result, log);
      this.prefetchNext(job, log);
      const background: Promise<unknown>[] = [];
      if (job.result.exact === false) {
        background.push(this.upgradeLater(job, log), this.upgradeFromSound(job, log));
      }
      if (partialWasShown) void this.announceUpgrade(job);
      else if (!job.spec.prefetch && outcome.via !== 'cache') {
        // A timing check is still running: wait for it, so the user gets one notice, the last one.
        // (at most FINISHED_NOTICE_MAX_WAIT_MS, so a check that never ends cannot hide the notice)
        const cap = new Promise<void>((resolve) => {
          const t = setTimeout(resolve, FINISHED_NOTICE_MAX_WAIT_MS);
          t.unref();
        });
        void Promise.race([Promise.allSettled(background), cap]).then(() => {
          if (job.upgradeAnnounced || job.cancelled) return;
          return this.announce(job, (notice) => this.deps.onFinished?.(notice));
        });
      }
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
        delete job.partial;
        log.info({ stage: 'ASSEMBLY', durationMs: this.now() - started }, 'job cancelled');
      } else {
        job.error = isAppError(err)
          ? err
          : new AppError('SOURCE_DOWNLOAD_FAILED', 'unexpected error');
        job.status = 'failed';
        // The next episode is only a head start: when it fails the user is told nothing.
        if (!job.spec.prefetch) {
          this.lastFailed = true;
          this.lastErrorCode = job.error.code;
          this.announceFailure(job, job.error.code);
          this.scheduleAutoRetry(job, log);
        }
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

  /**
   * While one episode of a series is on, the next one is translated in the background, so it is
   * ready when the user gets to it. It uses the same sources and caches as a real request (no video
   * file yet, so no look inside it) and never chains on to the one after.
   */
  private prefetchNext(job: Job, log: Logger): void {
    const cfg = this.deps.config();
    const v = job.spec.video;
    if (job.spec.prefetch || !cfg.prefetchNext || cfg.translationMode !== 'auto') return;
    if (this.deps.testMode?.() || v.type !== 'series' || v.episode === undefined) return;
    const next: JobSpec = {
      video: { ...v, episode: v.episode + 1 },
      targetLanguage: job.spec.targetLanguage,
      prefetch: true,
    };
    const key = videoKey(next);
    if ([...this.jobs.values()].some((j) => videoKey(j.spec) === key)) return;
    log.info(
      { stage: 'SOURCE', prefetch: 'start', nextEpisode: next.video.episode },
      'translating the next episode in the background',
    );
    this.ensure(next);
  }

  /**
   * Developer tool: make a saved subtitle again from scratch, taking the source subtitle only from
   * one provider. The saved result is replaced; the translation of identical text is still reused.
   */
  redo(id: string, only: SourceId): boolean {
    if (!isJobId(id)) return false;
    const current = this.jobs.get(id);
    if (current && (current.status === 'running' || current.status === 'pending')) return false;
    let spec: JobSpec;
    try {
      spec = JSON.parse(readFileSync(join(this.deps.jobsDir, `${id}.json`), 'utf8')) as JobSpec;
    } catch {
      return false;
    }
    const plain: JobSpec = { ...spec };
    delete plain.onlyProvider;
    delete plain.fresh;
    this.jobs.delete(id);
    this.ensure({ ...plain, onlyProvider: only, fresh: true }, false, true);
    // What is kept on disk (for a restart) is the plain request, so the redo happens only once.
    this.saveSpec(id, plain);
    return true;
  }

  /** A finished subtitle whose timing is only a guess, and that is still the current one. */
  private canUpgrade(job: Job): boolean {
    return this.jobs.get(job.id) === job && job.status === 'done' && job.result?.exact === false;
  }

  /**
   * The video's own subtitle (exact timing) can arrive after the job already finished with a
   * downloaded one. It is then translated in the background and swapped in: the address Stremio
   * holds keeps working, and no "translating" message shows in between.
   */
  /** The measurement a request is making right now, by episode and subtitle (see fitToSpeech). */
  private readonly measuring = new Map<
    string,
    Promise<{ result?: TimingFit; method: 'cues' | 'sound' }>
  >();

  private async upgradeLater(job: Job, log: Logger): Promise<void> {
    try {
      await this.upgradeLaterWork(job, log);
    } finally {
      delete job.exactPending;
    }
  }

  private async upgradeLaterWork(job: Job, log: Logger): Promise<void> {
    const pending = job.lateEmbedded;
    if (!pending) return;
    let exact: ChosenSource | undefined;
    try {
      exact = await pending;
    } catch {
      return;
    }
    if (!exact || !this.canUpgrade(job)) return;
    log.info(
      { stage: 'SOURCE', upgrade: 'start' },
      'the subtitle inside the video arrived late; translating it in the background',
    );
    await this.acquire();
    try {
      if (!this.canUpgrade(job)) return;
      const shadow: Job = {
        id: job.id,
        spec: job.spec,
        status: 'running',
        startedAt: this.now(),
        stage: 'translate',
        promise: Promise.resolve(),
      };
      const result = await withCap(
        this.run(shadow, log, exact),
        this.deps.limits?.jobCapMs ?? 60 * 60_000,
        () => {
          throw new AppError('PROVIDER_TIMEOUT', 'background upgrade timed out');
        },
      );
      if (!this.canUpgrade(job)) return;
      job.result = result;
      job.finishedAt = this.now();
      void this.record(job, result, log);
      log.info(
        { stage: 'ASSEMBLY', upgrade: 'done', via: result.via, cues: result.cues },
        'subtitle upgraded to the exact timing',
      );
      await this.announceUpgrade(job);
    } catch (err) {
      log.warn(
        { stage: 'SOURCE', upgrade: 'failed', errorCode: isAppError(err) ? err.code : 'UNKNOWN' },
        'background upgrade failed; the downloaded subtitle stays',
      );
    } finally {
      this.release();
    }
  }

  /** Builds the notice (title and episode, no subtitle text) and hands it to a desktop hook. */
  private async announce(
    job: Job,
    send: (notice: { title: string; season?: number; episode?: number }) => void,
  ): Promise<void> {
    const v = job.spec.video;
    send({
      title: await this.titleFor(job),
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
    });
  }

  private announceFailure(job: Job, code: string): void {
    const key = videoKey(job.spec);
    const last = this.failureNoticeAt.get(key);
    if (last !== undefined && this.now() - last < 60_000) return;
    this.failureNoticeAt.set(key, this.now());
    void this.announce(job, (notice) => this.deps.onFailed?.({ ...notice, code }));
  }

  /** Tell the main screen and the desktop that a better subtitle replaced the shown one. */
  private async announceUpgrade(job: Job, force = false): Promise<void> {
    job.upgradeAnnounced = true;
    const v = job.spec.video;
    const notice = {
      title: await this.titleFor(job),
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
    };
    // One notice per episode: Stremio's two requests finish together, and a later step (video
    // subtitle, sound check) must not nag again. Only the user's own "Sync to sound" always tells.
    const last = this.lastUpgrade;
    if (
      !force &&
      last &&
      this.now() - last.at < 60_000 &&
      last.title === notice.title &&
      last.season === notice.season &&
      last.episode === notice.episode
    ) {
      return;
    }
    this.lastUpgrade = { ...notice, at: this.now() };
    this.deps.onUpgraded?.(notice);
  }

  /**
   * The sound check was still listening when the translation started. If it finds how the timing
   * is off, the finished subtitle is moved the same way (no new translation) and swapped in.
   */
  private async upgradeFromSound(job: Job, log: Logger): Promise<void> {
    const pending = job.lateFit;
    if (!pending) return;
    let moved: SoundFit | undefined;
    try {
      moved = await pending;
    } catch {
      return;
    }
    const before = job.result;
    if (!moved && !job.syncStopped) void this.noteSync(job, 'kept');
    if (!moved || !before || !this.canUpgrade(job)) return;
    if (isNoShift(moved.fit)) {
      // Already on the speech: nothing changed, so there is nothing to reselect and no notice.
      void this.noteSync(job, 'inSync');
      return;
    }
    try {
      const cues = parseSubtitle(before.content).cues;
      const content = serializeSubtitle({ format: 'srt', cues: applyFit(cues, moved.fit) });
      const result: JobResult = { ...before, content, exact: true, timing: 'speech' };
      if (before.exactKey) this.safeSet(before.exactKey, 'translation', content, before.cues, log);
      if (before.outKey && before.outKey !== before.exactKey) {
        this.safeSet(before.outKey, 'translation', content, before.cues, log);
      }
      if (!this.canUpgrade(job)) return;
      job.result = result;
      void this.record(job, result, log);
      log.info(
        { stage: 'ASSEMBLY', upgrade: 'done', via: 'sound' },
        'subtitle moved onto the speech in the background',
      );
      void this.noteSync(job, 'moved', moved.fit.offsetMs);
      await this.announceUpgrade(job);
    } catch (err) {
      log.warn(
        { stage: 'SOURCE', upgrade: 'failed', errorCode: isAppError(err) ? err.code : 'UNKNOWN' },
        'could not move the subtitle after the sound check; it stays as it was',
      );
    }
  }

  /**
   * "Sync by sound", pressed by the user: listens to the video of the latest finished subtitle and
   * moves that subtitle onto the speech, even when it was thought to be exact. How far it is and how
   * it ended show on the main screen, like the background check.
   */
  /** The user pressed Stop on the sound check that is listening; nothing else ends it but its own result. */
  stopSync(): boolean {
    const listening = [...this.jobs.values()].filter(
      (j) => (j.syncPercent !== undefined || j.syncWaiting) && !j.syncStopped,
    );
    for (const job of listening) job.syncStopped = true;
    return listening.length > 0;
  }

  /** Skip, after the job finished: ends only the search inside the video; the sound check goes on. */
  skipBackgroundSearch(): boolean {
    const searching = [...this.jobs.values()].filter((j) => j.exactPending && !j.searchSkipped);
    for (const job of searching) job.searchSkipped = true;
    return searching.length > 0;
  }

  /** Cancel, after the job finished: ends the search inside the video and the sound check. */
  stopBackground(): boolean {
    const searched = this.skipBackgroundSearch();
    const stopped = this.stopSync();
    return searched || stopped;
  }

  syncNow(): { ok: true } | { ok: false; code: 'NO_SUBTITLE' | 'NO_VIDEO' | 'BUSY' } {
    const all = [...this.jobs.values()];
    const done = all.filter((j) => j.status === 'done' && j.result && !j.spec.prefetch);
    if (done.length === 0) return { ok: false, code: 'NO_SUBTITLE' };
    if (all.some((j) => j.syncPercent !== undefined || j.lateFit))
      return { ok: false, code: 'BUSY' };
    const job = done
      .filter((j) => j.spec.filename)
      .sort((a, b) => (b.finishedAt ?? b.startedAt) - (a.finishedAt ?? a.startedAt))[0];
    const before = job?.result;
    if (!job || !before) return { ok: false, code: 'NO_VIDEO' };
    const log = this.deps.logger.child({ jobId: job.id.slice(0, 8), stage: 'SOURCE' });
    const picked: ChosenSource = {
      kind: 'direct',
      language: job.spec.targetLanguage,
      raw: before.content,
      exact: true,
    };
    this.lastSync = null;
    job.syncPercent = 0;
    job.syncProgressAt = this.now();
    job.syncStartedAt = this.now();
    const run = this.fitToSpeech(job, this.deps.config(), log, picked, () => false);
    job.lateFit = run;
    void run
      .then(async (moved) => {
        if (!moved) return job.syncStopped ? undefined : this.noteSync(job, 'kept');
        if (isNoShift(moved.fit)) {
          return this.noteSync(job, 'inSync');
        }
        const cues = parseSubtitle(before.content).cues;
        const content = serializeSubtitle({ format: 'srt', cues: applyFit(cues, moved.fit) });
        const result: JobResult = { ...before, content, exact: true, timing: 'speech' };
        // The job may have been cleared, replaced or upgraded while the sound was being checked.
        const stillCurrent = () => this.jobs.get(job.id) === job && job.result === before;
        if (!stillCurrent()) return;
        if (before.exactKey)
          this.safeSet(before.exactKey, 'translation', content, before.cues, log);
        if (before.outKey && before.outKey !== before.exactKey) {
          this.safeSet(before.outKey, 'translation', content, before.cues, log);
        }
        job.result = result;
        void this.record(job, result, log);
        log.info(
          { upgrade: 'done', via: 'sound-now' },
          'subtitle moved onto the speech on request',
        );
        await this.noteSync(job, 'moved', moved.fit.offsetMs);
        await this.announceUpgrade(job, true);
      })
      .catch((err: unknown) => {
        log.warn(
          { upgrade: 'failed', errorCode: isAppError(err) ? err.code : 'UNKNOWN' },
          'could not sync the subtitle to the sound on request; it stays as it was',
        );
        return this.noteSync(job, 'kept');
      })
      .finally(() => {
        if (job.lateFit === run) delete job.lateFit;
      });
    return { ok: true };
  }

  /** Remember that Stremio took a finished subtitle, for the main screen. */
  async noteDelivered(job: Job): Promise<void> {
    if (job.status !== 'done' || !job.result || job.spec.prefetch) return;
    const v = job.spec.video;
    this.lastDelivered = {
      title: await this.titleFor(job),
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
      via: job.result.via,
      ...(job.result.source ? { source: job.result.source.provider } : {}),
      at: this.now(),
    };
  }

  /** Count a finished subtitle's lines for the session counter, once per episode and language. */
  private countLines(job: Job, cues: number, bytes: number, fresh = false): void {
    const key = videoKey(job.spec);
    // A new translation always counts (a redo too); a cached one only the first time.
    if (!fresh && this.countedVideos.has(key)) return;
    this.countedVideos.add(key);
    this.linesTranslated += cues;
    this.bytesTranslated += bytes;
  }

  /** Remember how the background sound check ended, for the main screen. */
  private async noteSync(
    job: Job,
    result: 'moved' | 'kept' | 'inSync',
    offsetMs?: number,
  ): Promise<void> {
    const v = job.spec.video;
    // "Not sure" is not the same as "never listened": say so when the video was not found.
    const outcome = result === 'kept' && job.syncNoVideo ? 'unavailable' : result;
    this.lastSync = {
      title: await this.titleFor(job),
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
      outcome,
      ...(offsetMs !== undefined ? { offsetMs } : {}),
      at: this.now(),
    };
  }

  /** After the user cancelled, stop at the next step instead of finishing the whole lookup. */
  private stopIfCancelled(job: Job): void {
    if (job.cancelled) throw new CancelledError();
  }

  /** Where a prefetched episode leaves its mark, so the real request for it can skip the long waits. */
  private prefetchKey(spec: JobSpec, cfg: Config): string {
    const lang = findLanguage(spec.targetLanguage);
    return cacheKey({
      video: videoKey(spec),
      rtl: cfg.rtlFix && !!lang?.rtl,
      ...(cfg.dualSubtitles ? { dual: true } : {}),
      ...(cfg.cleanSubtitles ? { clean: true } : {}),
      sourceLogic: SOURCE_LOGIC_VERSION,
      kind: 'prefetch',
    });
  }

  private async run(job: Job, log: Logger, preset?: ChosenSource): Promise<JobResult> {
    const result = await this.runJob(job, log, preset);
    if (job.spec.prefetch) {
      this.safeSet(this.prefetchKey(job.spec, this.deps.config()), 'source', '1', 0, log);
    }
    return result;
  }

  private async runJob(job: Job, log: Logger, preset?: ChosenSource): Promise<JobResult> {
    const cfg = this.deps.config();
    const { cache } = this.deps;
    const lang = findLanguage(job.spec.targetLanguage);
    if (!lang) throw new AppError('CONFIGURATION_INVALID', 'TARGET_LANGUAGE');
    // Always on for right-to-left languages; RTL_FIX=false is the only way to opt out.
    const rtl = cfg.rtlFix && lang.rtl;

    // 1. Whole-job cache: replay costs no network at all.
    const dual = cfg.dualSubtitles;
    const jobKey = cacheKey({
      job: job.id,
      rtl,
      ...(dual ? { dual } : {}),
      ...(cfg.cleanSubtitles ? { clean: true } : {}),
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
      ...(cfg.cleanSubtitles ? { clean: true } : {}),
      sourceLogic: SOURCE_LOGIC_VERSION,
      kind: 'job-fallback',
    });
    // Everything deleted together with this subtitle if the user removes it from the library.
    const keys = new Set<string>([jobKey, fallbackKey]);
    const fresh = job.spec.fresh === true;
    const hit = fresh ? undefined : cache.get(jobKey);
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
    const fallback = tryLocal && !fresh ? cache.get(fallbackKey) : undefined;
    // The next episode was translated in the background: only the downloaded subtitle is needed again.
    const prefetched = !fresh && cache.get(this.prefetchKey(job.spec, cfg)) !== undefined;
    const embeddedSoftMs =
      this.deps.limits?.embeddedSoftMs ??
      (prefetched ? Math.min(cfg.embeddedWaitSec * 1000, 3000) : cfg.embeddedWaitSec * 1000);

    // 2. Find the best subtitle: the one inside the playing video file first (exact timing, no
    // download), then OpenSubtitles.
    job.stage = 'local';
    // The search inside the video is not waited for beyond a few seconds, and not when the user
    // skips it: the job goes on with the downloaded subtitle (timing checked against the sound). If
    // the video's own subtitle still arrives before the translation starts, it is exact, so it wins.
    const late: { value?: ChosenSource } = {};
    let chosen =
      preset ??
      (job.spec.onlyProvider
        ? undefined
        : await this.skippable(
            job,
            'local',
            (wasSkipped) => {
              const attempt = withCap(
                this.embeddedSource(
                  job,
                  cfg,
                  lang.code,
                  log,
                  !!fallback || prefetched || this.episodeServed(job),
                  wasSkipped,
                ),
                this.deps.limits?.embeddedCapMs ?? 140_000, // one try is 30 s; a loading video gets up to 2 min
                () => {
                  log.warn({ stage: 'SOURCE', embedded: 'cap' }, 'embedded lookup took too long');
                  return undefined;
                },
              );
              job.lateEmbedded = attempt;
              job.exactPending = true;
              void attempt.then(
                (found) => {
                  if (found) late.value = found;
                },
                () => undefined,
              );
              return withCap(attempt, embeddedSoftMs, () => {
                log.info(
                  { stage: 'SOURCE', embedded: 'soft-limit' },
                  'not waiting longer for the video',
                );
                return undefined;
              });
            },
            undefined,
          ));
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
      this.stopIfCancelled(job);
      job.stage = 'search';
      chosen = await withCap(
        this.openSubtitlesSource(job, cfg, lang.code, log),
        this.deps.limits?.sourceCapMs ?? 120_000,
        () => {
          throw new AppError('SOURCE_DOWNLOAD_FAILED', 'source search timed out');
        },
      );
      if (late.value && !chosen.exact) {
        log.info({ stage: 'SOURCE', embedded: 'late' }, 'subtitle inside the video arrived late');
        chosen = late.value;
      }
      // No exact timing: listen to a few short pieces of the video and move the subtitle onto them.
      if (
        !placedOnSpeech &&
        !chosen.exact &&
        cfg.soundCheck !== 'off' &&
        this.deps.speechFit &&
        job.spec.filename
      ) {
        job.stage = 'sync';
        const picked = chosen;
        const moved = await this.skippable(
          job,
          'sync',
          (wasSkipped) => {
            const fit = this.fitToSpeech(
              job,
              cfg,
              log,
              picked,
              () => wasSkipped() || !!late.value,
              true,
            );
            fit.catch(() => undefined);
            // After a while the translation starts without it; the check goes on and may upgrade the subtitle.
            const waitMs =
              this.deps.limits?.syncWaitMs ?? (cfg.soundCheck === 'wait' ? SYNC_WAIT_MS : 0);
            const timer = new Promise<undefined>((resolve) => {
              const t = setTimeout(() => {
                job.lateFit = fit;
                void fit.then(
                  (moved) => {
                    if (moved) job.lateMove = moved.fit;
                    // Say how the check ended right away: the job may still be translating, and
                    // the main screen would otherwise show nothing until it is done.
                    if (job.syncStopped || job.cancelled) return;
                    if (!moved) void this.noteSync(job, 'kept');
                    else if (isNoShift(moved.fit)) void this.noteSync(job, 'inSync');
                    else void this.noteSync(job, 'moved', moved.fit.offsetMs);
                  },
                  () => undefined,
                );
                log.info(
                  { stage: 'SOURCE', sync: 'continues-in-background' },
                  'translating now; the sound check goes on in the background',
                );
                resolve(undefined);
              }, waitMs);
              void fit.finally(() => clearTimeout(t));
            });
            return Promise.race([fit, timer]);
          },
          undefined,
        );
        this.stopIfCancelled(job);
        // Finished inside the wait (not left running in the background): tell the main screen.
        if (!job.lateFit) {
          if (moved && isNoShift(moved.fit)) void this.noteSync(job, 'inSync');
          else void this.noteSync(job, moved ? 'moved' : 'kept', moved?.fit.offsetMs);
        }
        if (moved) {
          placedOnSpeech = true;
          chosen = moved.source;
        }
      }
      // The video's own subtitle came while the timing was being checked: it is exact, use it.
      if (late.value && chosen !== late.value && !(chosen.exact && !placedOnSpeech)) {
        log.info({ stage: 'SOURCE', embedded: 'late' }, 'subtitle inside the video arrived late');
        chosen = late.value;
        placedOnSpeech = false;
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
    const file = parseSubtitle(raw);
    const cast = buildCast(file);
    const parsed = cfg.cleanSubtitles ? cleanSubtitle(file) : file;
    log.info({ stage: 'PARSER', cues: parsed.cues.length, format: parsed.format }, 'source parsed');
    job.progress = { done: 0, total: parsed.cues.length };
    job.stage = 'translate';
    job.progressAt = this.now();
    job.translateStartedAt = this.now();

    // 4a. Already in the target language: serve as SRT, no translation.
    if (chosen.kind === 'direct') {
      const content = serializeSubtitle({ format: 'srt', cues: parsed.cues });
      this.safeSet(outKey, 'translation', content, parsed.cues.length, log);
      job.progress = { done: parsed.cues.length, total: parsed.cues.length };
      return {
        ...originOf(chosen),
        content,
        via: 'direct',
        cues: parsed.cues.length,
        cacheKeys: [...keys],
        outKey,
        exactKey: jobKey,
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
        ...originOf(chosen),
        content: cached.content,
        via: 'cache',
        cues: cached.cues,
        cacheKeys: [...keys],
        exact,
      };
    }

    const chunkStore: ChunkStore = {
      inFlight: this.chunksInFlight,
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
      if (sharing.lead.partial) job.partial = { ...sharing.lead.partial, served: false };
    }
    const kicks = sharing?.kicks ?? new Set<() => void>();
    job.kick = () => {
      const waiting = [...kicks];
      for (const cut of waiting) cut();
      job.progressAt = this.now();
      return waiting.length;
    };
    const showParts =
      cfg.partialSubtitles &&
      parsed.cues.length >= (this.deps.limits?.partialMinTotalCues ?? PARTIAL_MIN_TOTAL_CUES);
    const untilMs = parsed.cues[parsed.cues.length - 1]?.endMs ?? 0;
    const work =
      sharing?.work ??
      translateSubtitle(parsed, provider, {
        ...(showParts
          ? {
              partialMinCues: Math.ceil(parsed.cues.length * PARTIAL_FRACTION),
              onPartial: (cues: Cue[]) => {
                for (const w of watchers) {
                  w.partial = { cues, untilMs, served: w.partial?.served ?? false };
                }
              },
            }
          : {}),
        chunkStore,
        targetLanguageCode: lang.code,
        targetLanguageName: lang.name,
        chunkSize: cfg.chunkSize,
        concurrency: cfg.chunkConcurrency,
        maxValidationRetries: cfg.chunkMaxRetries,
        rtlFix: rtl,
        cast,
        dualSubtitles: dual,
        isCancelled: () => [...watchers].every((w) => w.cancelled),
        waitWhilePaused: () => this.waitWhilePaused(() => [...watchers].every((w) => w.cancelled)),
        registerKick: (cut) => {
          kicks.add(cut);
          return () => void kicks.delete(cut);
        },
        requestGapMs: cfg.chunkDelayMs,
        onRateLimitWait: (d) => {
          this.rateLimited = Math.max(0, this.rateLimited + d);
        },
        onProgress: (done, total) => {
          for (const w of watchers) {
            if (w.cancelled) continue; // answers still in flight must not move a cancelled bar
            w.progress = { done, total };
            w.progressAt = this.now();
          }
        },
        logger: log,
        logDialogue: cfg.logDialogue,
      });
    if (!sharing) {
      this.translating.set(trKey, { work, watchers, lead: job, kicks });
      if (provider instanceof ModelFallbackProvider) this.fallbackProviders.add(provider);
      const forget = (): void => {
        this.translating.delete(trKey);
        if (provider instanceof ModelFallbackProvider) this.fallbackProviders.delete(provider);
      };
      work.then(forget, forget);
    }
    let result: Awaited<typeof work>;
    try {
      result = await work;
    } finally {
      delete job.kick;
    }
    watchers.delete(job);
    job.progress = { done: result.file.cues.length, total: result.file.cues.length };
    // A sound note the AI wrote itself is removed too (two-line dual subtitles are left as they are).
    const finalCues =
      cfg.cleanSubtitles && !dual ? cleanTranslated(result.file.cues, rtl) : result.file.cues;
    const content = serializeSubtitle({ format: 'srt', cues: finalCues });
    // Only fully validated translations reach this point.
    this.safeSet(trKey, 'translation', content, finalCues.length, log);
    this.safeSet(outKey, 'translation', content, finalCues.length, log);
    if (!sharing) {
      this.countLines(job, finalCues.length, Buffer.byteLength(content), true);
    }
    keys.add(trKey);
    return {
      ...originOf(chosen),
      content,
      via: 'translated',
      cues: result.file.cues.length,
      cacheKeys: [...keys],
      outKey,
      exactKey: jobKey,
      exact,
      timing,
    };
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
    /** Wait for the video to start playing in Stremio (the automatic check), not just look once. */
    waitForVideo = false,
  ): Promise<SoundFit | undefined> {
    const fit = this.deps.speechFit;
    const filename = job.spec.filename;
    const ffmpeg = this.deps.ffmpegFor
      ? this.deps.ffmpegFor(cfg)
      : locateTools(cfg.ffmpegPath)?.ffmpeg;
    delete job.syncNoVideo;
    if (!fit || !filename || !ffmpeg) {
      job.syncNoVideo = true;
      return undefined;
    }
    const abort = new AbortController();
    const watch = setInterval(() => {
      if (abort.signal.aborted) return; // said once; the step that was waiting ends by itself
      if (job.cancelled || job.syncStopped || wasSkipped()) abort.abort();
      else if (
        job.syncProgressAt !== undefined &&
        this.now() - job.syncProgressAt > (this.deps.limits?.syncNoDataMs ?? SYNC_NO_DATA_MS)
      ) {
        log.info(
          { stage: 'SOURCE', sync: 'no-data' },
          'the video is not sending its sound; timing left as it was',
        );
        abort.abort();
      }
    }, 500);
    const cap = setTimeout(() => abort.abort(), this.deps.limits?.speechCapMs ?? 300_000);
    try {
      const find = this.deps.findStream ?? findStream;
      let stream = await find(cfg.stremioServerUrl, filename, this.deps.fetchImpl);
      const findWaitMs = this.deps.limits?.syncFindWaitMs ?? SYNC_FIND_WAIT_MS;
      const everyMs = this.deps.limits?.syncFindEveryMs ?? SYNC_FIND_EVERY_MS;
      // Stremio asks for subtitles before the video starts: wait for it to begin, then listen.
      for (let waited = 0; waitForVideo && !stream && waited < findWaitMs; waited += everyMs) {
        job.syncWaiting = true;
        await new Promise((r) => setTimeout(r, everyMs));
        if (abort.signal.aborted) break;
        stream = await find(cfg.stremioServerUrl, filename, this.deps.fetchImpl).catch(
          () => undefined,
        );
      }
      delete job.syncWaiting;
      if (!stream) {
        job.syncNoVideo = true;
        return undefined;
      }
      job.syncPercent = 0;
      job.syncProgressAt = this.now();
      job.syncStartedAt = this.now();
      const cues = parseSubtitle(picked.raw).cues;
      const measure = async (): Promise<{ result?: TimingFit; method: 'cues' | 'sound' }> => {
        const onProgress = (p: number): void => {
          if (p !== job.syncPercent) job.syncProgressAt = this.now();
          job.syncPercent = p;
        };
        // First the video's own subtitle track, when it has one: its times are the real ones, and a few
        // short pieces are enough. Then the sound of the video.
        let result: TimingFit | undefined;
        let method: 'cues' | 'sound' = 'sound';
        if (this.deps.cueFit && cfg.embeddedSubtitles) {
          result = await this.deps
            .cueFit({
              url: stream.url,
              ffmpeg,
              ffprobe: locateTools(cfg.ffmpegPath)?.ffprobe ?? '',
              cues,
              language: picked.language,
              signal: abort.signal,
              // every step of the cue check is progress, even when the number stays the same
              onProgress: (p, estimated) => {
                if (estimated) {
                  // only time passed: the bar moves, but nothing came from the video
                  job.syncPercent = Math.max(job.syncPercent ?? 0, p);
                  return;
                }
                job.syncProgressAt = this.now();
                onProgress(p);
              },
              log: (info) => log.info({ stage: 'SOURCE', ...info }, 'cue check'),
            })
            .catch(() => undefined);
          if (result) method = 'cues';
          else if (!abort.signal.aborted) {
            log.info(
              { stage: 'SOURCE', sync: 'no-track' },
              'no usable track in the video; listening',
            );
            job.syncPercent = 0;
            job.syncStartedAt = this.now();
            job.syncProgressAt = this.now();
          }
        }
        result ??= await fit({ url: stream.url, ffmpeg, cues, signal: abort.signal, onProgress });
        return result ? { result, method } : { method };
      };
      // Stremio often asks twice for one episode: the second request waits for the first one's answer
      // instead of reading the video again at the same time.
      const first = cues[0];
      const last = cues[cues.length - 1];
      const memoKey = [videoKey(job.spec), filename, cues.length, first?.startMs, last?.endMs].join(
        '|',
      );
      const shared = this.measuring.get(memoKey);
      let measured: { result?: TimingFit; method: 'cues' | 'sound' } | undefined;
      if (shared) {
        job.syncWaiting = true;
        measured = await Promise.race([
          shared,
          new Promise<undefined>((resolve) =>
            abort.signal.addEventListener('abort', () => resolve(undefined), { once: true }),
          ),
        ]);
        delete job.syncWaiting;
      } else {
        const run = measure();
        this.measuring.set(memoKey, run);
        try {
          measured = await run;
        } finally {
          this.measuring.delete(memoKey);
        }
      }
      const result = measured?.result;
      const method = measured?.method ?? 'sound';
      if (!result) {
        log.info({ stage: 'SOURCE', sync: 'fit-unsure' }, 'timing left as it was');
        return undefined;
      }
      log.info(
        {
          stage: 'SOURCE',
          sync: 'fitted',
          method,
          offsetMs: result.offsetMs,
          scale: Math.round(result.scale * 10000) / 10000,
          score: Math.round(result.score * 1000) / 1000,
          ...(result.parts?.length ? { parts: partsText(result.parts) } : {}),
        },
        'subtitle moved onto the speech',
      );
      return {
        source: {
          ...picked,
          raw: serializeSubtitle({ format: 'srt', cues: applyFit(cues, result) }),
          exact: true,
        },
        fit: result,
      };
    } catch {
      return undefined;
    } finally {
      clearInterval(watch);
      clearTimeout(cap);
      delete job.syncPercent;
      delete job.syncProgressAt;
      delete job.syncStartedAt;
      delete job.syncWaiting;
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
        maxEtaSec: cfg.embeddedMaxEtaSec,
        shouldStop: () => !!job.cancelled || !!job.searchSkipped || wasSkipped(),
        ...(this.deps.fetchImpl ? { fetchImpl: this.deps.fetchImpl } : {}),
      },
    );
    if (!found) return undefined;
    const kind = found.language.toLowerCase() === target.toLowerCase() ? 'direct' : 'translate';
    return { kind, language: found.language, provider: 'video', raw: found.raw, exact: true };
  }

  /** The best subtitle OpenSubtitles has: search, timing consensus, then download. */
  private async openSubtitlesSource(
    job: Job,
    cfg: Config,
    target: string,
    log: Logger,
    /** Take the best subtitle in this language even if the target language has one. */
    forceLanguage: string | undefined = undefined,
  ): Promise<ChosenSource> {
    const { cache } = this.deps;
    const lang = { code: target };
    const source = this.deps.makeSource(cfg, log);
    await this.refreshQuota(); // at most every 10 minutes; a failure changes nothing
    const found = await source.search({
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
    // A developer redo takes the subtitle from one source only.
    const only = job.spec.onlyProvider;
    // Developer option: translate from English even when a ready subtitle in the language exists.
    if (cfg.preferTranslation && forceLanguage === undefined) forceLanguage = 'en';
    const candidates = only ? found.filter((c) => (c.provider ?? 'opensubtitles') === only) : found;
    const videoName = job.spec.filename;
    let selection = selectSubtitle(candidates, lang.code, 'en', videoName);
    const forced = forceLanguage
      ? rankSameLanguage(candidates, forceLanguage, videoName)[0]
      : undefined;
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
        // A season pack is one download but holds one subtitle per episode.
        ...(c.pack ? { pack: c.episode ?? 0 } : {}),
        kind: 'source',
      });
      const known = cache.get(key)?.content;
      if (known !== undefined) return known;
      // Stremio asks twice at once (with and without the video hash): the second request waits
      // for the first download instead of spending another one of the daily quota.
      const running = this.downloading.get(key);
      if (running) return running;
      const download = (async () => {
        const dl = await source.download(c);
        if (c.provider === 'subdl') this.subdlDownloads++;
        this.downloadsLeft = dl.remaining ?? this.downloadsLeft;
        if (this.quota && dl.remaining !== undefined) this.quota.left = dl.remaining;
        this.safeSet(key, 'source', dl.content, 0, log);
        return dl.content;
      })().finally(() => this.downloading.delete(key));
      this.downloading.set(key, download);
      return download;
    };

    // 3a. No hash match means the timing may belong to another release of the video. Compare a
    // few files of the same language and take the one whose timing most of the others share.
    // Skipped when few downloads are left today: each file compared costs one.
    // Only when OpenSubtitles has said plenty are left (a free account has few per day): the
    // first subtitle of a session never triggers it, so an account is never drained blindly.
    // The OpenSubtitles daily limit is the one being protected, so only its files are compared.
    const isMain = (c: SubtitleCandidate) => (c.provider ?? 'opensubtitles') === 'opensubtitles';
    if (
      !candidate.hashMatch &&
      isMain(candidate) &&
      this.downloadsLeft !== undefined &&
      this.downloadsLeft >= CONSENSUS_MIN_LEFT
    ) {
      const pool = rankSameLanguage(candidates.filter(isMain), candidate.language, videoName).slice(
        0,
        CONSENSUS_POOL_SIZE,
      );
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
    // 3b. When OpenSubtitles has no downloads left, use another source's file instead.
    // The same language first; else what a search would pick (English to translate).
    const spare = () => {
      const others = candidates.filter((c) => !isMain(c));
      const sameLanguage = rankSameLanguage(others, candidate.language, videoName)[0];
      if (sameLanguage) return sameLanguage;
      const next = selectSubtitle(others, lang.code, 'en', videoName);
      return next.kind === 'none' ? undefined : next.candidate;
    };
    if (this.downloadsLeft === 0 && isMain(candidate)) candidate = spare() ?? candidate;
    let raw: string;
    try {
      raw = await fetchRaw(candidate);
    } catch (err) {
      const failed = candidate;
      // A season pack may not hold this episode: then a single-episode file is the next choice.
      const packMiss = isAppError(err) && err.code === 'SOURCE_SUBTITLE_NOT_FOUND' && failed.pack;
      const alt =
        isAppError(err) && err.code === 'SOURCE_QUOTA_EXCEEDED' && isMain(failed)
          ? spare()
          : packMiss
            ? rankSameLanguage(
                candidates.filter((c) => c !== failed && !c.pack),
                failed.language,
                videoName,
              )[0]
            : undefined;
      if (!alt) throw err;
      log.info(
        { stage: 'SOURCE', provider: alt.provider },
        packMiss
          ? 'the season pack has no file for this episode, using another file'
          : 'OpenSubtitles limit reached, using another source',
      );
      candidate = alt;
      raw = await fetchRaw(candidate);
    }
    // Another source's file may be in another language than the one first chosen.
    const sameAsTarget = candidate.language.toLowerCase().split('-')[0] === lang.code.toLowerCase();
    return {
      kind:
        candidate === selection.candidate ? selection.kind : sameAsTarget ? 'direct' : 'translate',
      language: candidate.language,
      provider: candidate.provider ?? 'opensubtitles',
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
