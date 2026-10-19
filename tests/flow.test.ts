import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer, request as httpRequest, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cacheKey, FileCache } from '../src/cache/fileCache';
import { loadConfig } from '../src/config/env';
import { jobIdFor } from '../src/jobs/manager';
import { AppError } from '../src/errors';
import {
  parseVideoId,
  type SourceSubtitleProvider,
  type SubtitleCandidate,
} from '../src/sources/types';
import { createApp } from '../src/web/server';
import { createHash } from 'node:crypto';
import { SyncService } from '../src/sync/service';
import { FakeProvider, makeZip, silentLogger } from './helpers';

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
  contentFor?: (c: SubtitleCandidate) => string;
  loadEmbedded?: NonNullable<Parameters<typeof createApp>[0]['loadEmbedded']>;
  refreshGuessAfterMs?: number;
  cancelCooldownMs?: number;
  limits?: NonNullable<Parameters<typeof createApp>[0]['limits']>;
  logDir?: string;
  /** The search for a subtitle never answers. */
  searchHangs?: boolean;
  sync?: NonNullable<Parameters<typeof createApp>[0]['sync']>;
  findStream?: NonNullable<Parameters<typeof createApp>[0]['findStream']>;
  speechFit?: NonNullable<Parameters<typeof createApp>[0]['speechFit']>;
  settings?: object;
  onPending?: NonNullable<Parameters<typeof createApp>[0]['onPending']>;
  gate?: Promise<void>;
  subWaitMs?: number;
  dataDir?: string;
  /** A download of this candidate fails with the returned error. */
  downloadError?: (c: SubtitleCandidate) => AppError | undefined;
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
      if (opts.searchHangs) await new Promise<never>(() => undefined);
      return opts.candidates ?? [cand()];
    },
    download: async (c) => {
      const failure = opts.downloadError?.(c);
      if (failure) throw failure;
      h.downloads++;
      return { content: opts.contentFor?.(c) ?? opts.content ?? SRC, fileName: 'a.srt' };
    },
  };
  if (opts.settings) writeFileSync(join(h.dataDir, 'settings.json'), JSON.stringify(opts.settings));
  const app = createApp({
    config: loadConfig({
      PORT: String(port),
      GEMINI_API_KEY: 'k'.repeat(12),
      SUB_WAIT_MS: String(opts.subWaitMs ?? 2000),
      CHUNK_SIZE: '2',
      CHUNK_DELAY_MS: '0',
    }),
    logger: silentLogger(),
    settingsPath: join(h.dataDir, 'settings.json'),
    envPath: join(h.dataDir, '.env'),
    dataDir: h.dataDir,
    createProvider: () => h.translator,
    createSourceProvider: () => source,
    // Never look for a real ffmpeg or Stremio server in tests: embedded subtitles are off unless a test supplies them.
    loadEmbedded: opts.loadEmbedded ?? (async () => undefined),
    // Tests never listen to a real video unless one supplies speechFit.
    speechFit: opts.speechFit ?? (async () => undefined),
    ...(opts.speechFit && !opts.sync
      ? { findStream: opts.findStream ?? (async () => undefined), ffmpegFor: () => 'ffmpeg.exe' }
      : {}),
    ...(opts.sync
      ? {
          sync: opts.sync,
          findStream: opts.findStream ?? (async () => undefined),
          ffmpegFor: () => 'ffmpeg.exe',
        }
      : {}),
    ...(opts.limits ? { limits: opts.limits } : {}),
    ...(opts.onPending ? { onPending: opts.onPending } : {}),
    ...(opts.logDir ? { logDir: opts.logDir } : {}),
    ...(opts.cancelCooldownMs !== undefined ? { cancelCooldownMs: opts.cancelCooldownMs } : {}),
    ...(opts.refreshGuessAfterMs !== undefined
      ? { refreshGuessAfterMs: opts.refreshGuessAfterMs }
      : {}),
    // Title lookups never reach the real network in tests.
    fetchImpl: (async () =>
      new Response(JSON.stringify({ meta: { name: 'Test Show' } }), {
        status: 200,
      })) as typeof fetch,
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

  it('two requests for the same subtitle with different ids share one translation', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    current = await start({ gate, subWaitMs: 50 });
    const urls: string[] = [];
    for (const hash of ['8e245d9679d31e12', '1111111111111111']) {
      const res = await current.get(`/subtitles/movie/tt0111161/videoHash=${hash}.json`);
      urls.push(((await res.json()) as SubsResponse).subtitles[0]!.url);
    }
    expect(urls[0]).not.toBe(urls[1]); // two different job ids
    release();
    for (const url of urls) {
      let text = '';
      for (let i = 0; i < 40 && !text.includes('HE:'); i++) {
        await new Promise((r) => setTimeout(r, 25));
        text = await (await current.get(new URL(url).pathname)).text();
      }
      expect(text).toContain('HE:Hello there.');
    }
    expect(current.translator.calls).toBe(2); // 3 cues, chunk size 2: paid once, not twice
    // The main screen must show a finished job as 100%, whichever of the two ids it picks.
    const status = (await (await current.get('/api/status')).json()) as {
      progress: { done: number; total: number; percent: number } | null;
      linesTranslated: number;
      bytesTranslated: number;
    };
    expect(status.progress).toMatchObject({ done: 3, total: 3, percent: 100 });
    expect(status.linesTranslated).toBe(3); // counted once, not once per request
    expect(status.bytesTranslated).toBeGreaterThan(50);
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

describe('timing consensus', () => {
  const shift = (srt: string) =>
    srt
      .replace('00:00:01,000 --> 00:00:03,000', '00:00:21,000 --> 00:00:23,000')
      .replace('00:00:03,500 --> 00:00:05,250', '00:00:23,500 --> 00:00:25,250')
      .replace('00:01:02,040 --> 00:01:04,000', '00:01:22,040 --> 00:01:24,000');

  it('without a hash match, downloads only one file while the daily quota is unknown', async () => {
    current = await start({
      candidates: [
        cand({ fileId: 1, downloadCount: 9000 }),
        cand({ fileId: 2, downloadCount: 500 }),
        cand({ fileId: 3, downloadCount: 400 }),
        cand({ fileId: 4, downloadCount: 300 }),
      ],
      contentFor: (c) => (c.fileId === 1 ? shift(SRC) : SRC),
    });
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    await current.get(new URL(sub.url).pathname);
    expect(current.downloads).toBe(1);
  });

  it('with a hash match, uses that file and downloads nothing else', async () => {
    current = await start({
      candidates: [
        cand({ fileId: 1, downloadCount: 1, hashMatch: true }),
        cand({ fileId: 2, downloadCount: 500 }),
        cand({ fileId: 3, downloadCount: 400 }),
        cand({ fileId: 4, downloadCount: 300 }),
      ],
    });
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    await current.get(new URL(sub.url).pathname);
    expect(current.downloads).toBe(1);
  });
});

describe('subtitle library', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const post = (h: Harness, path: string, body: unknown) =>
    fetch(h.base + path, {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  interface LibResponse {
    items: { id: string; title: string; season?: number; episode?: number; keys?: unknown }[];
  }

  it('lists a translated subtitle by title and season, and deletes it so it is translated again', async () => {
    current = await start({});
    const res = await current.get('/subtitles/series/tt0944947%3A2%3A5.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    await current.get(new URL(sub.url).pathname);

    let lib: LibResponse = { items: [] };
    for (let i = 0; i < 30 && lib.items.length === 0; i++) {
      lib = (await (await current.get('/api/library')).json()) as LibResponse;
      if (lib.items.length === 0) await sleep(20);
    }
    expect(lib.items).toHaveLength(1);
    expect(lib.items[0]).toMatchObject({
      title: 'Test Show',
      season: 2,
      episode: 5,
      timing: 'estimated', // an OpenSubtitles pick without a hash match is only a guess
    });
    expect(lib.items[0]).not.toHaveProperty('keys'); // cache keys stay on the server
    expect(current.translator.calls).toBe(2);

    const del = await post(current, '/api/library/delete', { ids: [lib.items[0]!.id] });
    expect(await del.json()).toMatchObject({ ok: true, removed: 1 });
    const after = (await (await current.get('/api/library')).json()) as LibResponse;
    expect(after.items).toHaveLength(0);

    // The same URL works again and translates again (the source download is still cached).
    const again = await current.get(new URL(sub.url).pathname);
    expect(await again.text()).toContain('HE:Hello there.');
    expect(current.translator.calls).toBe(4);
    expect(current.downloads).toBe(1);
  });

  it('rejects malformed delete requests', async () => {
    current = await start({});
    for (const body of [{}, { ids: ['nope'] }, { all: false }, { ids: [], extra: 1 }]) {
      const r = await post(current, '/api/library/delete', body);
      expect(r.status).toBe(400);
    }
  });
});

describe('embedded subtitles', () => {
  const post = (h: Harness, path: string, body: unknown) =>
    fetch(h.base + path, {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const subUrl = async (h: Harness, path: string) => {
    const res = await h.get(path);
    return new URL(((await res.json()) as SubsResponse).subtitles[0]!.url).pathname;
  };
  const embedded = {
    raw: SRT_FOR_EMBEDDED(),
    language: 'en',
    cues: 3,
    streamIndex: 2,
  };

  it('uses the subtitle inside the playing file: no OpenSubtitles download, still translated', async () => {
    let asked: unknown;
    current = await start({
      loadEmbedded: async (q) => {
        asked = q;
        return embedded;
      },
    });
    const path = await subUrl(
      current,
      '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json',
    );
    const srt = await (await current.get(path)).text();
    expect(asked).toMatchObject({ filename: 'Movie.2020.1080p.mkv', targetLanguage: 'he' });
    expect(current.downloads).toBe(0);
    expect(srt).toContain('HE:Hello there.');
    expect(srt).toContain('00:00:03,500 --> 00:00:05,250');
  });

  it('serves an embedded track in the target language as is, with no translation', async () => {
    current = await start({ loadEmbedded: async () => ({ ...embedded, language: 'he' }) });
    const path = await subUrl(
      current,
      '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json',
    );
    const srt = await (await current.get(path)).text();
    expect(srt).toContain('Hello there.');
    expect(srt).not.toContain('HE:');
    expect(current.translator.calls).toBe(0);
    expect(current.downloads).toBe(0);
  });

  it('falls back to OpenSubtitles when there is no embedded track or the setting is off', async () => {
    current = await start({ loadEmbedded: async () => undefined });
    const path = await subUrl(
      current,
      '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json',
    );
    await current.get(path);
    expect(current.downloads).toBe(1);

    await current.close();
    current = await start({ loadEmbedded: async () => embedded });
    await post(current, '/api/settings', { embeddedSubtitles: false });
    const path2 = await subUrl(current, '/subtitles/movie/tt0111161/filename=Other.2021.mkv.json');
    await current.get(path2);
    expect(current.downloads).toBe(1);
  });
});

function SRT_FOR_EMBEDDED(): string {
  return SRC;
}

describe('source rules version', () => {
  it('does not replay a subtitle that was cached under older source rules', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'flow-'));
    const model = loadConfig({ GEMINI_API_KEY: 'k'.repeat(12) }).aiModel;
    const id = jobIdFor({ video: parseVideoId('movie', 'tt0111161'), targetLanguage: 'he' }, model);
    // How the whole-job entry was keyed before the version existed.
    new FileCache(join(dataDir, 'cache'), 1e12, silentLogger()).set(
      cacheKey({ job: id, rtl: true, kind: 'job' }),
      'translation',
      'OLD CACHED SUBTITLE',
      1,
    );
    current = await start({ dataDir });
    const res = await current.get('/subtitles/movie/tt0111161.json');
    const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
    expect(sub.url).toContain(id);
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(srt).not.toContain('OLD CACHED SUBTITLE');
    expect(srt).toContain('HE:Hello there.');
  });
});

describe('guessed timing is checked again', () => {
  const FILE_PATH = '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json';
  const own = SRC.replace('00:00:01,000 --> 00:00:03,000', '00:00:21,000 --> 00:00:23,000');
  const embedded = { raw: own, language: 'en', cues: 3, streamIndex: 2 };
  const subPath = async (h: Harness) =>
    new URL(((await (await h.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!.url).pathname;

  it('switches to the video own subtitle once it is available', async () => {
    let calls = 0;
    current = await start({
      refreshGuessAfterMs: 0,
      loadEmbedded: async () => (++calls === 1 ? undefined : embedded),
    });
    const first = await (await current.get(await subPath(current))).text();
    expect(first).toContain('00:00:01,000 --> 00:00:03,000'); // OpenSubtitles fallback
    expect(current.downloads).toBe(1);

    const second = await (await current.get(await subPath(current))).text(); // Stremio asks again
    expect(second).toContain('00:00:21,000 --> 00:00:23,000'); // the video own subtitle
    expect(second).toContain('HE:Hello there.');
  });

  it('does not replay a guessed subtitle as exact after a restart', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'flow-'));
    current = await start({ dataDir });
    await (await current.get(await subPath(current))).text();
    await current.close();

    current = await start({ dataDir, loadEmbedded: async () => embedded });
    const again = await (await current.get(await subPath(current))).text();
    expect(again).toContain('00:00:21,000 --> 00:00:23,000');
  });

  it('keeps the guessed subtitle while the video own one is still missing', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'flow-'));
    current = await start({ dataDir });
    await (await current.get(await subPath(current))).text();
    await current.close();

    current = await start({ dataDir });
    const again = await (await current.get(await subPath(current))).text();
    expect(again).toContain('00:00:01,000 --> 00:00:03,000');
    expect(current.downloads).toBe(0); // served from the saved fallback, nothing downloaded again
  });
});

describe('news bell', () => {
  const post = (h: Harness, path: string, body: unknown) =>
    fetch(h.base + path, {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  interface NewsResponse {
    ok: boolean;
    online: boolean;
    items: unknown[];
    seen: string[];
    releases: { version: string; notes: { he: string[]; en: string[] } }[];
  }

  it('lists the release notes of every version, newest first, in both languages', async () => {
    current = await start({});
    const r = (await (await current.get('/api/news')).json()) as NewsResponse;
    expect(r.ok).toBe(true);
    expect(r.online).toBe(false); // the test fetch does not return a news file
    expect(r.items).toEqual([]);
    const versions = r.releases.map((x) => x.version);
    expect(versions[0]).toBe(JSON.parse(readFileSync('package.json', 'utf8')).version);
    expect(versions).toContain('1.4.5');
    for (const x of r.releases) {
      expect(x.notes.he.length).toBe(x.notes.en.length);
      expect(x.notes.he.length).toBeGreaterThan(0);
    }
  });

  it('remembers which messages were opened, and rejects bad ids', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'flow-'));
    current = await start({ dataDir });
    expect(
      await (await post(current, '/api/news/seen', { ids: ['release-1.4.8', 'a-b_c.1'] })).json(),
    ).toEqual({ ok: true });
    for (const body of [{}, { ids: 'x' }, { ids: ['<script>'] }, { ids: [1] }]) {
      expect((await post(current, '/api/news/seen', body)).status).toBe(400);
    }
    await current.close();
    current = await start({ dataDir });
    const r = (await (await current.get('/api/news')).json()) as NewsResponse;
    expect(r.seen.sort()).toEqual(['a-b_c.1', 'release-1.4.8']);
  });
});

describe('a stuck step never blocks the queue', () => {
  const FILE_PATH = '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json';
  const hang = () => new Promise<never>(() => undefined);
  const subPath = async (h: Harness, path = FILE_PATH) =>
    new URL(((await (await h.get(path)).json()) as SubsResponse).subtitles[0]!.url).pathname;

  it('carries on with OpenSubtitles when the lookup inside the video never answers', async () => {
    current = await start({ loadEmbedded: hang, limits: { embeddedCapMs: 150 } });
    const srt = await (await current.get(await subPath(current))).text();
    expect(srt).toContain('HE:Hello there.');
    expect(current.downloads).toBe(1);
  });

  it('says which step a running job is in', async () => {
    let release: (v: undefined) => void = () => undefined;
    const gate = new Promise<undefined>((r) => {
      release = r;
    });
    current = await start({ loadEmbedded: () => gate });
    const url = await subPath(current);
    const status = async () =>
      (await (await current!.get('/api/status')).json()) as { state: string; stage: string | null };
    for (let i = 0; i < 40 && (await status()).stage !== 'local'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(await status()).toMatchObject({ state: 'translating', stage: 'local' });
    release(undefined);
    await (await current.get(url)).text();
    for (let i = 0; i < 40 && (await status()).state === 'translating'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect((await status()).stage).toBeNull();
  });

  it('fails a search that never answers, and the next requests still run', async () => {
    current = await start({ searchHangs: true, limits: { sourceCapMs: 150 }, subWaitMs: 3000 });
    for (const id of ['tt0111161', 'tt0068646', 'tt0071562', 'tt0468569']) {
      const res = await current.get(`/subtitles/movie/${id}.json`);
      const sub = ((await res.json()) as SubsResponse).subtitles[0]!;
      const srt = await (await current.get(new URL(sub.url).pathname)).text();
      expect(srt).toContain('Subtitle unavailable');
    }
  });

  it('uses the second provider when OpenSubtitles has no downloads left', async () => {
    current = await start({
      candidates: [
        cand({ fileId: 1, downloadCount: 9000 }),
        cand({ fileId: 2, provider: 'subdl', downloadCount: 0, downloadPath: '/subtitle/1-2.zip' }),
      ],
      downloadError: (c) =>
        c.provider === 'subdl' ? undefined : new AppError('SOURCE_QUOTA_EXCEEDED'),
    });
    const srt = await (
      await current.get(await subPath(current, '/subtitles/movie/tt0111161.json'))
    ).text();
    expect(srt).toContain('HE:');
    expect(current.downloads).toBe(1);
  });

  it('still fails with the quota error when there is no second provider file', async () => {
    current = await start({
      candidates: [cand({ fileId: 1 })],
      downloadError: () => new AppError('SOURCE_QUOTA_EXCEEDED'),
    });
    const srt = await (
      await current.get(await subPath(current, '/subtitles/movie/tt0111161.json'))
    ).text();
    expect(srt).toContain('Subtitle unavailable');
  });

  it('tells the main screen why the last job failed', async () => {
    current = await start({ searchError: new AppError('SOURCE_QUOTA_EXCEEDED') });
    const srt = await (
      await current.get(await subPath(current, '/subtitles/movie/tt0111161.json'))
    ).text();
    expect(srt).toContain('Subtitle unavailable');
    const status = (await (await current.get('/api/status')).json()) as {
      state: string;
      lastError: string | null;
    };
    expect(status).toMatchObject({ state: 'error', lastError: 'SOURCE_QUOTA_EXCEEDED' });
  });

  it('fails a job that is stuck in translation after the overall limit', async () => {
    current = await start({ gate: hang(), limits: { jobCapMs: 200 }, subWaitMs: 3000 });
    const srt = await (
      await current.get(await subPath(current, '/subtitles/movie/tt0111161.json'))
    ).text();
    expect(srt).toContain('Subtitle unavailable');
  });
});

describe('diagnostics', () => {
  it('summarises the setup and recent events without keys or subtitle text', async () => {
    const logDir = mkdtempSync(join(tmpdir(), 'logs-'));
    const line = (o: object) => JSON.stringify(o);
    writeFileSync(
      join(logDir, 'app-2026-10-18.log'),
      [
        line({
          level: 30,
          time: 1792334555000,
          stage: 'SOURCE',
          embedded: 'not-local',
          waitedMs: 8000,
          msg: 'embedded subtitles skipped',
          jobId: '4293b63d',
          text: 'SECRET DIALOGUE',
        }),
        line({
          level: 30,
          time: 1792334556000,
          stage: 'CHUNK',
          msg: 'noise',
          text: 'SECRET DIALOGUE',
        }),
        line({ level: 40, time: 1792334557000, msg: 'something odd', apiKey: 'kkkkkkkkkkkk' }),
        'not json',
      ].join('\n'),
    );
    current = await start({ logDir });
    const text = await (await current.get('/api/diagnostics')).text();
    expect(text).toContain('version: ');
    expect(text).toContain('embedded=not-local');
    expect(text).toContain('waitedMs=8000');
    expect(text).toContain('something odd');
    expect(text).not.toContain('SECRET DIALOGUE');
    expect(text).not.toContain('kkkkkkkkkkkk');
    expect(text).not.toContain('noise');
  });

  it('does not copy the titles of what the user watches', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    await current.get('/subtitles/series/tt0944947%3A1%3A1.json');
    // The page's status shows the title once it is known; the diagnostics must not.
    for (let i = 0; i < 60; i++) {
      const status = (await (await current.get('/api/status')).json()) as {
        queue: { title: string }[];
      };
      if (status.queue[0]?.title === 'Test Show') break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const text = await (await current.get('/api/diagnostics')).text();
    expect(text).not.toContain('Test Show');
    expect(text).toContain('"queue":1');
  });
});

describe('timing from the sound of the video', () => {
  const FILE_PATH = '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json';
  const stream = {
    infoHash: 'a'.repeat(40),
    fileIdx: 0,
    url: 'http://127.0.0.1:11470/x/0',
    videoPath: 'Movie.2020.1080p.mkv',
    files: [],
  };
  const served = async (srt: string) => {
    const sub = ((await (await current!.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    return (await current!.get(new URL(sub.url).pathname)).text().then((s) => ({ s, srt }));
  };

  it('moves a guessed subtitle by what the fit says, and calls it speech timing', async () => {
    let asked = 0;
    current = await start({
      findStream: async () => stream,
      speechFit: async (o) => {
        asked++;
        expect(o.url).toBe(stream.url);
        return { scale: 1, offsetMs: 2000, score: 0.2, baseline: 0 };
      },
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const { s } = await served('');
    expect(asked).toBe(1);
    expect(s).toContain('HE:');
    let lib: { items: { timing?: string }[] } = { items: [] };
    for (let i = 0; i < 40 && lib.items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      lib = (await (await current.get('/api/library')).json()) as typeof lib;
    }
    expect(lib.items[0]?.timing).toBe('speech');
  });

  it('keeps the subtitle as it was when the fit is not sure', async () => {
    current = await start({
      findStream: async () => stream,
      speechFit: async () => undefined,
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    await served('');
    let lib: { items: { timing?: string }[] } = { items: [] };
    for (let i = 0; i < 40 && lib.items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      lib = (await (await current.get('/api/library')).json()) as typeof lib;
    }
    expect(lib.items[0]?.timing).toBe('estimated');
  });

  it('keeps the subtitle as it was when the fit fails', async () => {
    current = await start({
      findStream: async () => stream,
      speechFit: async () => {
        throw new Error('ffmpeg exploded');
      },
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const { s } = await served('');
    expect(s).toContain('HE:');
  });

  it('does not listen when the video is not on this computer', async () => {
    let asked = 0;
    current = await start({
      findStream: async () => undefined,
      speechFit: async () => {
        asked++;
        return undefined;
      },
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    await served('');
    expect(asked).toBe(0);
  });
});

describe('precise sync by speech', () => {
  const FILE_PATH = '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json';
  const stream = {
    infoHash: 'a'.repeat(40),
    fileIdx: 0,
    url: 'http://127.0.0.1:11470/x/0',
    videoPath: 'Movie.2020.1080p.mkv',
    files: [],
  };

  /** A made-up film: 60 cues of 6 words, 4 s apart, in the film's true timing. */
  const WORDS = Array.from(
    { length: 360 },
    (_, i) =>
      `w${String.fromCharCode(97 + (i % 26))}${String.fromCharCode(97 + (Math.floor(i / 26) % 26))}${i % 7}x`,
  );
  const TRUE_START = (c: number) => 10 + c * 4; // seconds
  const srtAt = (shiftSec: number) =>
    Array.from({ length: 60 }, (_, c) => {
      const t = (n: number) => {
        const ms = Math.round((n + shiftSec) * 1000);
        const p = (v: number, w = 2) => String(v).padStart(w, '0');
        return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
      };
      return `${c + 1}\n${t(TRUE_START(c))} --> ${t(TRUE_START(c) + 3)}\n${WORDS.slice(c * 6, c * 6 + 6).join(' ')}\n`;
    }).join('\n');
  const speech = (words: string[]) => ({
    transcription: [
      {
        tokens: words.map((w, i) => ({
          text: ` ${w}`,
          offsets: {
            from: Math.round((TRUE_START(Math.floor(i / 6)) + (i % 6) * 0.4) * 1000),
            to: Math.round((TRUE_START(Math.floor(i / 6)) + (i % 6) * 0.4) * 1000) + 300,
          },
          t_dtw: Math.round((TRUE_START(Math.floor(i / 6)) + 0.35 + (i % 6) * 0.4) * 100),
        })),
      },
    ],
  });

  const readySync = async (
    json: unknown,
    log = { runs: 0, gate: undefined as Promise<void> | undefined },
  ) => {
    const zip = makeZip({
      'bin/Release/whisper-cli.exe': 'cli',
      'bin/Release/whisper.dll': 'w',
      'bin/Release/ggml.dll': 'g',
      'bin/Release/ggml-base.dll': 'gb',
    });
    const model = Buffer.from('m'.repeat(32));
    const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const svc = new SyncService({
      dataDir: mkdtempSync(join(tmpdir(), 'sync-')),
      logger: silentLogger(),
      supported: true,
      modelSpec: {
        name: 'tiny.en',
        file: 'ggml-tiny.en.bin',
        url: 'https://huggingface.co/m',
        sha256: sha(model),
        bytes: model.length,
        leadSec: 0.35,
      },
      zipSpec: { url: 'https://github.com/t.zip', sha256: sha(zip), bytes: zip.length },
      fetchImpl: (async (u: string | URL | Request) =>
        new Response(new Uint8Array(String(u).endsWith('.zip') ? zip : model))) as typeof fetch,
      runner: {
        extractAudio: async () => undefined,
        transcribe: async (_c, args, _cwd, onLine) => {
          log.runs++;
          onLine('progress = 50%');
          if (log.gate) await log.gate;
          writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify(json));
        },
      },
    });
    await svc.install();
    return { svc, log };
  };

  const onSpeech = (over: object = {}) => ({
    settings: { preciseSync: true },
    findStream: async () => stream,
    ...over,
  });

  it('puts an English OpenSubtitles subtitle that is 3 s late on the real speech', async () => {
    const { svc, log } = await readySync(speech(WORDS));
    current = await start({
      ...onSpeech(),
      sync: svc,
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
      content: srtAt(3),
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(log.runs).toBe(1);
    // The 20th cue really starts at 10 + 19 * 4 = 86 s; the subtitle said 89 s.
    expect(srt).toContain('00:01:26,000 --> ');
    expect(srt).not.toContain('00:01:29,');
    expect(srt).toContain('HE:');
    // The library says it was placed on the speech, not that it is exact like the video's own.
    let lib: { items: { timing?: string }[] } = { items: [] };
    for (let i = 0; i < 40 && lib.items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      lib = (await (await current.get('/api/library')).json()) as typeof lib;
    }
    expect(lib.items[0]?.timing).toBe('speech');
  });

  it('also works when subtitles inside the video are switched off', async () => {
    const { svc, log } = await readySync(speech(WORDS));
    current = await start({
      ...onSpeech({ settings: { preciseSync: true, embeddedSubtitles: false } }),
      sync: svc,
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
      content: srtAt(3),
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(log.runs).toBe(1);
    expect(srt).toContain('00:01:26,000 --> ');
  });

  it('prefers the English subtitle over a Hebrew one, because only English can be placed on the speech', async () => {
    const { svc } = await readySync(speech(WORDS));
    current = await start({
      ...onSpeech(),
      sync: svc,
      candidates: [
        cand({ fileId: 1, language: 'he', downloadCount: 900 }),
        cand({ fileId: 2, language: 'en', downloadCount: 10 }),
      ],
      contentFor: (c) => (c.language === 'he' ? srtAt(5) : srtAt(3)),
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(srt).toContain('HE:'); // translated from the English one
    expect(srt).not.toContain('00:01:29,');
  });

  it('keeps the normal choice when the text is not what is said in the video', async () => {
    const { svc } = await readySync(speech(WORDS.map((w) => `zz${w}qq`)));
    current = await start({
      ...onSpeech(),
      sync: svc,
      candidates: [
        cand({ fileId: 1, language: 'he', downloadCount: 900 }),
        cand({ fileId: 2, language: 'en', downloadCount: 10 }),
      ],
      contentFor: (c) => (c.language === 'he' ? SRC : srtAt(3)),
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const srt = await (await current.get(new URL(sub.url).pathname)).text();
    expect(srt).toContain('Hello there.'); // the Hebrew one as it was, not translated
    expect(srt).not.toContain('HE:');
    expect(current.translator.calls).toBe(0);
  });

  it('does nothing when the setting is off, the tool is missing or the video is not on the local server', async () => {
    const { svc, log } = await readySync(speech(WORDS));
    for (const over of [
      { settings: { preciseSync: false } },
      { findStream: async () => undefined },
    ]) {
      current = await start({
        ...onSpeech(over),
        sync: svc,
        candidates: [cand({ fileId: 7, language: 'en' })],
        content: srtAt(3),
      });
      const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
      const srt = await (await current.get(new URL(sub.url).pathname)).text();
      expect(srt).toContain('00:01:29,'); // not moved
      await current.close();
    }
    expect(log.runs).toBe(0);
  });

  it('says it is listening to the video, with progress, while the first subtitle is made', async () => {
    let open: () => void = () => undefined;
    const gate = new Promise<void>((r) => {
      open = r;
    });
    const { svc } = await readySync(speech(WORDS), { runs: 0, gate });
    current = await start({
      ...onSpeech(),
      sync: svc,
      subWaitMs: 100,
      candidates: [cand({ fileId: 7, language: 'en' })],
      content: srtAt(3),
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const waiting = await (await current.get(new URL(sub.url).pathname)).text();
    expect(waiting).toContain('Syncing the subtitle to the speech');
    const status = (await (await current.get('/api/status')).json()) as {
      stage: string;
      syncPercent: number;
    };
    expect(status).toMatchObject({ stage: 'sync', syncPercent: 50 });
    open();
    await (await current.get(new URL(sub.url).pathname)).text();
  });

  it('offers the download, installs on request and switches itself on', async () => {
    const zip = makeZip({
      'bin/Release/whisper-cli.exe': 'cli',
      'bin/Release/whisper.dll': 'w',
      'bin/Release/ggml.dll': 'g',
      'bin/Release/ggml-base.dll': 'gb',
    });
    const model = Buffer.from('m'.repeat(32));
    const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
    const svc = new SyncService({
      dataDir: mkdtempSync(join(tmpdir(), 'sync-')),
      logger: silentLogger(),
      supported: true,
      modelSpec: {
        name: 'tiny.en',
        file: 'ggml-tiny.en.bin',
        url: 'https://huggingface.co/m',
        sha256: sha(model),
        bytes: model.length,
        leadSec: 0.35,
      },
      zipSpec: { url: 'https://github.com/t.zip', sha256: sha(zip), bytes: zip.length },
      fetchImpl: (async (u: string | URL | Request) =>
        new Response(new Uint8Array(String(u).endsWith('.zip') ? zip : model))) as typeof fetch,
    });
    current = await start({ sync: svc });
    const get = async () =>
      (await (await current!.get('/api/sync')).json()) as {
        state: string;
        enabled: boolean;
        supported: boolean;
      };
    expect(await get()).toMatchObject({ supported: true, state: 'missing', enabled: false });
    const res = await fetch(current.base + '/api/sync/install', {
      method: 'POST',
      headers: { Host: current.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(200);
    for (let i = 0; i < 40 && (await get()).state !== 'ready'; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(await get()).toMatchObject({ state: 'ready', enabled: true });
    const off = await fetch(current.base + '/api/sync/remove', {
      method: 'POST',
      headers: { Host: current.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(await off.json()).toMatchObject({ ok: true, state: 'missing', enabled: false });
  });

  it('refuses to install where the tool does not run', async () => {
    const svc = new SyncService({
      dataDir: mkdtempSync(join(tmpdir(), 'sync-')),
      logger: silentLogger(),
      supported: false,
    });
    current = await start({ sync: svc });
    const res = await fetch(current.base + '/api/sync/install', {
      method: 'POST',
      headers: { Host: current.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(400);
  });
});

describe('ask mode (translate only after the user says yes)', () => {
  const post = async (h: Harness, path: string, body: unknown) => {
    const res = await fetch(h.base + path, {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: res.status, ...((await res.json()) as { ok?: boolean }) };
  };
  type Queue = {
    id: string;
    state: string;
    episode?: number;
    percent: number | null;
    skippable?: string;
  }[];
  const queueOf = async (h: Harness): Promise<Queue> =>
    ((await (await h.get('/api/status')).json()) as { queue: Queue }).queue;
  const request = async (h: Harness, id: string): Promise<string> => {
    const res = await h.get(`/subtitles/series/${encodeURIComponent(id)}.json`);
    return ((await res.json()) as SubsResponse).subtitles[0]!.url;
  };
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 80 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('waits for approval, says so in the player, then translates', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    const url = await request(current, 'tt0944947:1:1');
    const path = new URL(url).pathname;
    expect(await queueOf(current)).toMatchObject([{ state: 'pending', episode: 1 }]);
    expect(await (await current.get(path)).text()).toContain('התקבל'); // Hebrew by default
    expect(current.translator.calls).toBe(0);
    expect(current.searches).toBe(0); // nothing is downloaded before the user agrees

    const id = (await queueOf(current))[0]!.id;
    expect((await post(current, `/api/jobs/${id}/approve`, {})).ok).toBe(true);
    let text = '';
    await until(async () => {
      text = await (await current!.get(path)).text();
      return text.includes('HE:');
    });
    expect(text).toContain('HE:Hello there.');
    expect(await queueOf(current)).toEqual([]);
  });

  describe('the queue line follows what the user is waiting for', () => {
    // A request with a file name containing "slow" never finds its subtitle inside the video, so it stays running.
    const slowOpts = {
      subWaitMs: 50,
      loadEmbedded: (async (q: { filename: string }) =>
        q.filename.includes('slow') ? new Promise<never>(() => undefined) : undefined) as never,
    };
    const requestFile = async (h: Harness, name: string): Promise<string> => {
      const res = await h.get(
        `/subtitles/series/tt0944947%3A1%3A1/filename=${encodeURIComponent(name)}.json`,
      );
      return ((await res.json()) as SubsResponse).subtitles[0]!.url;
    };
    const done = async (h: Harness, url: string) =>
      until(async () => (await (await h.get(new URL(url).pathname)).text()).includes('HE:'));
    type Status = { queue: Queue; progress: { percent: number } | null };
    const statusOf = async (h: Harness) => (await (await h.get('/api/status')).json()) as Status;

    it('a cancelled request is not restarted by the next request for the same video', async () => {
      let lookups = 0;
      current = await start({
        subWaitMs: 50,
        loadEmbedded: (async () => {
          lookups++;
          return new Promise<never>(() => undefined);
        }) as never,
      });
      const url = await requestFile(current, 'slow.mkv');
      await until(async () => lookups > 0);
      const id = (await statusOf(current)).queue[0]!.id;
      expect((await post(current, `/api/jobs/${id}/cancel`, {})).ok).toBe(true);
      await until(async () =>
        (await (await current!.get(new URL(url).pathname)).text()).includes('cancelled'),
      );
      await requestFile(current, 'slow.mkv'); // Stremio asks again
      expect(lookups).toBe(1); // nothing was started again
      expect((await statusOf(current)).queue).toEqual([]);
      expect(await (await current.get(new URL(url).pathname)).text()).toContain('cancelled');
    });

    it('after the short cooldown, selecting the subtitle again starts a cancelled request over', async () => {
      let lookups = 0;
      current = await start({
        subWaitMs: 50,
        cancelCooldownMs: 0,
        loadEmbedded: (async () => {
          lookups++;
          return new Promise<never>(() => undefined);
        }) as never,
      });
      const url = await requestFile(current, 'slow.mkv');
      await until(async () => lookups > 0);
      const id = (await statusOf(current)).queue[0]!.id;
      expect((await post(current, `/api/jobs/${id}/cancel`, {})).ok).toBe(true);
      await until(async () =>
        (await (await current!.get(new URL(url).pathname)).text()).includes('cancelled'),
      );
      await new Promise((r) => setTimeout(r, 5));
      await requestFile(current, 'slow.mkv'); // the user selects the subtitle again
      await until(async () => lookups > 1);
      expect((await statusOf(current)).queue).toHaveLength(1);
    });

    it('Skip gives up the search inside the video and goes on to the downloaded subtitle', async () => {
      current = await start(slowOpts);
      const url = await requestFile(current, 'slow.mkv');
      await until(async () => (await statusOf(current!)).queue[0]?.skippable === 'local');
      const id = (await statusOf(current)).queue[0]!.id;
      expect((await post(current, `/api/jobs/${id}/skip`, {})).ok).toBe(true);
      await done(current, url);
      expect(await (await current.get(new URL(url).pathname)).text()).toContain('HE:');
    });

    it('one Skip applies to every request for the episode (another file of the same video)', async () => {
      current = await start(slowOpts);
      const a = await requestFile(current, 'slow.mkv');
      const b = await requestFile(current, 'slow-other.mkv'); // same episode, another job
      await until(async () => (await statusOf(current!)).queue[0]?.skippable === 'local');
      const id = (await statusOf(current)).queue[0]!.id;
      expect((await post(current, `/api/jobs/${id}/skip`, {})).ok).toBe(true);
      await done(current, a);
      await done(current, b);
      expect(await (await current.get(new URL(a).pathname)).text()).toContain('HE:');
      expect(await (await current.get(new URL(b).pathname)).text()).toContain('HE:');
    });

    it('cancelling a request that is still waiting for a free slot ends it at once', async () => {
      current = await start({
        subWaitMs: 50,
        settings: {},
        loadEmbedded: (async () => new Promise<never>(() => undefined)) as never,
      });
      // Five different files for five episodes: four take the slots, the fifth waits.
      const urls: string[] = [];
      for (let e = 1; e <= 5; e++) {
        const res = await current.get(
          `/subtitles/series/tt0944947%3A1%3A${e}/filename=slow${e}.mkv.json`,
        );
        urls.push(((await res.json()) as SubsResponse).subtitles[0]!.url);
      }
      let queue = (await statusOf(current)).queue;
      expect(queue).toHaveLength(5);
      const waiting = queue.find((q) => q.state === 'queued')!;
      expect(waiting).toBeDefined();
      await post(current, `/api/jobs/${waiting.id}/cancel`, {});
      queue = (await statusOf(current)).queue;
      expect(queue).toHaveLength(4);
      expect(queue.some((q) => q.id === waiting.id)).toBe(false);
    });

    it('hides a slow request that was already waiting when its episode got a subtitle', async () => {
      current = await start(slowOpts);
      await requestFile(current, 'slow.mkv');
      const fast = await requestFile(current, 'fast.mkv');
      await done(current, fast);
      expect((await statusOf(current)).queue).toEqual([]);
    });

    it('shows a new request for an episode that already had a subtitle, and not the old 100%', async () => {
      current = await start(slowOpts);
      const fast = await requestFile(current, 'fast.mkv');
      await done(current, fast);
      expect((await statusOf(current)).progress).toMatchObject({ percent: 100 });
      await requestFile(current, 'slow.mkv');
      const status = await statusOf(current);
      expect(status.queue).toHaveLength(1);
      expect(status.queue[0]!.state).toBe('running');
      expect(status.progress).toBeNull(); // the card describes the running one, not the finished one
    });
  });

  it('the two requests Stremio sends for one episode are one line, and one click covers both', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    const first = await request(current, 'tt0944947:1:1');
    const res = await current.get(
      '/subtitles/series/tt0944947%3A1%3A1/videoHash=8e245d9679d31e12.json',
    );
    const second = ((await res.json()) as SubsResponse).subtitles[0]!.url;
    expect(second).not.toBe(first); // two job ids...
    const queue = await queueOf(current);
    expect(queue).toHaveLength(1); // ...one line for the user
    expect((await post(current, `/api/jobs/${queue[0]!.id}/approve`, {})).ok).toBe(true);
    for (const url of [first, second]) {
      let text = '';
      await until(async () => {
        text = await (await current!.get(new URL(url).pathname)).text();
        return text.includes('HE:');
      });
      expect(text).toContain('HE:Hello there.');
    }
    expect(current.translator.calls).toBe(2); // 3 cues, chunk size 2: one translation for both
  });

  it('one notification per episode, even though Stremio sends several requests', async () => {
    const notified: string[] = [];
    current = await start({
      settings: { translationMode: 'ask' },
      subWaitMs: 50,
      onPending: (item) => notified.push(item.title),
    });
    await request(current, 'tt0944947:1:1');
    await current.get('/subtitles/series/tt0944947%3A1%3A1/videoHash=8e245d9679d31e12.json');
    await until(async () => notified.length > 0);
    await new Promise((r) => setTimeout(r, 150));
    expect(notified).toHaveLength(1);
  });

  it('an old /sub address does not push out the request the user is deciding about', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    const oldUrl = await request(current, 'tt0944947:1:1');
    await request(current, 'tt0944947:1:2'); // replaces episode 1, which is no longer in memory
    await current.get(new URL(oldUrl).pathname); // the player asks for the old address again
    expect((await queueOf(current)).some((q) => q.episode === 2)).toBe(true);
  });

  it('choosing another episode replaces the one still waiting', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    await request(current, 'tt0944947:1:1');
    await request(current, 'tt0944947:1:2');
    expect(await queueOf(current)).toMatchObject([{ state: 'pending', episode: 2 }]);
  });

  it('cancel removes a waiting request', async () => {
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50 });
    await request(current, 'tt0944947:1:1');
    const id = (await queueOf(current))[0]!.id;
    expect((await post(current, `/api/jobs/${id}/cancel`, {})).ok).toBe(true);
    expect(await queueOf(current)).toEqual([]);
    expect(current.translator.calls).toBe(0);
  });

  it('cancel stops a translation that is already running', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    current = await start({ settings: { translationMode: 'ask' }, subWaitMs: 50, gate });
    const url = await request(current, 'tt0944947:1:1');
    const id = (await queueOf(current))[0]!.id;
    await post(current, `/api/jobs/${id}/approve`, {});
    await until(async () => current!.translator.calls > 0);
    await post(current, `/api/jobs/${id}/cancel`, {});
    release();
    await until(async () => (await queueOf(current!)).length === 0);
    expect(await queueOf(current)).toEqual([]);
    expect(await (await current.get(new URL(url).pathname)).text()).toContain('cancelled');
    expect(current.translator.calls).toBeLessThanOrEqual(2); // no further requests after the cancel
  });

  it('auto mode (the default) still translates at once', async () => {
    current = await start({ subWaitMs: 50 });
    const url = await request(current, 'tt0944947:1:1');
    await until(async () =>
      (await (await current!.get(new URL(url).pathname)).text()).includes('HE:'),
    );
    expect(current.translator.calls).toBeGreaterThan(0);
  });

  it('test mode puts a made-up request in the queue without using the real source or AI', async () => {
    current = await start({ settings: { testMode: true }, subWaitMs: 50 });
    expect((await post(current, '/api/test/run', {})).ok).toBe(true);
    await until(async () => (await queueOf(current!)).length > 0);
    expect((await queueOf(current)).length).toBe(1);
    await new Promise((r) => setTimeout(r, 2000));
    expect(current.searches).toBe(0);
    expect(current.translator.calls).toBe(0);
    expect(existsSync(join(current.dataDir, 'library.json'))).toBe(false);
  });

  it('a test request is refused while test mode is off', async () => {
    current = await start({});
    expect((await post(current, '/api/test/run', {})).status).toBe(400);
  });

  it('rejects a bad queue action', async () => {
    current = await start({ settings: { translationMode: 'ask' } });
    expect((await post(current, '/api/jobs/not-an-id/approve', {})).status).toBe(400);
    expect((await post(current, `/api/jobs/${'a'.repeat(32)}/explode`, {})).status).toBe(400);
  });
});
