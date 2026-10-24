import { describe, expect, it } from 'vitest';
import { JimakuProvider } from '../src/sources/jimaku/provider';
import type { SubtitleQuery } from '../src/sources/types';
import { silentLogger } from './helpers';

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function fake(routes: (url: URL, init?: RequestInit) => Response | Promise<Response>) {
  const calls: { url: URL; auth: string | undefined }[] = [];
  const f = (async (u: string, init?: RequestInit) => {
    const url = new URL(u);
    calls.push({ url, auth: (init?.headers as Record<string, string> | undefined)?.Authorization });
    return routes(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const provider = (f: typeof fetch, apiKey = 'jk-123456') =>
  new JimakuProvider({ apiKey, logger: silentLogger(), fetchImpl: f });

const query = (over: Partial<SubtitleQuery> = {}): SubtitleQuery => ({
  video: {
    type: 'series',
    idKind: 'imdb',
    externalId: 'tt7441658',
    imdbId: 'tt7441658',
    season: 1,
    episode: 31,
  },
  languages: ['he', 'en'],
  resolveTitles: async () => [{ title: 'Black Clover', episode: 31 }],
  ...over,
});

const entry = (over: Record<string, unknown> = {}) => ({
  id: 7,
  name: 'Black Clover',
  english_name: 'Black Clover',
  japanese_name: 'ブラッククローバー',
  ...over,
});
const file = (name: string, over: Record<string, unknown> = {}) => ({
  name,
  url: `https://jimaku.cc/entry/7/download/${encodeURIComponent(name)}`,
  size: 1000,
  ...over,
});

describe('Jimaku provider', () => {
  it('finds the episode by title and lists its .srt files as Japanese subtitles', async () => {
    const { f, calls } = fake((url) =>
      url.pathname.endsWith('/entries/search')
        ? json([entry(), entry({ id: 8, name: 'Another Show', english_name: 'Another Show' })])
        : json([file('[SubsPlease] Black Clover - 031 (1080p).srt'), file('x.ass')]),
    );
    const found = await provider(f).search(query());
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      language: 'ja',
      provider: 'jimaku',
      hashMatch: false,
      fileName: '[SubsPlease] Black Clover - 031 (1080p).srt',
    });
    expect(found[0]!.fileId).toBeGreaterThan(0);
    expect(calls.every((c) => c.auth === 'jk-123456')).toBe(true);
    expect(calls[0]!.url.searchParams.get('query')).toBe('Black Clover');
    expect(calls[1]!.url.searchParams.get('episode')).toBe('31');
    expect(calls[1]!.url.pathname).toBe('/api/entries/7/files');
  });

  it('drops files of another episode or show, and a bare number for a later season', async () => {
    const files = [
      file('[Grp] Black Clover - 030 (1080p).srt'),
      file('[Grp] Black Clover - 031 (1080p).srt'),
      file('Dragon Ball Kai - E099 [TV].srt'),
    ];
    const { f } = fake((url) =>
      url.pathname.endsWith('/entries/search') ? json([entry()]) : json(files),
    );
    expect((await provider(f).search(query())).map((c) => c.fileName)).toEqual([
      '[Grp] Black Clover - 031 (1080p).srt',
    ]);
    // Season 2 from Stremio: the number 31 could be anything in a straight-through numbering.
    const later = query({
      video: {
        type: 'series',
        idKind: 'imdb',
        externalId: 'tt7441658',
        imdbId: 'tt7441658',
        season: 2,
        episode: 31,
      },
      resolveTitles: async () => [{ title: 'Black Clover', season: 2, episode: 31 }],
    });
    expect(await provider(f).search(later)).toEqual([]);
    // ...unless the name says the season.
    const labelled = fake((url) =>
      url.pathname.endsWith('/entries/search')
        ? json([entry()])
        : json([file('Black Clover S02E31.srt')]),
    );
    expect(await provider(labelled.f).search(later)).toHaveLength(1);
  });

  it('uses the episode number from the file name before the Stremio one', async () => {
    const { f, calls } = fake((url) =>
      url.pathname.endsWith('/entries/search') ? json([entry()]) : json([file('a.srt')]),
    );
    await provider(f).search(
      query({ resolveTitles: async () => [{ title: 'Black Clover', episode: 52 }] }),
    );
    expect(calls[1]!.url.searchParams.get('episode')).toBe('52');
  });

  it('ignores entries whose title does not agree, files that are too big, and foreign hosts', async () => {
    const none = fake(() =>
      json([entry({ name: 'Other', english_name: 'Other', japanese_name: '' })]),
    );
    expect(await provider(none.f).search(query())).toEqual([]);
    const odd = fake((url) =>
      url.pathname.endsWith('/entries/search')
        ? json([entry()])
        : json([
            file('Show - 031 big.srt', { size: 50 * 1024 * 1024 }),
            file('Show - 031 evil.srt', { url: 'https://evil.example/a.srt' }),
            file('Show - 031 ok.srt'),
          ]),
    );
    expect((await provider(odd.f).search(query())).map((c) => c.fileName)).toEqual([
      'Show - 031 ok.srt',
    ]);
  });

  it('finds nothing (and does not throw) without a key, a title, an episode, or on an error answer', async () => {
    const down = fake(() => json({ error: 'slow down' }, 429));
    expect(await provider(down.f).search(query())).toEqual([]);
    expect(await provider(down.f, '').search(query())).toEqual([]);
    expect(await provider(down.f).search(query({ resolveTitles: async () => [] }))).toEqual([]);
    expect(
      await provider(down.f).search(
        query({
          video: { type: 'series', idKind: 'kitsu', externalId: '1' },
          resolveTitles: async () => [{ title: 'Black Clover' }],
        }),
      ),
    ).toEqual([]);
  });

  it('downloads a file with the key, decoding it, and refuses other hosts and big files', async () => {
    const { f, calls } = fake(() => new Response(SRT));
    const p = provider(f);
    const base = {
      fileId: 1,
      language: 'ja',
      fileName: 'a.srt',
      downloadCount: 0,
      rating: 0,
      hashMatch: false,
      hearingImpaired: false,
      machineTranslated: false,
      provider: 'jimaku' as const,
      downloadPath: 'https://jimaku.cc/entry/7/download/a.srt',
    };
    expect((await p.download(base)).content).toBe(SRT);
    expect(calls[0]!.auth).toBe('jk-123456');
    await expect(
      p.download({ ...base, downloadPath: 'https://evil.example/a.srt' }),
    ).rejects.toMatchObject({ code: 'SOURCE_DOWNLOAD_FAILED' });
    const big = fake(
      () => new Response('x', { headers: { 'content-length': String(50 * 1024 * 1024) } }),
    );
    await expect(provider(big.f).download(base)).rejects.toMatchObject({
      code: 'SOURCE_FILE_TOO_LARGE',
    });
    const limited = fake(() => new Response('', { status: 429 }));
    await expect(provider(limited.f).download(base)).rejects.toMatchObject({
      code: 'SOURCE_QUOTA_EXCEEDED',
    });
  });

  it('connection test: accepts a good key, rejects a bad one, reports an unreachable server', async () => {
    expect(await provider(fake(() => json([])).f).testConnection()).toMatchObject({ ok: true });
    expect(await provider(fake(() => json({}, 401)).f).testConnection()).toMatchObject({
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
    expect(await provider(down, '').testConnection()).toMatchObject({
      ok: false,
      code: 'CONFIGURATION_INVALID',
    });
  });
});
