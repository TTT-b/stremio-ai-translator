import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cacheKey, FileCache } from '../src/cache/fileCache';
import { silentLogger } from './helpers';

const mk = (ttlMs = 1000, now = () => 1_000_000) => {
  const dir = mkdtempSync(join(tmpdir(), 'cache-'));
  return { dir, cache: new FileCache(dir, ttlMs, silentLogger(), now) };
};

describe('cacheKey', () => {
  it('is stable regardless of property order and changes with any part', () => {
    const a = cacheKey({ model: 'm', lang: 'he', prompt: 'v1' });
    expect(cacheKey({ prompt: 'v1', lang: 'he', model: 'm' })).toBe(a);
    expect(cacheKey({ model: 'm2', lang: 'he', prompt: 'v1' })).not.toBe(a);
    expect(cacheKey({ model: 'm', lang: 'he', prompt: 'v2' })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('FileCache', () => {
  const key = cacheKey({ a: 1 });

  it('misses, then hits after a write', () => {
    const { cache } = mk();
    expect(cache.get(key)).toBeUndefined();
    cache.set(key, 'translation', '1\n00:00:01,000 --> 00:00:02,000\nשלום\n', 1);
    expect(cache.get(key)).toMatchObject({ kind: 'translation', cues: 1 });
  });

  it('clear() removes translations but keeps downloaded sources', () => {
    const { cache, dir } = mk();
    const src = cacheKey({ a: 'source' });
    cache.set(key, 'translation', 'translated', 1);
    cache.set(src, 'source', 'original', 1);
    expect(cache.clear('translation')).toMatchObject({ removed: 1 });
    expect(cache.clear('translation').bytes).toBe(0);
    expect(cache.get(key)).toBeUndefined();
    expect(cache.get(src)).toMatchObject({ kind: 'source' });
    expect(readdirSync(dir)).toHaveLength(1);
    const all = cache.clear();
    expect(all.removed).toBe(1);
    expect(all.bytes).toBeGreaterThan(0);
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('treats expired entries as misses', () => {
    let t = 1_000_000;
    const { cache } = mk(1000, () => t);
    cache.set(key, 'translation', 'x', 1);
    t += 5000;
    expect(cache.get(key)).toBeUndefined();
  });

  it('detects and removes corrupt entries', () => {
    const { cache, dir } = mk();
    cache.set(key, 'translation', 'good content', 1);
    const file = join(dir, `${key}.json`);
    const entry = JSON.parse(readFileSync(file, 'utf8'));
    entry.content = 'tampered';
    writeFileSync(file, JSON.stringify(entry));
    expect(cache.get(key)).toBeUndefined();
    expect(readdirSync(dir)).not.toContain(`${key}.json`);

    writeFileSync(file, '{not json');
    expect(cache.get(key)).toBeUndefined();
  });

  it('rejects path-like keys', () => {
    const { cache } = mk();
    expect(() => cache.get('../../etc/passwd')).toThrow();
  });

  it('cleanup removes expired and corrupt files, keeps fresh ones', () => {
    let t = 1_000_000;
    const { cache, dir } = mk(10_000, () => t);
    const old = cacheKey({ n: 'old' });
    const fresh = cacheKey({ n: 'fresh' });
    cache.set(old, 'translation', 'a', 1);
    t += 20_000;
    cache.set(fresh, 'translation', 'b', 1);
    writeFileSync(join(dir, `${cacheKey({ n: 'bad' })}.json`), 'garbage');
    expect(cache.cleanup()).toEqual({ removed: 2, kept: 1 });
  });

  it('never stores anything but what it was given (no API key in file)', () => {
    const { cache, dir } = mk();
    cache.set(key, 'translation', 'subtitle text', 1);
    const text = readFileSync(join(dir, `${key}.json`), 'utf8');
    expect(text).not.toMatch(/api[-_]?key|AIza/i);
  });
});
