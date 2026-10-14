import iconv from 'iconv-lite';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { updateEnvFile } from '../src/config/envFile';
import { decodeSubtitleBytes } from '../src/sources/opensubtitles/decode';
import {
  isAllowedDownloadUrl,
  MAX_SUBTITLE_BYTES,
  OpenSubtitlesProvider,
} from '../src/sources/opensubtitles/provider';
import { selectSubtitle } from '../src/sources/select';
import { parseVideoId, type SubtitleCandidate } from '../src/sources/types';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { silentLogger } from './helpers';

const creds = { apiKey: 'API-KEY-1', username: 'user', password: 'pw', userAgent: 'T v1' };

interface Call {
  url: string;
  init: RequestInit;
}

/** Fake fetch routed by URL; records calls. */
function fakeFetch(routes: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return routes(url, init);
  }) as unknown as typeof fetch;
  return { f, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const provider = (f: typeof fetch, now?: () => number) =>
  new OpenSubtitlesProvider({
    credentials: creds,
    logger: silentLogger(),
    fetchImpl: f,
    ...(now ? { now } : {}),
  });

const cand = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
  fileId: 1,
  language: 'en',
  fileName: 'a.srt',
  downloadCount: 0,
  rating: 0,
  hashMatch: false,
  hearingImpaired: false,
  machineTranslated: false,
  ...over,
});

describe('parseVideoId', () => {
  it('parses movies and episodes', () => {
    expect(parseVideoId('movie', 'tt0111161')).toEqual({ type: 'movie', imdbId: 'tt0111161' });
    expect(parseVideoId('series', 'tt0944947:2:5')).toEqual({
      type: 'series',
      imdbId: 'tt0944947',
      season: 2,
      episode: 5,
    });
  });
  it('rejects bad input', () => {
    expect(() => parseVideoId('movie', 'kitsu:1')).toThrow(AppError);
    expect(() => parseVideoId('series', 'tt0944947')).toThrow(AppError);
    expect(() => parseVideoId('tv', 'tt0944947')).toThrow(AppError);
  });
});

describe('selectSubtitle', () => {
  it('serves a target-language subtitle directly', () => {
    const s = selectSubtitle(
      [cand({ language: 'en', downloadCount: 999 }), cand({ language: 'he', fileId: 2 })],
      'he',
    );
    expect(s).toMatchObject({ kind: 'direct', candidate: { fileId: 2 } });
  });
  it('prefers hash match, then human-made, then popularity, among English', () => {
    const s = selectSubtitle(
      [
        cand({ fileId: 1, downloadCount: 9000 }),
        cand({ fileId: 2, hashMatch: true }),
        cand({ fileId: 3, machineTranslated: true, hashMatch: false, downloadCount: 9999 }),
      ],
      'he',
    );
    expect(s).toMatchObject({ kind: 'translate', candidate: { fileId: 2 } });
    const s2 = selectSubtitle(
      [cand({ fileId: 1, machineTranslated: true, downloadCount: 5000 }), cand({ fileId: 2 })],
      'he',
    );
    expect(s2).toMatchObject({ candidate: { fileId: 2 } });
  });
  it('falls back to another language, then none', () => {
    expect(selectSubtitle([cand({ language: 'fr', fileId: 4 })], 'he')).toMatchObject({
      kind: 'translate',
      candidate: { fileId: 4 },
    });
    expect(selectSubtitle([], 'he')).toEqual({ kind: 'none' });
  });
});

describe('isAllowedDownloadUrl', () => {
  it('allows only https opensubtitles hosts', () => {
    expect(isAllowedDownloadUrl('https://dl.opensubtitles.com/en/download/x')).toBe(true);
    expect(isAllowedDownloadUrl('https://www.opensubtitles.org/x')).toBe(true);
    expect(isAllowedDownloadUrl('http://dl.opensubtitles.com/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://evil.example/opensubtitles.com')).toBe(false);
    expect(isAllowedDownloadUrl('https://opensubtitles.com.evil.example/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://user:pw@dl.opensubtitles.com/x')).toBe(false);
    expect(isAllowedDownloadUrl('not a url')).toBe(false);
  });
});

describe('decodeSubtitleBytes', () => {
  it('handles UTF-8 BOM, UTF-16 and windows-1255 Hebrew', () => {
    const text = '1\n00:00:01,000 --> 00:00:02,000\nשלום עולם, מה שלומך היום?\n';
    expect(
      decodeSubtitleBytes(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text)])),
    ).toBe(text);
    expect(
      decodeSubtitleBytes(
        Buffer.concat([Buffer.from([0xff, 0xfe]), iconv.encode(text, 'utf16-le')]),
      ),
    ).toBe(text);
    expect(decodeSubtitleBytes(iconv.encode(text, 'windows-1255'))).toBe(text);
  });
});

describe('OpenSubtitlesProvider', () => {
  const searchBody = {
    data: [
      {
        attributes: {
          language: 'en',
          download_count: 10,
          ratings: 7,
          moviehash_match: true,
          files: [{ file_id: 42, file_name: 'x.srt' }],
        },
      },
      { attributes: { language: 'he', files: [] } }, // no file -> skipped
    ],
  };

  it('searches movies by IMDb id with sorted lowercase params and required headers', async () => {
    const { f, calls } = fakeFetch(() => json(searchBody));
    const out = await provider(f).search({
      video: { type: 'movie', imdbId: 'tt0111161' },
      languages: ['he', 'en'],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ fileId: 42, language: 'en', hashMatch: true });
    const url = new URL(calls[0]?.url as string);
    expect(url.pathname).toBe('/api/v1/subtitles');
    expect([...url.searchParams.keys()]).toEqual(['imdb_id', 'languages', 'type']);
    expect(url.searchParams.get('imdb_id')).toBe('0111161');
    expect(url.searchParams.get('languages')).toBe('en,he');
    const h = new Headers(calls[0]?.init.headers);
    expect(h.get('api-key')).toBe('API-KEY-1');
    expect(h.get('user-agent')).toBe('T v1');
  });

  it('searches episodes via parent_imdb_id + season/episode', async () => {
    const { f, calls } = fakeFetch(() => json(searchBody));
    await provider(f).search({
      video: { type: 'series', imdbId: 'tt0944947', season: 2, episode: 5 },
      languages: ['en'],
    });
    const url = new URL(calls[0]?.url as string);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      episode_number: '5',
      languages: 'en',
      parent_imdb_id: '0944947',
      season_number: '2',
      type: 'episode',
    });
  });

  it('tries moviehash first and skips the IMDb search when a hash matches', async () => {
    const { f, calls } = fakeFetch(() => json(searchBody));
    await provider(f).search({
      video: { type: 'movie', imdbId: 'tt0111161' },
      languages: ['en'],
      movieHash: '8e245d9679d31e12',
    });
    expect(calls).toHaveLength(1);
    expect(new URL(calls[0]?.url as string).searchParams.get('moviehash')).toBe('8e245d9679d31e12');
  });

  it('falls back to IMDb, then to any language when nothing is found', async () => {
    const { f, calls } = fakeFetch(() => json({ data: [] }));
    const out = await provider(f).search({
      video: { type: 'movie', imdbId: 'tt0111161' },
      languages: ['he', 'en'],
      movieHash: '8e245d9679d31e12',
    });
    expect(out).toEqual([]);
    expect(calls).toHaveLength(3);
    expect(new URL(calls[2]?.url as string).searchParams.has('languages')).toBe(false);
  });

  it('maps HTTP errors to normalized codes', async () => {
    const q = { video: { type: 'movie' as const, imdbId: 'tt0111161' }, languages: ['en'] };
    await expect(provider(fakeFetch(() => json({}, 403)).f).search(q)).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
    await expect(provider(fakeFetch(() => json({}, 429)).f).search(q)).rejects.toMatchObject({
      code: 'SOURCE_QUOTA_EXCEEDED',
    });
  });

  it('downloads: logs in once, reuses the token, decodes the file', async () => {
    const srt = Buffer.from('1\n00:00:01,000 --> 00:00:02,000\nHello\n');
    const { f, calls } = fakeFetch((url) => {
      if (url.endsWith('/login')) return json({ token: 'TOKEN-1' });
      if (url.endsWith('/download')) {
        return json({
          link: 'https://dl.opensubtitles.com/file/1',
          file_name: 'a.srt',
          remaining: 17,
        });
      }
      return new Response(srt, { status: 200 });
    });
    const p = provider(f);
    const a = await p.download(cand({ fileId: 5 }));
    const b = await p.download(cand({ fileId: 6 }));
    expect(a).toMatchObject({ content: srt.toString(), remaining: 17 });
    expect(b.content).toBe(srt.toString());
    expect(calls.filter((c) => c.url.endsWith('/login'))).toHaveLength(1);
    const dl = calls.find((c) => c.url.endsWith('/download'));
    expect(new Headers(dl?.init.headers).get('authorization')).toBe('Bearer TOKEN-1');
    expect(JSON.parse(dl?.init.body as string)).toEqual({ file_id: 5, sub_format: 'srt' });
  });

  it('re-logs in when the token is rejected (401)', async () => {
    let logins = 0;
    let downloads = 0;
    const { f } = fakeFetch((url) => {
      if (url.endsWith('/login')) return json({ token: `T${++logins}` });
      if (url.endsWith('/download')) {
        return ++downloads === 1 ? json({}, 401) : json({ link: 'https://dl.opensubtitles.com/f' });
      }
      return new Response('1\n00:00:01,000 --> 00:00:02,000\nHi\n');
    });
    const r = await provider(f).download(cand());
    expect(r.content).toContain('Hi');
    expect(logins).toBe(2);
  });

  it('surfaces quota and auth failures', async () => {
    const quota = fakeFetch((url) =>
      url.endsWith('/login') ? json({ token: 't' }) : json({}, 406),
    );
    await expect(provider(quota.f).download(cand())).rejects.toMatchObject({
      code: 'SOURCE_QUOTA_EXCEEDED',
    });
    const auth = fakeFetch(() => json({}, 401));
    await expect(provider(auth.f).download(cand())).rejects.toMatchObject({
      code: 'SOURCE_AUTH_FAILED',
    });
  });

  it('refuses links outside the allow-list and never fetches them', async () => {
    const { f, calls } = fakeFetch((url) =>
      url.endsWith('/login')
        ? json({ token: 't' })
        : json({ link: 'https://evil.example/steal.srt' }),
    );
    await expect(provider(f).download(cand())).rejects.toMatchObject({
      code: 'SOURCE_DOWNLOAD_FAILED',
    });
    expect(calls.some((c) => c.url.includes('evil.example'))).toBe(false);
  });

  it('rejects files over the size limit (declared and streamed)', async () => {
    const link = json({ link: 'https://dl.opensubtitles.com/big' });
    const declared = fakeFetch((url) =>
      url.endsWith('/login')
        ? json({ token: 't' })
        : url.endsWith('/download')
          ? link.clone()
          : new Response('x', { headers: { 'content-length': String(MAX_SUBTITLE_BYTES + 1) } }),
    );
    await expect(provider(declared.f).download(cand())).rejects.toMatchObject({
      code: 'SOURCE_FILE_TOO_LARGE',
    });
    const streamed = fakeFetch((url) =>
      url.endsWith('/login')
        ? json({ token: 't' })
        : url.endsWith('/download')
          ? json({ link: 'https://dl.opensubtitles.com/big' })
          : new Response(Buffer.alloc(MAX_SUBTITLE_BYTES + 10, 65)),
    );
    await expect(provider(streamed.f).download(cand())).rejects.toMatchObject({
      code: 'SOURCE_FILE_TOO_LARGE',
    });
  });

  it('rejects zip archives', async () => {
    const { f } = fakeFetch((url) =>
      url.endsWith('/login')
        ? json({ token: 't' })
        : url.endsWith('/download')
          ? json({ link: 'https://dl.opensubtitles.com/z' })
          : new Response(Buffer.from([0x50, 0x4b, 3, 4])),
    );
    await expect(provider(f).download(cand())).rejects.toMatchObject({
      code: 'UNSUPPORTED_SUBTITLE_FORMAT',
    });
  });

  it('reports missing credentials by variable name', async () => {
    const p = new OpenSubtitlesProvider({
      credentials: { ...creds, apiKey: '', password: '' },
      logger: silentLogger(),
      fetchImpl: fakeFetch(() => json({})).f,
    });
    const r = await p.testConnection();
    expect(r).toMatchObject({ ok: false, code: 'CONFIGURATION_INVALID' });
    expect(r.message).toContain('OPENSUBTITLES_API_KEY');
    expect(r.message).toContain('OPENSUBTITLES_PASSWORD');
  });
});

describe('updateEnvFile', () => {
  it('replaces and appends keys, keeping comments and line endings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'envf-'));
    const path = join(dir, '.env');
    writeFileSync(path, '# c\r\nA=1\r\nB=2\r\n', 'utf8');
    updateEnvFile(path, { A: 'x', C: 'has space' });
    const out = readFileSync(path, 'utf8');
    expect(out).toBe("# c\r\nA=x\r\nB=2\r\nC='has space'\r\n");
  });

  it('creates the file and rejects line breaks', () => {
    const dir = mkdtempSync(join(tmpdir(), 'envf-'));
    const path = join(dir, '.env');
    updateEnvFile(path, { K: 'v' });
    expect(readFileSync(path, 'utf8')).toBe('K=v\n');
    expect(() => updateEnvFile(path, { K: 'a\nINJECT=1' })).toThrow(AppError);
  });
});
