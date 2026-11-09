import { cacheKey, type FileCache } from '../cache/fileCache';
import type { Config } from '../config/env';
import type { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import type { SourceId } from '../sources/ordered';
import type { LocalStream, loadEmbeddedSubtitle } from '../sources/embedded';
import type { TimingFit } from '../sync/fit';
import type { Library } from './library';
import type { SourceSubtitleProvider, VideoRef } from '../sources/types';
import type { Cue } from '../subtitles/types';
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
  /** When the translation of the file began, for the time estimate (pauses are subtracted). */
  translateStartedAt?: number;
  /** The search inside the video, still running after the job went on without it (see upgradeLater). */
  lateEmbedded?: Promise<ChosenSource | undefined>;
  /** The video's own subtitle is still being read (or translated) to replace the shown one. */
  exactPending?: boolean;
  /** The user pressed Skip (or Cancel) after the job went on: the search inside the video stops. */
  searchSkipped?: boolean;
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
  /** A better subtitle replaced the shown one and the user was told (so "ready" is not said twice). */
  upgradeAnnounced?: boolean;
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
  /** Where the per-series names are kept so every episode spells them the same way (optional). */
  glossaryFile?: string;
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
    onProgress?: (percent: number, estimated?: boolean) => void;
    log?: (info: Record<string, unknown>) => void;
  }) => Promise<TimingFit | undefined>;
  /** When set, every finished subtitle is listed here so the user can review and delete it. */
  library?: Library;
  /** Ask mode: called once when a new request is waiting for the user's OK (for a notification). */
  onPending?: (item: { title: string; season?: number; episode?: number }) => void;
  /** Called when a better (exact-timing) subtitle replaced the shown one in the background. */
  onUpgraded?: (item: { title: string; season?: number; episode?: number }) => void;
  /** Called when a subtitle finished that no earlier notice covered (not an upgrade of a shown one). */
  onFinished?: (item: { title: string; season?: number; episode?: number }) => void;
  /** Called once when a job failed. Only the error code, never subtitle text. */
  onFailed?: (item: { title: string; season?: number; episode?: number; code: string }) => void;
  /** Developer test mode: made-up subtitles are not listed in the library. */
  testMode?: () => boolean;
  /** Reads a subtitle track from the playing video file. Injectable for tests. */
  loadEmbedded?: typeof loadEmbeddedSubtitle;
}

export const JOB_ID = /^[0-9a-f]{32}$/;

/** Where a job's source subtitle came from and what to do with it. */
export interface ChosenSource {
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
 * 12: a ready-made Hebrew subtitle stored with its punctuation flipped is put back in order.
 * 13: dialogue dashes at the start and end of a line are removed from ready-made subtitles.
 * 14: music note symbols (♪) are removed from lines that also hold words.
 */
export const SOURCE_LOGIC_VERSION = 14;

/** A translation is shown in parts only for files with at least this many lines. */
export const PARTIAL_MIN_TOTAL_CUES = 1000;

/** The first part is shown once this share of the lines (from the start) is translated. */
export const PARTIAL_FRACTION = 0.25;

/** How long the "better subtitle is ready" notice stays on the main screen. */
export const UPGRADE_NOTICE_MS = 30 * 60_000;

/** The translation starts without the sound check after this long (30 s); the check goes on in the background. */
export const SYNC_WAIT_MS = 30_000;

/** The sound check, as the translation uses it: the moved source subtitle and the fit that moved it. */
export interface SoundFit {
  source: ChosenSource;
  fit: TimingFit;
}

/** The sound check gives up when the video sends no sound for this long (45 s). */
export const SYNC_NO_DATA_MS = 45_000;
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

export const SYNC_FIND_WAIT_MS = 90_000;
export const SYNC_FIND_EVERY_MS = 3_000;

/** A translation with no news for this long counts as stuck. */
export const STALL_AFTER_MS = 12_000;

/** Files compared for timing when there is no hash match. Each uncached one costs a download. */
export const CONSENSUS_POOL_SIZE = 3;
export const CONSENSUS_MIN_LEFT = 30;
export const QUOTA_REFRESH_MS = 10 * 60_000;
/** After a cancel, the same request is not started again by itself for this long (auto mode). */
export const CANCEL_COOLDOWN_MS = 20_000;

/** Race a promise against a timer. The loser keeps running in the background, but nobody waits for it. */
export function withCap<T>(
  work: Promise<T>,
  ms: number,
  onTimeout: () => T | Promise<T>,
): Promise<T> {
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
export function originOf(chosen: ChosenSource): Pick<JobResult, 'source'> {
  return chosen.provider
    ? { source: { provider: chosen.provider, language: chosen.language, kind: chosen.kind } }
    : {};
}

/** Requests for the same episode in the same language are one thing to the user (Stremio asks twice). */
export function videoKey(spec: JobSpec): string {
  const v = spec.video;
  return [v.idKind, v.externalId, v.season ?? '', v.episode ?? '', spec.targetLanguage].join(':');
}

export const SYNC_ETA_MIN_PERCENT = 5;
export const SYNC_ETA_MIN_MS = 20_000;
export const SYNC_ETA_STALE_MS = 30_000;
