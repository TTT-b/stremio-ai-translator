/**
 * Read-only views of the jobs for the status card and the queue list. Nothing here changes a job or
 * the manager's state: the manager passes in the jobs (and the few things it owns) and gets numbers
 * back.
 */
import { combineEta, estimateTranslateSec } from './eta';
import {
  videoKey,
  SYNC_ETA_MIN_PERCENT,
  SYNC_ETA_MIN_MS,
  SYNC_ETA_STALE_MS,
  type Job,
  type QueueItem,
} from './jobTypes';

/** A sound check that goes on beside the translation (or after it): how far it is, 0..100. */
export type BackgroundSyncView = {
  percent: number;
  waiting: boolean;
  etaSec: number | null;
  title: string;
  season?: number;
  episode?: number;
} | null;

/** A subtitle with the video's own (exact) timing is on its way to replace the shown one. */
export type ExactComingView = { title: string; season?: number; episode?: number } | null;

/** Live numbers for the status card. Counts this app session only. */
export interface JobStats {
  state: 'waiting' | 'translating' | 'ratelimited' | 'idle' | 'error';
  running: number;
  linesTranslated: number;
  bytesTranslated: number;
  progress: { done: number; total: number; percent: number; etaSec: number | null } | null;
  /** The user paused translating. */
  paused: boolean;
  /** Rough seconds until the subtitle is complete, sound check included; null when not known. */
  totalEtaSec: number | null;
  stage: Job['stage'] | null;
  /** While a video is being listened to: how far it is, 0..100. */
  syncPercent: number | null;
  /** Code of the latest failure while the state is 'error' (never text from the video). */
  lastError: string | null;
  /** OpenSubtitles daily downloads: allowed and left, or null when not known (yet). */
  quota: { limit: number; left: number } | null;
  exactComing: ExactComingView;
  /** Set while the AI moved from the chosen model to another one because it was overloaded. */
  modelSwitch: { from: string; to: string } | null;
  backgroundSync: BackgroundSyncView;
  /** The subtitle Stremio took last, for half an hour. */
  lastDelivered: {
    title: string;
    season?: number;
    episode?: number;
    via: string;
    /** Who gave the source subtitle (opensubtitles, subdl, jimaku), when known. */
    source?: string;
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
}

/** What the user can still act on, one line per episode: waiting for approval, queued or running. */
export function buildQueue(
  allJobs: Job[],
  skippableStep: (running: Job[]) => 'local' | 'sync' | undefined,
): QueueItem[] {
  const groups = new Map<string, Job[]>();
  for (const j of allJobs) {
    if (j.status !== 'pending' && j.status !== 'running') continue;
    const key = videoKey(j.spec);
    groups.set(key, [...(groups.get(key) ?? []), j]);
  }
  // Once one request for an episode has produced its subtitle, the requests that were already
  // waiting at that moment are not shown any more: they are the same episode asked for again
  // (another file). A request made after that is a new wait and is shown.
  for (const [key, active] of groups) {
    const startedFirst = Math.min(...active.map((j) => j.startedAt));
    const served = allJobs.some(
      (j) => j.status === 'done' && videoKey(j.spec) === key && (j.finishedAt ?? 0) >= startedFirst,
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
    const skippable = skippableStep(running);
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

/** Rough time left of the translation, from how fast it went so far; null while too early to tell. */
export function translateEtaSec(
  job: Job,
  p: { done: number; total: number },
  paused: boolean,
  now: number,
): number | null {
  if (paused || job.status !== 'running' || job.stage !== 'translate') return null;
  if (job.translateStartedAt === undefined || p.done <= 0 || p.done >= p.total) return null;
  return estimateTranslateSec(now - job.translateStartedAt, p.done, p.total);
}

/**
 * Rough time left of the sound check, from how fast it went so far. Null while it is too early to
 * tell, or when no data has arrived for a while (the video is not being sent).
 */
export function syncEtaSec(job: Job, now: number): number | null {
  const percent = job.syncPercent ?? 0;
  if (job.syncStartedAt === undefined || percent < SYNC_ETA_MIN_PERCENT || percent >= 100) {
    return null;
  }
  if (now - (job.syncProgressAt ?? now) > SYNC_ETA_STALE_MS) return null;
  const elapsedMs = now - job.syncStartedAt;
  if (elapsedMs < SYNC_ETA_MIN_MS) return null;
  const left = (elapsedMs * (100 - percent)) / percent / 1000;
  return Math.max(30, Math.round(left / 30) * 30); // to half a minute
}

/**
 * Time until the subtitle is complete: what is left of the translation plus what is left of the
 * sound check. Null when nothing is running or one of the parts cannot be estimated yet.
 */
export function totalEtaSec(
  current: Job | undefined,
  progress: { etaSec: number | null } | null,
  sync: BackgroundSyncView,
  now: number,
): number | null {
  const translating = current?.status === 'running' && current.stage === 'translate';
  const translateEta = translating ? (progress?.etaSec ?? null) : 0;
  const syncing = current?.status === 'running' && current.stage === 'sync';
  const syncEta = sync
    ? sync.waiting
      ? null
      : sync.etaSec
    : current && syncing
      ? syncEtaSec(current, now)
      : 0;
  return combineEta(translateEta, syncEta);
}

export function exactComing(allJobs: Job[], canUpgrade: (job: Job) => boolean): ExactComingView {
  const job = allJobs.find((j) => j.exactPending && canUpgrade(j));
  if (!job) return null;
  const v = job.spec.video;
  return {
    title: job.title ?? '',
    ...(v.season !== undefined ? { season: v.season } : {}),
    ...(v.episode !== undefined ? { episode: v.episode } : {}),
  };
}

/** A sound check that is listening while the job is already translating (or done). */
export function backgroundSync(allJobs: Job[], now: number): BackgroundSyncView {
  const job = allJobs.find(
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
    etaSec: syncEtaSec(job, now),
    title: job.title ?? '',
    ...(v.season !== undefined ? { season: v.season } : {}),
    ...(v.episode !== undefined ? { episode: v.episode } : {}),
  };
}
