import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';

export interface CacheEntry {
  v: 1;
  kind: 'translation' | 'source';
  createdAt: number;
  /** Number of cues, for sanity checks and logs. */
  cues: number;
  /** SHA-256 of `content`, used to detect corruption. */
  contentSha: string;
  /** Subtitle text (SRT). */
  content: string;
}

export const sha256 = (s: string): string => createHash('sha256').update(s, 'utf8').digest('hex');

/** Build a cache key from non-secret parts. API keys must never be passed in. */
export function cacheKey(parts: Record<string, string | number | boolean | undefined>): string {
  const sorted = Object.keys(parts)
    .sort()
    .map((k) => [k, parts[k] ?? null]);
  return sha256(JSON.stringify(sorted));
}

/**
 * One JSON file per entry in `dir`, written atomically. Reads never throw: a missing,
 * expired or corrupt entry is a miss (corrupt files are deleted).
 */
export class FileCache {
  constructor(
    private readonly dir: string,
    private readonly ttlMs: number,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  private path(key: string): string {
    if (!/^[0-9a-f]{64}$/.test(key)) throw new AppError('CACHE_READ_FAILED', 'invalid key');
    return join(this.dir, `${key}.json`);
  }

  get(key: string): CacheEntry | undefined {
    const log = this.logger.child({ stage: 'CACHE', key: key.slice(0, 12) });
    const file = this.path(key);
    let raw: string;
    try {
      raw = readFileSync(file, 'utf8');
    } catch {
      log.info({ hit: false }, 'cache miss');
      return undefined;
    }
    try {
      const e = JSON.parse(raw) as CacheEntry;
      if (e.v !== 1 || typeof e.content !== 'string' || sha256(e.content) !== e.contentSha) {
        throw new Error('checksum mismatch');
      }
      if (this.now() - e.createdAt > this.ttlMs) {
        log.info({ hit: false, reason: 'expired' }, 'cache miss');
        this.remove(file);
        return undefined;
      }
      log.info({ hit: true, kind: e.kind, cues: e.cues }, 'cache hit');
      return e;
    } catch {
      log.warn({ errorCode: 'CACHE_READ_FAILED' }, 'corrupt cache entry removed');
      this.remove(file);
      return undefined;
    }
  }

  set(key: string, kind: CacheEntry['kind'], content: string, cues: number): void {
    const entry: CacheEntry = {
      v: 1,
      kind,
      createdAt: this.now(),
      cues,
      contentSha: sha256(content),
      content,
    };
    const file = this.path(key);
    const tmp = `${file}.${process.pid}.tmp`;
    try {
      writeFileSync(tmp, JSON.stringify(entry), 'utf8');
      renameSync(tmp, file);
    } catch {
      this.remove(tmp);
      throw new AppError('CACHE_WRITE_FAILED');
    }
    this.logger.info({ stage: 'CACHE', key: key.slice(0, 12), kind, cues }, 'cache write');
  }

  /** Delete expired or unreadable entries and stray temp files. */
  cleanup(): { removed: number; kept: number } {
    let removed = 0;
    let kept = 0;
    for (const name of readdirSync(this.dir)) {
      const file = join(this.dir, name);
      let drop = false;
      if (name.endsWith('.tmp')) {
        drop = this.now() - statSync(file).mtimeMs > 60_000;
      } else if (name.endsWith('.json')) {
        try {
          const e = JSON.parse(readFileSync(file, 'utf8')) as CacheEntry;
          drop =
            e.v !== 1 ||
            sha256(e.content) !== e.contentSha ||
            this.now() - e.createdAt > this.ttlMs;
        } catch {
          drop = true;
        }
      } else continue;
      if (drop) {
        this.remove(file);
        removed++;
      } else kept++;
    }
    return { removed, kept };
  }

  /**
   * Delete cached entries of one kind (all kinds when omitted), plus unreadable files and stray
   * temp files. Returns how many files and bytes were removed.
   */
  clear(kind?: CacheEntry['kind']): { removed: number; bytes: number } {
    let removed = 0;
    let bytes = 0;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.json') && !name.endsWith('.tmp')) continue;
      const file = join(this.dir, name);
      let drop = true;
      if (kind && name.endsWith('.json')) {
        try {
          drop = (JSON.parse(readFileSync(file, 'utf8')) as CacheEntry).kind === kind;
        } catch {
          drop = true;
        }
      }
      if (drop) {
        try {
          bytes += statSync(file).size;
        } catch {
          /* already gone */
        }
        this.remove(file);
        removed++;
      }
    }
    return { removed, bytes };
  }

  /** Delete one entry (no error when it is already gone). */
  delete(key: string): void {
    this.remove(this.path(key));
  }

  private remove(file: string): void {
    try {
      unlinkSync(file);
    } catch {
      /* already gone */
    }
  }
}
