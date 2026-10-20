import { mkdtempSync, readFileSync } from 'node:fs';
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
