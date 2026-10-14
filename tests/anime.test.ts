import { describe, expect, it } from 'vitest';
import { OpenSubtitlesProvider } from '../src/sources/opensubtitles/provider';
import {
  cinemetaTitle,
  kitsuTitles,
  makeTitleResolver,
  normalizeTitle,
  parseFilename,
  splitSeason,
} from '../src/sources/titles';
import { parseVideoId, type SubtitleQuery } from '../src/sources/types';
import { silentLogger } from './helpers';

const creds = { apiKey: 'K', username: 'u', password: 'p', userAgent: 'T v1' };

/** Fake OpenSubtitles + metadata network. `search` decides what each /subtitles URL returns. */
function net(search: (url: URL) => unknown[], meta: Record<string, unknown> = {}) {
  const urls: URL[] = [];
  const f = (async (input: string) => {
    const u = new URL(input);
    if (u.hostname === 'api.opensubtitles.com' && u.pathname.endsWith('/subtitles')) {
      urls.push(u);
      return new Response(JSON.stringify({ data: search(u) }), { status: 200 });
    }
    for (const [host, body] of Object.entries(meta)) {
      if (u.hostname === host) return new Response(JSON.stringify(body), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  }) as unknown as typeof fetch;
  return { f, urls };
}

const item = (over: {
  parent?: string;
  title?: string;
  season?: number;
  episode?: number;
  release?: string;
  language?: string;
  fileId?: number;
}) => ({
  attributes: {
    language: over.language ?? 'en',
    release: over.release ?? '',
    download_count: 5,
    files: [{ file_id: over.fileId ?? 1, file_name: 'x.srt' }],
    feature_details: {
      parent_title: over.parent,
      title: over.title,
      season_number: over.season,
      episode_number: over.episode,
    },
  },
});

const provider = (f: typeof fetch) =>
  new OpenSubtitlesProvider({ credentials: creds, logger: silentLogger(), fetchImpl: f });

describe('parseFilename', () => {
  it.each([
    [
      '[SubsPlease] Tensei shitara Slime Datta Ken - 12 (1080p) [ABCD1234].mkv',
      { title: 'Tensei shitara Slime Datta Ken', episode: 12 },
    ],
    [
      'The.Beginning.After.the.End.S02E03.1080p.WEB-DL.AAC2.0.H.264.mkv',
      { title: 'The Beginning After the End', season: 2, episode: 3 },
    ],
    [
      '[Erai-raws] Kimetsu no Yaiba - 05 [1080p][HEVC].mkv',
      { title: 'Kimetsu no Yaiba', episode: 5 },
    ],
    ['Show Name 1x07 720p.mp4', { title: 'Show Name', season: 1, episode: 7 }],
    ['Inception.2010.1080p.BluRay.x264.mkv', { title: 'Inception' }],
  ])('%s', (name, expected) => {
    expect(parseFilename(name)).toEqual(expected);
  });
  it('returns undefined for empty or hopeless names', () => {
    expect(parseFilename('')).toBeUndefined();
    expect(parseFilename('[Group].mkv')).toBeUndefined();
  });
});

describe('splitSeason / normalizeTitle', () => {
  it('splits season markers off titles', () => {
    expect(splitSeason('The Beginning After the End Season 2')).toEqual({
      base: 'The Beginning After the End',
      season: 2,
    });
    expect(splitSeason('Tensei shitara Slime Datta Ken 3rd Season')).toEqual({
      base: 'Tensei shitara Slime Datta Ken',
      season: 3,
    });
    expect(splitSeason('Plain Title')).toEqual({ base: 'Plain Title' });
  });
  it('normalizes punctuation and accents', () => {
    expect(normalizeTitle('Café: Rock & Roll!')).toBe('cafe rock and roll');
  });
});

describe('metadata lookups', () => {
  it('reads Kitsu titles and Cinemeta names', async () => {
    const { f } = net(() => [], {
      'kitsu.io': {
        data: {
          attributes: {
            canonicalTitle: 'Saikyou no Ousama',
            titles: {
              en: 'The Beginning After the End',
              en_jp: 'Saikyou no Ousama, Nidome no Jinsei',
            },
          },
        },
      },
      'v3-cinemeta.strem.io': { meta: { name: 'Breaking Bad' } },
    });
    expect(await kitsuTitles('49294', f)).toEqual([
      'The Beginning After the End',
      'Saikyou no Ousama',
      'Saikyou no Ousama, Nidome no Jinsei',
    ]);
    expect(await cinemetaTitle('series', 'tt0903747', f)).toBe('Breaking Bad');
  });
  it('resolver puts the file name first, then metadata, and survives lookup failure', async () => {
    const { f } = net(() => [], {
      'kitsu.io': {
        data: { attributes: { titles: { en: 'The Beginning After the End Season 2' } } },
      },
    });
    const video = parseVideoId('series', 'kitsu:49983:3');
    const guesses = await makeTitleResolver({
      video,
      filename: '[SubsPlease] Saikyou no Ousama - 03 (1080p).mkv',
      logger: silentLogger(),
      fetchImpl: f,
    })();
    expect(guesses[0]).toMatchObject({ title: 'Saikyou no Ousama', episode: 3 });
    expect(guesses[1]).toEqual({ title: 'The Beginning After the End', season: 2, episode: 3 });

    // A Kitsu title with no season marker is treated as season 1.
    const plain = net(() => [], {
      'kitsu.io': { data: { attributes: { titles: { en: 'Attack on Titan' } } } },
    });
    const s1 = await makeTitleResolver({
      video: parseVideoId('series', 'kitsu:7442:10'),
      logger: silentLogger(),
      fetchImpl: plain.f,
    })();
    expect(s1[0]).toEqual({ title: 'Attack on Titan', season: 1, episode: 10 });

    const broken = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const none = await makeTitleResolver({ video, logger: silentLogger(), fetchImpl: broken })();
    expect(none).toEqual([]);
  });
});

describe('OpenSubtitles search ladder for anime', () => {
  const kitsuVideo = parseVideoId('series', 'kitsu:49294:3');

  it('kitsu id: never sends imdb_id/null ids, goes straight to text search', async () => {
    const { f, urls } = net(() => [
      item({
        parent: 'The Beginning After the End',
        title: 'Meeting the King',
        season: 1,
        episode: 3,
        fileId: 9,
      }),
      item({ parent: 'After the Rain', title: 'Raining Tears', season: 1, episode: 3, fileId: 10 }),
    ]);
    const q: SubtitleQuery = {
      video: kitsuVideo,
      languages: ['he', 'en'],
      resolveTitles: async () => [{ title: 'The Beginning After the End', season: 1, episode: 3 }],
    };
    const out = await provider(f).search(q);
    expect(out.map((c) => c.fileId)).toEqual([9]); // other show filtered out
    expect(urls).toHaveLength(1);
    const p = urls[0]!.searchParams;
    expect(p.get('query')).toBe('the beginning after the end');
    expect(p.get('episode_number')).toBe('3');
    expect(p.get('season_number')).toBe('1');
    for (const bad of ['imdb_id', 'parent_imdb_id', 'tmdb_id', 'moviehash'])
      expect(p.has(bad)).toBe(false);
    expect(urls[0]!.search).not.toMatch(/undefined|null/);
  });

  it('relaxes season, then episode filter, and keeps only the right episode', async () => {
    const { f, urls } = net((u) => {
      // Only the query-only request returns anything (like OpenSubtitles does for some anime).
      if (u.searchParams.has('episode_number')) return [];
      return [
        item({ release: 'The.Beginning.After.the.End.S02E02.WEB', fileId: 1 }),
        item({ release: 'The.Beginning.After.the.End.S02E03.WEB', fileId: 2 }),
        item({ release: 'Totally Unrelated Show E03', fileId: 3 }),
      ];
    });
    const out = await provider(f).search({
      video: kitsuVideo,
      languages: ['en'],
      resolveTitles: async () => [{ title: 'The Beginning After the End', season: 2, episode: 3 }],
    });
    expect(out.map((c) => c.fileId)).toEqual([2]);
    expect(urls).toHaveLength(3);
  });

  it('never returns another season when the season is known', async () => {
    const { f } = net(() => [
      item({ parent: 'Attack on Titan', season: 5, episode: 10, fileId: 1 }),
      item({ parent: 'Attack on Titan', season: 1, episode: 10, fileId: 2 }),
    ]);
    const out = await provider(f).search({
      video: parseVideoId('series', 'kitsu:7442:10'),
      languages: ['en'],
      resolveTitles: async () => [{ title: 'Attack on Titan', season: 1, episode: 10 }],
    });
    expect(out.map((c) => c.fileId)).toEqual([2]);
  });

  it('tries the next title guess when the first finds nothing', async () => {
    const { f } = net((u) =>
      u.searchParams.get('query') === 'saikyou no ousama'
        ? [item({ parent: 'Saikyou no Ousama', episode: 3, season: 1, fileId: 7 })]
        : [],
    );
    const out = await provider(f).search({
      video: kitsuVideo,
      languages: ['en'],
      resolveTitles: async () => [
        { title: 'Some Wrong Name', episode: 3 },
        { title: 'Saikyou no Ousama', episode: 3, season: 1 },
      ],
    });
    expect(out.map((c) => c.fileId)).toEqual([7]);
  });

  it('IMDb search that finds nothing falls back to text search', async () => {
    const { f, urls } = net((u) =>
      u.searchParams.has('parent_imdb_id')
        ? []
        : [item({ parent: 'Some Anime', episode: 4, season: 1, fileId: 5 })],
    );
    const out = await provider(f).search({
      video: parseVideoId('series', 'tt1234567:1:4'),
      languages: ['en'],
      resolveTitles: async () => [{ title: 'Some Anime', season: 1, episode: 4 }],
    });
    expect(out.map((c) => c.fileId)).toEqual([5]);
    expect(urls[0]!.searchParams.get('parent_imdb_id')).toBe('1234567');
    expect(urls.length).toBeGreaterThan(2);
  });

  it('TMDB ids use tmdb_id / parent_tmdb_id', async () => {
    const { f, urls } = net(() => [item({ fileId: 1 })]);
    await provider(f).search({ video: parseVideoId('movie', 'tmdb:603'), languages: ['en'] });
    expect(urls[0]!.searchParams.get('tmdb_id')).toBe('603');
    expect(urls[0]!.searchParams.get('type')).toBe('movie');
    await provider(f).search({ video: parseVideoId('series', 'tmdb:1399:1:2'), languages: ['en'] });
    const p = urls[1]!.searchParams;
    expect(p.get('parent_tmdb_id')).toBe('1399');
    expect(p.get('season_number')).toBe('1');
    expect(p.get('episode_number')).toBe('2');
  });

  it('a file hash alone is enough to search when the id is not IMDb/TMDB', async () => {
    const { f, urls } = net(() => [
      {
        ...item({ fileId: 4 }),
        attributes: { ...item({ fileId: 4 }).attributes, moviehash_match: true },
      },
    ]);
    const out = await provider(f).search({
      video: kitsuVideo,
      languages: ['en'],
      movieHash: '8e245d9679d31e12',
    });
    expect(out[0]).toMatchObject({ fileId: 4, hashMatch: true });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.searchParams.get('moviehash')).toBe('8e245d9679d31e12');
  });

  it('returns an empty list (not an error) when nothing matches anywhere', async () => {
    const { f } = net(() => []);
    expect(
      await provider(f).search({
        video: kitsuVideo,
        languages: ['en'],
        resolveTitles: async () => [{ title: 'Nope', episode: 3 }],
      }),
    ).toEqual([]);
    expect(await provider(f).search({ video: kitsuVideo, languages: ['en'] })).toEqual([]);
  });
});
