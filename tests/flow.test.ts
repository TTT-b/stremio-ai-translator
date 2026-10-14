import { mkdtempSync, readFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { AppError } from '../src/errors';
import type { SourceSubtitleProvider, SubtitleCandidate } from '../src/sources/types';
import { createApp } from '../src/web/server';
import { FakeProvider, silentLogger } from './helpers';

const SRC = readFileSync('tests/fixtures/sample.srt', 'utf8');

const cand = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
  fileId: 100,
  language: 'en',
  fileName: 'a.srt',
  downloadCount: 10,
  rating: 5,
  hashMatch: false,
  hearingImpaired: false,
  machineTranslated: false,
  ...over,
});

interface Harness {
  base: string;
  host: string;
  get: (path: string, headers?: Record<string, string>) => Promise<Response>;
  searches: number;
  downloads: number;
  translator: FakeProvider;
  dataDir: string;
  close: () => Promise<void>;
  lastSearch?: unknown;
}

async function start(opts: {
  candidates?: SubtitleCandidate[];
  searchError?: AppError;
  content?: string;
  gate?: Promise<void>;
  subWaitMs?: number;
  dataDir?: string;
}): Promise<Harness> {
  const port = await new Promise<number>((resolve) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
  const h: Harness = {
    base: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    searches: 0,
    downloads: 0,
    dataDir: opts.dataDir ?? mkdtempSync(join(tmpdir(), 'flow-')),
    translator: new FakeProvider(async (req) => {
      if (opts.gate) await opts.gate;
      return { translations: req.cues.map((c) => ({ id: c.id, text: `HE:${c.text}` })) };
    }),
    get: (path, headers = {}) => fetch(h.base + path, { headers: { Host: h.host, ...headers } }),
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
  const source: SourceSubtitleProvider = {
    getProviderName: () => 'fake-source',
    testConnection: async () => ({ ok: true, provider: 'fake-source', model: '-', message: 'ok' }),
    search: async (q) => {
      h.searches++;
      h.lastSearch = q;
      if (opts.searchError) throw opts.searchError;
      return opts.candidates ?? [cand()];
    },
    download: async () => {
      h.downloads++;
      return { content: opts.content ?? SRC, fileName: 'a.srt' };
    },
  };
  const app = createApp({
    config: loadConfig({
      PORT: String(port),
      GEMINI_API_KEY: 'k'.repeat(12),
      SUB_WAIT_MS: String(opts.subWaitMs ?? 2000),
      CHUNK_SIZE: '2',
    }),
    logger: silentLogger(),
    settingsPath: join(h.dataDir, 'settings.json'),
    envPath: join(h.dataDir, '.env'),
    dataDir: h.dataDir,
    createProvider: () => h.translator,
    createSourceProvider: () => source,
  });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(port, '127.0.0.1', () => resolve(s));
  });
  return h;
}

interface SubsResponse {
  subtitles: { id: string; url: string; lang: string }[];
}

let current: Harness | undefined;
afterEach(async () => {
  await current?.close();
  current = undefined;
});

describe('Stremio manifest', () => {
  it('declares only subtitles, for movie/series/anime, with tt, kitsu and tmdb prefixes', async () => {
    current = await start({});
    const res = await current.get('/manifest.json');
    const m = await res.json();
    expect(res.status).toBe(200);
    expect(m).toMatchObject({
      resources: ['subtitles'],
      types: ['movie', 'series', 'anime'],
      idPrefixes: ['tt', 'kitsu', 'tmdb'],
    });
    expect(m.id).toBeTruthy();
    expect(JSON.stringify(m)).not.toMatch(/api[-_]?key/i);
  });
});

describe('subtitle request flow', () => {
  it('movie: returns a local URL immediately and then serves the translated SRT', async () => {
    current = await start({});
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const body = (await res.json()) as SubsResponse;
    expect(body.subtitles).toHaveLength(1);
    const sub = body.subtitles[0]!;
    expect(sub.lang).toBe('heb');
    expect(sub.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/sub\/[0-9a-f]{32}\.srt$/);

    const file = await current.get(new URL(sub.url).pathname);
    const srt = await file.text();
    expect(file.headers.get('content-type')).toContain('application/x-subrip');
    expect(srt).toContain('00:00:03,500 --> 00:00:05,250'); // timestamps preserved
    expect(srt).toContain('HE:Hello there.');
    expect(current.translator.calls).toBe(2); // 3 cues, chunk size 2
    expect(current.downloads).toBe(1);
  });

  it('series: searches by season and episode', async () => {
    current = await start({});
    const res = await current.get('/subtitles/series/tt0944947%3A2%3A5.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    await current.get(new URL(sub.url).pathname);
    expect(current.lastSearch).toMatchObject({
      video: { type: 'series', imdbId: 'tt0944947', season: 2, episode: 5 },
    });
  });

  it('passes videoHash from extra to the source search', async () => {
    current = await start({});
    const res = await current.get(
      '/subtitles/movie/tt0111161/videoHash=8e245d9679d31e12&videoSize=1234.json',
    );
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    await current.get(new URL(sub.url).pathname);
    expect(current.lastSearch).toMatchObject({ movieHash: '8e245d9679d31e12' });
  });

  it('existing target-language subtitle is served directly with no translation call', async () => {
    current = await start({
      candidates: [cand({ language: 'en' }), cand({ language: 'he', fileId: 200 })],
    });
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(srt).toContain('Hello there.');
    expect(srt).not.toContain('HE:');
    expect(current.translator.calls).toBe(0);
  });

  it('shows the in-progress placeholder, then the real subtitle once ready', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    current = await start({ gate, subWaitMs: 50 });
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    const path = new URL(sub.url).pathname;

    const first = await (await current.get(path)).text();
    expect(first).toContain('Translation in progress');
    expect(first).toMatch(/^1\n\d\d:\d\d:\d\d,\d{3} --> /); // still a valid SRT

    // A second request while running shares the same job (one translation, not two).
    const again = await (await current.get('/subtitles/movie/tt0111161.json')).json();
    expect((again as SubsResponse).subtitles[0]!.url).toBe(sub.url);

    release();
    let final = '';
    for (let i = 0; i < 40 && !final.includes('HE:'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      final = await (await current.get(path)).text();
    }
    expect(final).toContain('HE:Hello there.');
    expect(current.translator.calls).toBe(2);
  });

  it('replay is served from the cache with no network calls, even after a restart', async () => {
    current = await start({});
    const sub = (
      (await (await current.get('/subtitles/movie/tt0111161.json')).json()) as SubsResponse
    ).subtitles[0]!;
    const path = new URL(sub.url).pathname;
    const first = await (await current.get(path)).text();
    const dataDir = current.dataDir;
    await current.close();

    current = await start({ dataDir });
    // Player fetches the old URL straight away (no subtitles list request first).
    const replay = await (await current.get(path)).text();
    expect(replay).toBe(first);
    expect(current.searches).toBe(0);
    expect(current.downloads).toBe(0);
    expect(current.translator.calls).toBe(0);
  });

  it('same source file is translated only once across different requests', async () => {
    current = await start({});
    const a = (
      (await (await current.get('/subtitles/movie/tt0111161.json')).json()) as SubsResponse
    ).subtitles[0]!;
    await current.get(new URL(a.url).pathname);
    const callsAfterFirst = current.translator.calls;
    const b = (
      (await (
        await current.get('/subtitles/movie/tt0111161/videoHash=8e245d9679d31e12.json')
      ).json()) as SubsResponse
    ).subtitles[0]!;
    expect(b.url).not.toBe(a.url); // different job (hash)
    await current.get(new URL(b.url).pathname);
    expect(current.translator.calls).toBe(callsAfterFirst); // translation cache hit
    expect(current.downloads).toBe(1); // download cache hit
  });

  it('failure becomes a readable placeholder, never a broken file', async () => {
    current = await start({ searchError: new AppError('SOURCE_QUOTA_EXCEEDED') });
    const sub = (
      (await (await current.get('/subtitles/movie/tt0111161.json')).json()) as SubsResponse
    ).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(srt).toContain('Subtitle unavailable');
    expect(srt).toContain('download quota');
  });

  it('no candidates -> SOURCE_SUBTITLE_NOT_FOUND placeholder', async () => {
    current = await start({ candidates: [] });
    const sub = (
      (await (await current.get('/subtitles/movie/tt0111161.json')).json()) as SubsResponse
    ).subtitles[0]!;
    expect(await (await current.get(new URL(sub.url).pathname)).text()).toContain(
      'No suitable source subtitle',
    );
  });

  it('invalid ids return an empty list and unknown /sub ids a placeholder', async () => {
    current = await start({});
    const bad = await current.get('/subtitles/movie/yt%3Aabc.json');
    expect(await bad.json()).toMatchObject({ subtitles: [] });
    const unknown = await current.get(`/sub/${'0'.repeat(32)}.srt`);
    expect(unknown.status).toBe(200);
    expect(await unknown.text()).toContain('Unknown subtitle');
    expect((await current.get('/sub/not-an-id.srt')).status).toBe(200);
  });

  it('rejects add-on routes from unknown browser origins but allows Stremio ones', async () => {
    current = await start({});
    // fetch() cannot set Origin reliably, so use a raw request.
    const status = (origin: string) =>
      new Promise<number>((resolve, reject) => {
        const u = new URL(current!.base);
        const req = httpRequest(
          {
            host: u.hostname,
            port: u.port,
            path: '/subtitles/movie/tt0111161.json',
            headers: { Host: current!.host, Origin: origin },
          },
          (r) => {
            r.resume();
            resolve(r.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await status('https://evil.example')).toBe(403);
    expect(current.searches).toBe(0);
    expect(await status('https://app.strem.io')).toBe(200);
  });
});
