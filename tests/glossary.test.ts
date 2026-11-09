import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractNames,
  MAX_NAMES_PER_SERIES,
  MAX_SERIES,
  namesForRequest,
  seriesKeyOf,
} from '../src/translation/glossary';
import { GlossaryStore } from '../src/translation/glossaryStore';
import { silentLogger } from './helpers';

const cue = (text: string) => ({ text });

describe('extractNames', () => {
  const source = [
    'Hello, Naruto!',
    'Where is Sasuke?',
    'Naruto ran to the gate.',
    'We must find Sasuke.',
    'Naruto and Sasuke left.',
    'The village is quiet.',
    'Sasuke said nothing.',
  ].map(cue);
  const target = [
    'שלום, נארוטו!',
    'איפה סאסקה?',
    'לנארוטו היה חם בשער.',
    'אנחנו חייבים למצוא את סאסקה.',
    'נארוטו וסאסקה עזבו.',
    'הכפר שקט.',
    'סאסקה לא אמר דבר.',
  ].map(cue);

  it('pairs a repeated name with the target word that appears with it every time', () => {
    const names = extractNames(source, target, 'he', false);
    expect(names['Naruto']).toBe('נארוטו');
    expect(names['Sasuke']).toBe('סאסקה');
  });

  it('ignores ordinary capitalised words at the start of a line', () => {
    const names = extractNames(source, target, 'he', false);
    expect(Object.keys(names).sort()).toEqual(['Naruto', 'Sasuke']);
  });

  it('skips a name that appears too few times to be sure', () => {
    const names = extractNames(
      [cue('Hi, Ron!'), cue('Bye Ron.'), cue('Nothing here.')],
      [cue('היי, רון!'), cue('ביי רון.'), cue('כלום.')],
      'he',
      false,
    );
    expect(names).toEqual({});
  });

  it('skips a name whose target word is not consistent', () => {
    const names = extractNames(
      [cue('See Kira.'), cue('Kira runs.'), cue('Then Kira left.'), cue('Kira?')],
      [cue('ראה אחד.'), cue('שניים רץ.'), cue('אז שלוש עזב.'), cue('ארבע?')],
      'he',
      false,
    );
    expect(names).toEqual({});
  });

  it('skips names that stay the same in the target language', () => {
    const src = [cue('Hi Paris.'), cue('Go to Paris.'), cue('Paris is big.')];
    expect(extractNames(src, src, 'fr', false)).toEqual({});
  });

  it('reads only the translated line of a two-line (dual) subtitle', () => {
    const dual = target.map((t, i) => cue(`${source[i]?.text}\n${t.text}`));
    const names = extractNames(source, dual, 'he', true);
    expect(names['Naruto']).toBe('נארוטו');
  });

  it('returns nothing when the cue counts differ', () => {
    expect(extractNames(source, target.slice(1), 'he', false)).toEqual({});
  });
});

describe('seriesKeyOf', () => {
  it('uses the id without season and episode, only for series', () => {
    expect(seriesKeyOf({ type: 'series', idKind: 'imdb', externalId: 'tt0944947' })).toBe(
      'imdb:tt0944947',
    );
    expect(seriesKeyOf({ type: 'series', idKind: 'kitsu', externalId: '49294' })).toBe(
      'kitsu:49294',
    );
    expect(seriesKeyOf({ type: 'movie', idKind: 'imdb', externalId: 'tt0111161' })).toBeUndefined();
  });
});

describe('namesForRequest', () => {
  it('lists only the names that occur in the given lines', () => {
    const names = { Naruto: 'נארוטו', Sasuke: 'סאסקה' };
    expect(namesForRequest(names, ['Run, Naruto!'])).toEqual(['Naruto = נארוטו']);
    expect(namesForRequest(names, ['nothing'])).toEqual([]);
    expect(namesForRequest(undefined, ['Naruto'])).toEqual([]);
  });
});

describe('GlossaryStore', () => {
  let dir: string;
  let file: string;
  let clock: number;
  const logger = silentLogger();
  const make = () => new GlossaryStore(file, logger, () => clock);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'gloss-'));
    file = join(dir, 'glossary.json');
    clock = 1_000;
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('returns nothing for an unknown series', () => {
    expect(make().get('imdb:tt1')).toEqual({});
  });

  it('keeps learned names for the next episode', () => {
    make().learn('imdb:tt1', { Naruto: 'נארוטו' });
    expect(make().get('imdb:tt1')).toEqual({ Naruto: 'נארוטו' });
  });

  it('keeps the first spelling when a later episode disagrees', () => {
    make().learn('imdb:tt1', { Naruto: 'נארוטו' });
    make().learn('imdb:tt1', { Naruto: 'נרוטו', Sasuke: 'סאסקה' });
    expect(make().get('imdb:tt1')).toEqual({ Naruto: 'נארוטו', Sasuke: 'סאסקה' });
  });

  it('stores a lastUsed time per series and refreshes it on use', () => {
    make().learn('imdb:tt1', { Naruto: 'נארוטו' });
    clock = 5_000;
    make().get('imdb:tt1');
    const saved = JSON.parse(readFileSync(file, 'utf8')) as {
      series: Record<string, { lastUsed: number }>;
    };
    expect(saved.series['imdb:tt1']?.lastUsed).toBe(5_000);
  });

  it('caps the names per series, dropping the least confirmed', () => {
    const store = make();
    store.learn('imdb:tt1', { Keeper: 'שומר' });
    store.learn('imdb:tt1', { Keeper: 'שומר' });
    const many: Record<string, string> = {};
    for (let i = 0; i < MAX_NAMES_PER_SERIES + 20; i++) many[`Name${i}`] = `שם${i}`;
    store.learn('imdb:tt1', many);
    const got = make().get('imdb:tt1');
    expect(Object.keys(got).length).toBe(MAX_NAMES_PER_SERIES);
    expect(got['Keeper']).toBe('שומר');
  });

  it('caps the number of series, dropping the least recently used', () => {
    const store = make();
    for (let i = 0; i < MAX_SERIES + 5; i++) {
      clock = 1_000 + i;
      store.learn(`imdb:tt${i}`, { Naruto: 'נארוטו' });
    }
    const saved = JSON.parse(readFileSync(file, 'utf8')) as { series: Record<string, unknown> };
    expect(Object.keys(saved.series).length).toBe(MAX_SERIES);
    expect(saved.series['imdb:tt0']).toBeUndefined();
    expect(saved.series[`imdb:tt${MAX_SERIES + 4}`]).toBeDefined();
  });

  it('treats a corrupt or wrongly shaped file as empty and does not throw', () => {
    writeFileSync(file, '{not json', 'utf8');
    expect(make().get('imdb:tt1')).toEqual({});
    writeFileSync(file, JSON.stringify({ v: 1, series: { a: { lastUsed: 'x' } } }), 'utf8');
    expect(make().get('a')).toEqual({});
    make().learn('imdb:tt1', { Naruto: 'נארוטו' });
    expect(make().get('imdb:tt1')).toEqual({ Naruto: 'נארוטו' });
  });

  it('throws an AppError when the file cannot be written', () => {
    const bad = new GlossaryStore(dir, logger, () => clock);
    expect(() => bad.learn('imdb:tt1', { Naruto: 'נארוטו' })).toThrowError(
      expect.objectContaining({ code: 'CACHE_WRITE_FAILED' }) as Error,
    );
  });
});
