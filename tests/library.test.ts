import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Library, type LibraryEntry, srtFileName } from '../src/jobs/library';

const entry = (over: Partial<LibraryEntry> = {}): LibraryEntry => ({
  id: 'a'.repeat(32),
  kind: 'series',
  titleKey: 'imdb:tt1',
  title: 'Show',
  season: 1,
  episode: 2,
  language: 'he',
  cues: 100,
  bytes: 5000,
  createdAt: 1000,
  keys: ['1'.repeat(64)],
  ...over,
});

describe('Library', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'lib-')), 'library.json');

  it('keeps earlier cache keys and the date when a subtitle is made again', () => {
    const lib = new Library(file());
    lib.add(entry());
    lib.add(entry({ createdAt: 9999, cues: 120, keys: ['2'.repeat(64)] }));
    const [e] = lib.list();
    expect(e?.keys).toEqual(['1'.repeat(64), '2'.repeat(64)]);
    expect(e?.createdAt).toBe(1000);
    expect(e?.cues).toBe(120);
  });

  it('learns the video file name when an older entry is made again', () => {
    const lib = new Library(file());
    lib.add(entry());
    expect(lib.list()[0]?.filename).toBeUndefined();
    lib.add(entry({ filename: 'Show.S01E02.mkv' }));
    expect(lib.list()[0]?.filename).toBe('Show.S01E02.mkv');
    lib.add(entry());
    expect(lib.list()[0]?.filename).toBe('Show.S01E02.mkv');
  });

  it('does not rewrite the file when nothing changed', () => {
    const path = file();
    const lib = new Library(path);
    lib.add(entry());
    const before = readFileSync(path, 'utf8');
    lib.add(entry({ createdAt: 5 }));
    expect(readFileSync(path, 'utf8')).toBe(before);
  });

  it('survives a restart and removes entries', () => {
    const path = file();
    new Library(path).add(entry());
    const again = new Library(path);
    expect(again.list()).toHaveLength(1);
    expect(again.remove(['a'.repeat(32)])).toHaveLength(1);
    expect(new Library(path).list()).toHaveLength(0);
  });
});

describe('srtFileName', () => {
  it('names an episode with season, episode and language', () => {
    expect(
      srtFileName({ title: 'Avatar: The Last Airbender', season: 1, episode: 15, language: 'he' }),
    ).toBe('Avatar The Last Airbender S01E15.he.srt');
  });

  it('names a movie without episode numbers', () => {
    expect(srtFileName({ title: 'The Shawshank Redemption', language: 'en' })).toBe(
      'The Shawshank Redemption.en.srt',
    );
  });

  it('removes characters Windows refuses, and never returns an empty name', () => {
    expect(srtFileName({ title: 'A/B\\C*D?"<>|', language: 'he' })).toBe('A B C D.he.srt');
    expect(srtFileName({ title: '???', language: '' })).toBe('subtitle.srt');
  });
});

describe('Library: one line per episode', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'lib-')), 'library.json');
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);

  it('folds the second request of an episode into the first line and keeps every cache key', () => {
    const lib = new Library(file());
    lib.add(entry({ id: A, keys: ['1'.repeat(64)], timing: 'estimated', createdAt: 1000 }));
    lib.add(
      entry({ id: B, keys: ['2'.repeat(64)], timing: 'exact', filename: 'v.mkv', createdAt: 2000 }),
    );
    expect(lib.list()).toHaveLength(1);
    const [e] = lib.list();
    expect(e).toMatchObject({ id: B, timing: 'exact', filename: 'v.mkv', createdAt: 1000 });
    expect(e?.keys.sort()).toEqual(['1'.repeat(64), '2'.repeat(64)]);
    expect(e?.alias).toEqual([A]);
    expect(lib.has(A)).toBe(true); // the first id still counts as made
    expect(lib.has(B)).toBe(true);
  });

  it('keeps different episodes, languages and titles apart', () => {
    const lib = new Library(file());
    lib.add(entry({ id: A }));
    lib.add(entry({ id: B, episode: 3 }));
    lib.add(entry({ id: 'c'.repeat(32), language: 'en' }));
    lib.add(entry({ id: 'd'.repeat(32), titleKey: 'imdb:tt2' }));
    expect(lib.list()).toHaveLength(4);
  });

  it('keeps the alias when the same subtitle is made again, and removes everything together', () => {
    const lib = new Library(file());
    lib.add(entry({ id: A }));
    lib.add(entry({ id: B, keys: ['2'.repeat(64)] }));
    lib.add(entry({ id: B, keys: ['3'.repeat(64)], cues: 120 }));
    expect(lib.list()[0]?.alias).toEqual([A]);
    const gone = lib.remove([B]);
    expect(gone[0]?.keys).toHaveLength(3);
    expect(lib.list()).toEqual([]);
  });

  it('tidies a library saved before, when it is loaded', () => {
    const f = file();
    const first = new Library(f);
    first.add(entry({ id: A }));
    // Write two lines for one episode the way an older version did.
    writeFileSync(
      f,
      JSON.stringify({ v: 1, entries: [entry({ id: A }), entry({ id: B, createdAt: 5000 })] }),
    );
    const lib = new Library(f);
    expect(lib.list()).toHaveLength(1);
    expect(JSON.parse(readFileSync(f, 'utf8')).entries).toHaveLength(1);
  });
});

describe('Library: where a subtitle came from', () => {
  const file = () => join(mkdtempSync(join(tmpdir(), 'lib-')), 'library.json');
  const origin = { provider: 'subdl', language: 'en', kind: 'translate' } as const;

  it('keeps the source when the entry is made again, and takes it over from a folded twin', () => {
    const lib = new Library(file());
    lib.add(entry({ id: 'a'.repeat(32), source: origin }));
    lib.add(entry({ id: 'a'.repeat(32), cues: 120 })); // made again with nothing to say about the source
    expect(lib.list()[0]?.source).toEqual(origin);
    lib.add(entry({ id: 'b'.repeat(32) })); // the other request of the same episode
    expect(lib.list()).toHaveLength(1);
    expect(lib.list()[0]?.source).toEqual(origin);
  });
});
