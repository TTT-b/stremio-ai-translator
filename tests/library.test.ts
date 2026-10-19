import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Library, type LibraryEntry } from '../src/jobs/library';

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
