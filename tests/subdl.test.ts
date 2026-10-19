import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { FallbackSource } from '../src/sources/fallback';
import { SubdlProvider } from '../src/sources/subdl/provider';
import type {
  SourceSubtitleProvider,
  SubtitleCandidate,
  SubtitleQuery,
} from '../src/sources/types';
import { makeZip, silentLogger } from './helpers';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nHello\n';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fake(routes: (url: URL) => Response | Promise<Response>) {
  const urls: URL[] = [];
  const f = (async (u: string) => {
    const url = new URL(u);
    urls.push(url);
    return routes(url);
  }) as unknown as typeof fetch;
  return { f, urls };
}

const provider = (f: typeof fetch) =>
  new SubdlProvider({ apiKey: 'key-123456', logger: silentLogger(), fetchImpl: f });

const episode: SubtitleQuery = {
  video: {
    type: 'series',
    idKind: 'imdb',
    externalId: 'tt0944947',
    imdbId: 'tt0944947',
    season: 2,
    episode: 5,
  },
  languages: ['he', 'en'],
};

const sub = (over: Record<string, unknown> = {}) => ({
  release_name: 'Show.S02E05.WEB',
  name: 'Show.S02E05.zip',
  url: '/subtitle/3197651-3213944.zip',
  season: 2,
  episode: 5,
  full_season: false,
  hi: false,
  ...over,
});

describe('SubDL provider', () => {
  it('connection test: accepts a good key, rejects a bad one, reports an unreachable server', async () => {
    const ok = fake(() => json({ status: true, results: [], subtitles: [] }));
    expect(await provider(ok.f).testConnection()).toMatchObject({ ok: true });
    expect(ok.urls[0]!.searchParams.get('api_key')).toBe('key-123456');
    const bad = fake(() => json({ status: false, error: 'Not Authorized' }, 403));
    expect(await provider(bad.f).testConnection()).toMatchObject({
      ok: false,
      code: 'INVALID_API_KEY',
    });
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await provider(down).testConnection()).toMatchObject({
      ok: false,
      code: 'SOURCE_DOWNLOAD_FAILED',
    });
  });

  it('searches by IMDb id, once per language, and maps the subtitles', async () => {
    const { f, urls } = fake(() => json({ status: true, results: [], subtitles: [sub()] }));
    const found = await provider(f).search(episode);
    expect(urls).toHaveLength(2);
    const first = urls[0]!.searchParams;
    expect(first.get('imdb_id')).toBe('tt0944947');
    expect(first.get('type')).toBe('tv');
    expect(first.get('season_number')).toBe('2');
    expect(first.get('episode_number')).toBe('5');
    expect(first.get('languages')).toBe('HE');
    expect(urls[1]!.searchParams.get('languages')).toBe('EN');
    expect(found.map((c) => c.language)).toEqual(['he', 'en']);
    expect(found[0]).toMatchObject({
      provider: 'subdl',
      fileId: 3213944,
      downloadPath: '/subtitle/3197651-3213944.zip',
      hashMatch: false,
    });
  });

  it('skips season packs, other episodes and odd download paths', async () => {
    const { f } = fake(() =>
      json({
        status: true,
        subtitles: [
          sub({ full_season: true }),
          sub({ episode: 6 }),
          sub({ url: 'https://evil.example/x.zip' }),
          sub({ url: '/subtitle/1-2.zip', name: 'ok.zip' }),
        ],
      }),
    );
    const found = await provider(f).search({ ...episode, languages: ['en'] });
    expect(found).toHaveLength(1);
    expect(found[0]!.fileName).toBe('ok.zip');
  });

  it('text search keeps results only when the title agrees', async () => {
    const wrong = fake(() =>
      json({ status: true, results: [{ name: 'Another Show' }], subtitles: [sub()] }),
    );
    const q: SubtitleQuery = {
      video: { type: 'series', idKind: 'kitsu', externalId: '1', episode: 3 },
      languages: ['en'],
      resolveTitles: async () => [{ title: 'My Anime', episode: 3 }],
    };
    expect(await provider(wrong.f).search(q)).toEqual([]);
    const right = fake(() =>
      json({ status: true, results: [{ name: 'My Anime' }], subtitles: [sub({ episode: 3 })] }),
    );
    expect(await provider(right.f).search(q)).toHaveLength(1);
    expect(right.urls[0]!.searchParams.get('film_name')).toBe('My Anime');
  });

  it('finds nothing (and does not throw) when SubDL fails or has no key', async () => {
    const down = fake(() => json({ status: false, error: 'nope' }, 500));
    expect(await provider(down.f).search(episode)).toEqual([]);
    const noKey = new SubdlProvider({ apiKey: '', logger: silentLogger() });
    expect(await noKey.search(episode)).toEqual([]);
  });

  it('downloads a zip and returns the .srt inside', async () => {
    const zip = makeZip({ 'readme.txt': 'hi', 'Show.S02E05.srt': SRT });
    const { f, urls } = fake(() => new Response(new Uint8Array(zip), { status: 200 }));
    const p = provider(f);
    const c = (await p.search({ ...episode, languages: ['en'] }).catch(() => []))[0];
    const cand: SubtitleCandidate = c ?? {
      fileId: 1,
      language: 'en',
      fileName: 'x',
      downloadCount: 0,
      rating: 0,
      hashMatch: false,
      hearingImpaired: false,
      machineTranslated: false,
      provider: 'subdl',
      downloadPath: '/subtitle/3197651-3213944.zip',
    };
    const got = await p.download({ ...cand, downloadPath: '/subtitle/3197651-3213944.zip' });
    expect(got.content).toBe(SRT);
    expect(got.fileName).toBe('Show.S02E05.srt');
    expect(urls.at(-1)!.href).toBe('https://dl.subdl.com/subtitle/3197651-3213944.zip');
  });

  it('refuses an archive without a .srt and an unsafe path, and reports the limit', async () => {
    const base: SubtitleCandidate = {
      fileId: 1,
      language: 'en',
      fileName: 'x',
      downloadCount: 0,
      rating: 0,
      hashMatch: false,
      hearingImpaired: false,
      machineTranslated: false,
      provider: 'subdl',
      downloadPath: '/subtitle/1-2.zip',
    };
    const noSrt = fake(
      () => new Response(new Uint8Array(makeZip({ 'a.txt': 'x' })), { status: 200 }),
    );
    await expect(provider(noSrt.f).download(base)).rejects.toMatchObject({
      code: 'UNSUPPORTED_SUBTITLE_FORMAT',
    });
    await expect(
      provider(noSrt.f).download({ ...base, downloadPath: 'https://evil.example/a.zip' }),
    ).rejects.toBeInstanceOf(AppError);
    const limited = fake(() => new Response('', { status: 429 }));
    await expect(provider(limited.f).download(base)).rejects.toMatchObject({
      code: 'SOURCE_QUOTA_EXCEEDED',
    });
  });
});

describe('FallbackSource', () => {
  const c = (id: number, provider?: 'subdl'): SubtitleCandidate => ({
    fileId: id,
    language: 'en',
    fileName: 'a',
    downloadCount: 1,
    rating: 1,
    hashMatch: false,
    hearingImpaired: false,
    machineTranslated: false,
    ...(provider ? { provider } : {}),
  });
  const source = (
    name: string,
    search: () => Promise<SubtitleCandidate[]>,
  ): SourceSubtitleProvider & { downloaded: number[] } => {
    const s = {
      downloaded: [] as number[],
      getProviderName: () => name,
      testConnection: async () => ({ ok: true, provider: name, model: '-', message: 'ok' }),
      search,
      download: async (cand: SubtitleCandidate) => {
        s.downloaded.push(cand.fileId);
        return { content: name, fileName: 'a.srt' };
      },
    };
    return s;
  };

  it('lists both providers and downloads from the one a candidate came from', async () => {
    const a = source('os', async () => [c(1)]);
    const b = source('sd', async () => [c(2, 'subdl')]);
    const both = new FallbackSource(a, b);
    const found = await both.search(episode);
    expect(found.map((x) => x.fileId)).toEqual([1, 2]);
    expect((await both.download(found[1]!)).content).toBe('sd');
    expect((await both.download(found[0]!)).content).toBe('os');
  });

  it('never lets the second provider fail a search, and covers a failing first one', async () => {
    const boom = async (): Promise<SubtitleCandidate[]> => {
      throw new AppError('SOURCE_DOWNLOAD_FAILED');
    };
    const ok = source('os', async () => [c(1)]);
    expect(await new FallbackSource(ok, source('sd', boom)).search(episode)).toHaveLength(1);
    const second = source('sd', async () => [c(2, 'subdl')]);
    expect(await new FallbackSource(source('os', boom), second).search(episode)).toHaveLength(1);
    await expect(
      new FallbackSource(
        source('os', boom),
        source('sd', async () => []),
      ).search(episode),
    ).rejects.toBeInstanceOf(AppError);
  });

  it('with preferSecond, asks the second provider first and the first only when it has nothing', async () => {
    const os = source('os', async () => [c(1)]);
    const sd = source('sd', async () => [c(2, 'subdl')]);
    expect((await new FallbackSource(os, sd, true).search(episode)).map((x) => x.fileId)).toEqual([
      2,
    ]);
    const empty = source('sd', async () => []);
    expect(
      (await new FallbackSource(os, empty, true).search(episode)).map((x) => x.fileId),
    ).toEqual([1]);
  });
});
