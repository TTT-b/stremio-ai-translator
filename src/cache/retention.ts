import { unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../errors';
import type { Library, LibraryEntry } from '../jobs/library';
import type { Logger } from '../logging/logger';
import type { FileCache } from './fileCache';

/** Saved subtitles are deleted this many days after they were created. */
export const SUBTITLE_RETENTION_DAYS = 90;

export const RETENTION_CHECK_INTERVAL_MS = 86_400_000;

export interface RetentionDeps {
  library: Library;
  cache: FileCache;
  /** Folder with the per-job `<id>.json` files. */
  jobsDir: string;
  logger: Logger;
  now?: () => number;
}

/** Delete one subtitle's cache entries (including per-chunk ones) and job files. Throws AppError. */
function deleteFiles(entry: LibraryEntry, deps: RetentionDeps): void {
  try {
    for (const key of entry.keys) deps.cache.delete(key);
    for (const id of [entry.id, ...(entry.alias ?? [])]) {
      try {
        unlinkSync(join(deps.jobsDir, `${id}.json`));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
      }
    }
  } catch {
    throw new AppError('CACHE_WRITE_FAILED', 'retention delete');
  }
}

/**
 * Remove library entries created more than SUBTITLE_RETENTION_DAYS ago, together with their cache
 * files and job files. Never throws; returns how many subtitles were removed. Logs counts only.
 */
export function purgeExpiredSubtitles(deps: RetentionDeps): number {
  const now = (deps.now ?? Date.now)();
  const limit = SUBTITLE_RETENTION_DAYS * 86_400_000;
  let removed = 0;
  let failed = 0;
  try {
    const expired = deps.library.list().filter((e) => now - e.createdAt > limit);
    for (const entry of expired) {
      try {
        deleteFiles(entry, deps);
        deps.library.remove([entry.id]);
        removed++;
      } catch (err) {
        failed++;
        const code = err instanceof AppError ? err.code : 'CACHE_WRITE_FAILED';
        deps.logger.warn({ stage: 'CACHE', errorCode: code }, 'could not delete an old subtitle');
      }
    }
  } catch {
    failed++;
    deps.logger.warn(
      { stage: 'CACHE', errorCode: 'CACHE_WRITE_FAILED' },
      'old subtitle cleanup failed',
    );
  }
  if (removed > 0 || failed > 0) {
    deps.logger.info({ stage: 'CACHE', removed }, 'old saved subtitles deleted');
  }
  return removed;
}
