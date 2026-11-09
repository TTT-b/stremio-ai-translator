import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { FileCache, cacheKey } from '../src/cache/fileCache';
import { SUBTITLE_RETENTION_DAYS, purgeExpiredSubtitles } from '../src/cache/retention';
import { Library, type LibraryEntry } from '../src/jobs/library';
import { createLogger } from '../src/logging/logger';

const DAY = 86_400_000;
const NOW = 1_800_000_000_000;
const logger = createLogger({ level: 'silent', secrets: () => [], console: false });

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'ret-'));
  const jobsDir = join(dir, 'jobs');
  mkdirSync(jobsDir, { recursive: true });
  const cache = new FileCache(join(dir, 'cache'), 1000 * DAY, logger, () => NOW);
  const library = new Library(join(dir, 'library.json'));
  const add = (idChar: string, ageDays: number, alias?: string) => {
    const key = cacheKey({ n: idChar });
    const chunkKey = cacheKey({ n: idChar, chunk: 1 });
    cache.set(key, 'translation', 'x', 1);
    cache.set(chunkKey, 'translation', 'y', 1);
    const id = idChar.repeat(32);
    writeFileSync(join(jobsDir, `${id}.json`), '{}', 'utf8');
    if (alias) writeFileSync(join(jobsDir, `${alias.repeat(32)}.json`), '{}', 'utf8');
    const e: LibraryEntry = {
      id,
      kind: 'movie',
      titleKey: `imdb:${idChar}`,
      title: 'T',
      language: 'he',
      cues: 1,
      bytes: 1,
      createdAt: NOW - ageDays * DAY,
      keys: [key, chunkKey],
      ...(alias ? { alias: [alias.repeat(32)] } : {}),
    };
    library.add(e);
    return { id, key, chunkKey, alias: alias?.repeat(32) };
  };
  return { dir, jobsDir, cache, library, add };
}

describe('purgeExpiredSubtitles', () => {
  it('keeps the retention at 90 days', () => {
    expect(SUBTITLE_RETENTION_DAYS).toBe(90);
  });

  it('deletes subtitles older than 90 days with all their files and keeps newer ones', () => {
    const s = setup();
    const old = s.add('a', 91, 'c');
    const fresh = s.add('b', 89);
    const settings = join(s.dir, 'settings.json');
    writeFileSync(settings, '{}', 'utf8');
    const testDir = join(s.dir, 'test-subtitles');
    mkdirSync(testDir);
    writeFileSync(join(testDir, 'a.srt'), '1', 'utf8');

    const removed = purgeExpiredSubtitles({
      library: s.library,
      cache: s.cache,
      jobsDir: s.jobsDir,
      logger,
      now: () => NOW,
    });

    expect(removed).toBe(1);
    expect(s.library.get(old.id)).toBeUndefined();
    expect(s.cache.get(old.key)).toBeUndefined();
    expect(s.cache.get(old.chunkKey)).toBeUndefined();
    expect(existsSync(join(s.jobsDir, `${old.id}.json`))).toBe(false);
    expect(existsSync(join(s.jobsDir, `${old.alias}.json`))).toBe(false);
    expect(s.library.get(fresh.id)).toBeDefined();
    expect(s.cache.get(fresh.key)).toBeDefined();
    expect(existsSync(join(s.jobsDir, `${fresh.id}.json`))).toBe(true);
    expect(existsSync(settings)).toBe(true);
    expect(existsSync(join(testDir, 'a.srt'))).toBe(true);
  });

  it('judges age from creation only, on the exact boundary', () => {
    const s = setup();
    const edge = s.add('d', SUBTITLE_RETENTION_DAYS);
    const removed = purgeExpiredSubtitles({
      library: s.library,
      cache: s.cache,
      jobsDir: s.jobsDir,
      logger,
      now: () => NOW,
    });
    expect(removed).toBe(0);
    expect(s.library.get(edge.id)).toBeDefined();
  });

  it('logs a count with the CACHE tag and never throws when deleting fails', () => {
    const s = setup();
    s.add('a', 200);
    const warn = vi.fn();
    const info = vi.fn();
    const log = { info, warn, child: () => log } as unknown as Parameters<
      typeof purgeExpiredSubtitles
    >[0]['logger'];
    vi.spyOn(s.cache, 'delete').mockImplementation(() => {
      throw new Error('disk locked');
    });
    expect(() =>
      purgeExpiredSubtitles({
        library: s.library,
        cache: s.cache,
        jobsDir: s.jobsDir,
        logger: log,
        now: () => NOW,
      }),
    ).not.toThrow();
    const calls = JSON.stringify([...warn.mock.calls, ...info.mock.calls]);
    expect(calls).toContain('CACHE');
    expect(calls).toContain('CACHE_WRITE_FAILED');
  });

  it('logs only the number removed', () => {
    const s = setup();
    s.add('a', 200);
    const info = vi.fn();
    const log = { info, warn: vi.fn(), child: () => log } as unknown as Parameters<
      typeof purgeExpiredSubtitles
    >[0]['logger'];
    purgeExpiredSubtitles({
      library: s.library,
      cache: s.cache,
      jobsDir: s.jobsDir,
      logger: log,
      now: () => NOW,
    });
    expect(info).toHaveBeenCalledWith({ stage: 'CACHE', removed: 1 }, expect.any(String));
  });
});
