import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cacheKey, type FileCache, sha256 } from '../cache/fileCache';
import type { Config } from '../config/env';
import { findLanguage } from '../config/languages';
import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { SourceId } from '../sources/ordered';
import { rankSameLanguage, selectSubtitle } from '../sources/select';
import {
  findStream,
  loadEmbeddedSubtitle,
  locateTools,
  type LocalStream,
} from '../sources/embedded';
import { applyFit, type TimingFit } from '../sync/fit';
import { cinemetaTitle, kitsuTitles, makeTitleResolver, parseFilename } from '../sources/titles';
import type { Library } from './library';
import type { SourceSubtitleProvider, SubtitleCandidate, VideoRef } from '../sources/types';
import { type ConsensusItem, pickByConsensus } from '../subtitles/consensus';
import { cleanSubtitle } from '../subtitles/clean';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import type { ChunkCue } from '../subtitles/chunk';
import { stripForeignScripts } from '../subtitles/validate';
import { withPartialNotice } from '../stremio/placeholder';
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
  /** The next episode, translated in the background while the current one plays. */
  prefetch?: boolean;
  /** Developer redo: take the subtitle only from this source, and ignore what was saved before. */
  onlyProvider?: SourceId;
  fresh?: boolean;
}

/** Where a subtitle came from, shown in the library so the sources can be compared. */
export type SubtitleOrigin = 'subdl' | 'opensubtitles' | 'jimaku' | 'video';

export interface JobResult {
  /** The source subtitle: who gave it, in which language, and whether it was translated. */
  source?: { provider: SubtitleOrigin; language: string; kind: 'direct' | 'translate' };
  /** Final SRT text. */
  content: string;
  via: 'direct' | 'translated' | 'cache';
  cues: number;
  /** Cache entries that belong to this subtitle (for the library's delete). */
  cacheKeys?: string[];
  /** The cache key this result was stored under, and the key used when its timing is exact. */
  outKey?: string;
  exactKey?: string;
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
  /** When the translation last moved (a step started or a part finished); a long silence is a stall. */
  progressAt?: number;
  /** The search inside the video, still running after the job went on without it (see upgradeLater). */
  lateEmbedded?: Promise<ChosenSource | undefined>;
  /** The video's own subtitle is still being read (or translated) to replace the shown one. */
  exactPending?: boolean;
  /** Cuts the requests that are waiting for the AI so they are asked again (set while translating). */
  kick?: () => number;
  /** Progress of listening to the video while the stage is 'sync', 0..100. */
  syncPercent?: number;
  /** The sound check that was still running when the translation started (see upgradeFromSound). */
  lateFit?: Promise<SoundFit | undefined>;
  /** When the sound check last made progress (the video's data may not be arriving). */
  syncProgressAt?: number;
  /** When listening to the video began, for the time estimate. */
  syncStartedAt?: number;
  /** The sound check is waiting for the video to appear in Stremio (it is not playing yet). */
  syncWaiting?: boolean;
  /** The user moved on to another video: the sound check of this one stops listening. */
  syncStopped?: boolean;
  /** The sound check could not start: the video is not on this computer's Stremio server. */
  syncNoVideo?: boolean;
  /**
   * The translated start of a long subtitle, served while the rest is still being translated.
   * Memory only: it is never cached or listed. `served` is set once Stremio was given it.
   */
  partial?: { cues: Cue[]; untilMs: number; served: boolean };
  /** How the late sound check says the timing is off; applied to the partial when it is shown. */
  lateMove?: TimingFit;
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
  /** A translation with no news for this long counts as stuck (default 12 s). */
  stallAfterMs?: number;
  /** Hard caps so one stuck step can never block the queue (defaults: 2 min 20 s, 2 min, 1 hour). */
  limits?: {
    /** Wait this long for the subtitle inside the video before going on without it (default 15 s). */
    embeddedSoftMs?: number;
    embeddedCapMs?: number;
    sourceCapMs?: number;
    jobCapMs?: number;
    speechCapMs?: number;
    /** How long the sound check may wait for the video's data before it gives up. */
    syncNoDataMs?: number;
    /** How long the sound check waits for the video to show up in Stremio (default 90 s). */
    syncFindWaitMs?: number;
    /** How often it looks again while waiting (default 3 s). */
    syncFindEveryMs?: number;
    /** How long the translation waits for the sound check before it starts without it. */
    syncWaitMs?: number;
    /** Files with fewer lines than this are never shown in parts (default 1000). */
    partialMinTotalCues?: number;
  };
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
  /** Checks a subtitle's timing against the video's own subtitle track (a few short pieces); optional. */
  cueFit?: (o: {
    url: string;
    ffmpeg: string;
    ffprobe: string;
    cues: Cue[];
    language: string;
    signal: AbortSignal;
    onProgress?: (percent: number) => void;
    log?: (info: Record<string, unknown>) => void;
  }) => Promise<TimingFit | undefined>;
  /** When set, every finished subtitle is listed here so the user can review and delete it. */
  library?: Library;
  /** Ask mode: called once when a new request is waiting for the user's OK (for a notification). */
  onPending?: (item: { title: string; season?: number; episode?: number }) => void;
  /** Called when a better (exact-timing) subtitle replaced the shown one in the background. */
  onUpgraded?: (item: { title: string; season?: number; episode?: number }) => void;
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
  /** Where it came from: a source site, or the video file itself (a track or a file beside it). */
  provider?: SubtitleOrigin;
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
const SOURCE_LOGIC_VERSION = 11;

/** A translation is shown in parts only for files with at least this many lines. */
const PARTIAL_MIN_TOTAL_CUES = 1000;

/** The first part is shown once this share of the lines (from the start) is translated. */
const PARTIAL_FRACTION = 0.25;

/** How long the "better subtitle is ready" notice stays on the main screen. */
const UPGRADE_NOTICE_MS = 30 * 60_000;

/** The translation starts without the sound check after this long (30 s); the check goes on in the background. */
const SYNC_WAIT_MS = 30_000;

/** The sound check, as the translation uses it: the moved source subtitle and the fit that moved it. */
interface SoundFit {
  source: ChosenSource;
  fit: TimingFit;
}

/** The sound check gives up when the video sends no sound for this long (45 s). */
const SYNC_NO_DATA_MS = 45_000;
/** "4m:+0.1 12m:-0.2 19m:?": what is left off in each listened piece, by minute of the video. */
export function partsText(parts: { atSec: number; offsetMs: number | null }[]): string {
  return parts
    .map(
      (p) =>
        `${Math.round(p.atSec / 60)}m:` +
        (p.offsetMs === null
          ? '?'
          : `${p.offsetMs >= 0 ? '+' : ''}${(p.offsetMs / 1000).toFixed(1)}`),
    )
    .join(' ');
}

const SYNC_FIND_WAIT_MS = 90_000;
const SYNC_FIND_EVERY_MS = 3_000;

/** A translation with no news for this long counts as stuck. */
const STALL_AFTER_MS = 12_000;

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

/** The `source` part of a result, when the chosen subtitle says where it came from. */
function originOf(chosen: ChosenSource): Pick<JobResult, 'source'> {
  return chosen.provider
    ? { source: { provider: chosen.provider, language: chosen.language, kind: chosen.kind } }
    : {};
}

/** Requests for the same episode in the same language are one thing to the user (Stremio asks twice). */
function videoKey(spec: JobSpec): string {
  const v = spec.video;
  return [v.idKind, v.externalId, v.season ?? '', v.episode ?? '', spec.targetLanguage].join(':');
}

const SYNC_ETA_MIN_PERCENT = 5;
const SYNC_ETA_MIN_MS = 20_000;
const SYNC_ETA_STALE_MS = 30_000;

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
    at: number;
  } | null = null;
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

  /** A translation that has had no news for a while: the AI is probably not answering. */
  private isStalled(job: Job): boolean {
    return (
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
    return (
      [...this.jobs.values()].some((j) => this.isStalled(j) || this.isSyncStalled(j)) ||
      !!this.restartable()
    );
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
    /** The sound check that goes on beside the translation (or after it): how far it is, 0..100. */
    /** A subtitle with the video's own (exact) timing is on its way to replace the shown one. */
    exactComing: { title: string; season?: number; episode?: number } | null;
    backgroundSync: {
      percent: number;
      waiting: boolean;
      etaSec: number | null;
      title: string;
      season?: number;
      episode?: number;
    } | null;
    /** The subtitle Stremio took last, for half an hour. */
    lastDelivered: {
      title: string;
      season?: number;
      episode?: number;
      via: string;
      at: number;
    } | null;
    /** How the latest background sound check ended, for half an hour. */
    lastSync: {
      title: string;
      season?: number;
      episode?: number;
      outcome: 'moved' | 'kept' | 'inSync' | 'unavailable';
      offsetMs?: number;
      at: number;
    } | null;
    /** Downloads from SubDL this session. */
    subdlDownloads: number;
    /** A better subtitle replaced the shown one in the last half hour (Stremio needs a new selection). */
    upgrade: { title: string; season?: number; episode?: number; at: number } | null;
    /** The Continue button has something to do: a stuck translation, or a cancelled/failed request. */
    resumable: boolean;
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
      resumable: this.resumable(),
      upgrade:
        this.lastUpgrade && this.now() - this.lastUpgrade.at < UPGRADE_NOTICE_MS
          ? { ...this.lastUpgrade }
          : null,
      subdlDownloads: this.subdlDownloads,
      exactComing: this.exactComing(),
      backgroundSync: this.backgroundSync(),
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
   * Rough time left of the sound check, from how fast it went so far. Null while it is too early to
   * tell, or when no data has arrived for a while (the video is not being sent).
   */
  private syncEtaSec(job: Job): number | null {
    const percent = job.syncPercent ?? 0;
    if (job.syncStartedAt === undefined || percent < SYNC_ETA_MIN_PERCENT || percent >= 100) {
      return null;
    }
    const now = this.now();
    if (now - (job.syncProgressAt ?? now) > SYNC_ETA_STALE_MS) return null;
    const elapsedMs = now - job.syncStartedAt;
    if (elapsedMs < SYNC_ETA_MIN_MS) return null;
    const left = (elapsedMs * (100 - percent)) / percent / 1000;
    return Math.max(30, Math.round(left / 30) * 30); // to half a minute
  }

  private exactComing(): ReturnType<JobManager['stats']>['exactComing'] {
    const job = [...this.jobs.values()].find((j) => j.exactPending && this.canUpgrade(j));
    if (!job) return null;
    const v = job.spec.video;
    return {
      title: job.title ?? '',
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
    };
  }

  /** A sound check that is listening while the job is already translating (or done). */
  private backgroundSync(): ReturnType<JobManager['stats']>['backgroundSync'] {
    const job = [...this.jobs.values()].find(
      (j) =>
        (j.syncPercent !== undefined || j.syncWaiting) &&
        j.stage !== 'sync' &&
        j.lateFit !== undefined,
    );
    if (!job) return null;
    const v = job.spec.video;
    return {
      percent: Math.max(0, Math.min(100, Math.round(job.syncPercent ?? 0))),
      waiting: job.syncWaiting === true,
      etaSec: this.syncEtaSec(job),
      title: job.title ?? '',
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
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
      const partialWasShown = job.partial?.served === true;
      delete job.partial;
      if (!job.spec.prefetch) {
        this.lastFailed = false;
        this.lastErrorCode = null;
      }
      void this.record(job, job.result, log);
      this.prefetchNext(job, log);
      if (job.result.exact === false) {
        void this.upgradeLater(job, log);
        void this.upgradeFromSound(job, log);
      }
      if (partialWasShown) void this.announceUpgrade(job, true);
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

  /** Tell the main screen and the desktop that a better subtitle replaced the shown one. */
  private async announceUpgrade(job: Job, once = false): Promise<void> {
    const v = job.spec.video;
    const notice = {
      title: await this.titleFor(job),
      ...(v.season !== undefined ? { season: v.season } : {}),
      ...(v.episode !== undefined ? { episode: v.episode } : {}),
    };
    // Stremio's two requests for one episode finish together: tell the user once.
    const last = this.lastUpgrade;
    if (
      once &&
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
      (j) => j.syncPercent !== undefined && !j.syncStopped,
    );
    for (const job of listening) job.syncStopped = true;
    return listening.length > 0;
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
        if (moved.fit.scale === 1 && Math.abs(moved.fit.offsetMs) < 100) {
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
        await this.announceUpgrade(job);
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
      at: this.now(),
    };
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
        if (!job.lateFit) void this.noteSync(job, moved ? 'moved' : 'kept', moved?.fit.offsetMs);
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
    const parsed = cfg.cleanSubtitles ? cleanSubtitle(file) : file;
    log.info({ stage: 'PARSER', cues: parsed.cues.length, format: parsed.format }, 'source parsed');
    job.progress = { done: 0, total: parsed.cues.length };
    job.stage = 'translate';
    job.progressAt = this.now();

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
        dualSubtitles: dual,
        isCancelled: () => [...watchers].every((w) => w.cancelled),
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
            w.progress = { done, total };
            w.progressAt = this.now();
          }
        },
        logger: log,
        logDialogue: cfg.logDialogue,
      });
    if (!sharing) {
      this.translating.set(trKey, { work, watchers, lead: job, kicks });
      const forget = (): void => void this.translating.delete(trKey);
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
              onProgress: (p) => {
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
        shouldStop: () => !!job.cancelled || wasSkipped(),
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
        // A season pack is one download but holds one subtitle per episode.
        ...(c.pack ? { pack: c.episode ?? 0 } : {}),
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
    const isMain = (c: SubtitleCandidate) => (c.provider ?? 'opensubtitles') === 'opensubtitles';
    if (
      !candidate.hashMatch &&
      isMain(candidate) &&
      this.downloadsLeft !== undefined &&
      this.downloadsLeft >= CONSENSUS_MIN_LEFT
    ) {
      const pool = rankSameLanguage(candidates.filter(isMain), candidate.language).slice(
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
    const spare = () =>
      rankSameLanguage(
        candidates.filter((c) => !isMain(c)),
        candidate.language,
      )[0];
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
    return {
      kind: selection.kind,
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
