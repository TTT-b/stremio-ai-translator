import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
  type SubtitleQuery,
} from '../src/sources/types';
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
  contentFor?: (c: SubtitleCandidate) => string;
  loadEmbedded?: NonNullable<Parameters<typeof createApp>[0]['loadEmbedded']>;
  refreshGuessAfterMs?: number;
  stallAfterMs?: number;
  onUpgraded?: NonNullable<Parameters<typeof createApp>[0]['onUpgraded']>;
  /** Replaces the fake AI: gets the request and the call number. */
  translate?: ConstructorParameters<typeof FakeProvider>[0];
  cancelCooldownMs?: number;
  limits?: NonNullable<Parameters<typeof createApp>[0]['limits']>;
  logDir?: string;
  /** The search for a subtitle never answers. */
  searchHangs?: boolean;
  findStream?: NonNullable<Parameters<typeof createApp>[0]['findStream']>;
  speechFit?: NonNullable<Parameters<typeof createApp>[0]['speechFit']>;
  settings?: object;
  onPending?: NonNullable<Parameters<typeof createApp>[0]['onPending']>;
  gate?: Promise<void>;
  subWaitMs?: number;
  dataDir?: string;
  /** A download of this candidate fails with the returned error. */
  downloadError?: (c: SubtitleCandidate) => AppError | undefined;
  /** The candidates for one search (instead of the same ones every time). */
  candidatesFor?: (q: SubtitleQuery) => SubtitleCandidate[];
  /** Called for every search; may throw to make that search fail. */
  onSearch?: (q: SubtitleQuery) => void;
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
    translator: new FakeProvider(
      opts.translate ??
        (async (req) => {
          if (opts.gate) await opts.gate;
          return { translations: req.cues.map((c) => ({ id: c.id, text: `HE:${c.text}` })) };
        }),
    ),
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
      opts.onSearch?.(q);
      return opts.candidatesFor?.(q) ?? opts.candidates ?? [cand()];
    },
    download: async (c) => {
      const failure = opts.downloadError?.(c);
      if (failure) throw failure;
      h.downloads++;
      return { content: opts.contentFor?.(c) ?? opts.content ?? SRC, fileName: 'a.srt' };
    },
  };
  // Most tests predate the next-episode head start and the sound check that runs beside the
  // translation: they keep the old behavior (one episode at a time, translation waits for the
  // check) unless a test says otherwise.
  writeFileSync(
    join(h.dataDir, 'settings.json'),
    JSON.stringify({ prefetchNext: false, soundCheck: 'wait', ...opts.settings }),
  );
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
    ...(opts.speechFit
      ? { findStream: opts.findStream ?? (async () => undefined), ffmpegFor: () => 'ffmpeg.exe' }
      : {}),
    ...(opts.limits ? { limits: opts.limits } : {}),
    ...(opts.onPending ? { onPending: opts.onPending } : {}),
    ...(opts.logDir ? { logDir: opts.logDir } : {}),
    ...(opts.cancelCooldownMs !== undefined ? { cancelCooldownMs: opts.cancelCooldownMs } : {}),
    ...(opts.onUpgraded ? { onUpgraded: opts.onUpgraded } : {}),
    ...(opts.stallAfterMs !== undefined ? { stallAfterMs: opts.stallAfterMs } : {}),
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

describe('the Continue button', () => {
  type St = { resumable: boolean; queue: unknown[] };
  const status = async (h: Harness) => (await (await h.get('/api/status')).json()) as St;
  const resume = async (h: Harness) => {
    const res = await fetch(h.base + '/api/resume', {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    return (await res.json()) as { ok: boolean; action: string };
  };
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 120 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('has nothing to do when everything is fine', async () => {
    current = await start({});
    expect((await status(current)).resumable).toBe(false);
    expect(await resume(current)).toEqual({ ok: false, action: 'none' });
  });

  it('restarts a cancelled request at once and the subtitle then arrives', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    current = await start({ gate, subWaitMs: 50, cancelCooldownMs: 60_000 });
    const body = (await (
      await current.get('/subtitles/movie/tt0111161.json')
    ).json()) as SubsResponse;
    const path = new URL(body.subtitles[0]!.url).pathname;
    const queue = ((await (await current.get('/api/status')).json()) as { queue: { id: string }[] })
      .queue;
    await fetch(current.base + '/api/jobs/' + queue[0]!.id + '/cancel', {
      method: 'POST',
      headers: { Host: current.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    release();
    await until(async () => (await status(current!)).resumable);
    expect((await status(current)).resumable).toBe(true);
    expect((await resume(current)).action).toBe('restarted');
    let text = '';
    await until(async () => {
      text = await (await current!.get(path)).text();
      return text.includes('HE:');
    });
    expect(text).toContain('HE:Hello there.');
    expect((await status(current)).resumable).toBe(false);
  });

  it('cuts a translation that stopped getting answers, and it finishes', async () => {
    current = await start({
      stallAfterMs: 50,
      subWaitMs: 50,
      translate: async (req, call) =>
        call === 1
          ? new Promise<never>(() => undefined)
          : { translations: req.cues.map((c) => ({ id: c.id, text: 'T:' + c.text })) },
    });
    const body = (await (
      await current.get('/subtitles/movie/tt0111161.json')
    ).json()) as SubsResponse;
    const path = new URL(body.subtitles[0]!.url).pathname;
    await until(async () => (await status(current!)).resumable);
    expect((await status(current)).resumable).toBe(true);
    expect((await resume(current)).action).toBe('kicked');
    let text = '';
    await until(async () => {
      text = await (await current!.get(path)).text();
      return text.includes('T:');
    });
    expect(text).toContain('T:Hello there.');
  });
});

describe('an exact subtitle that arrives after the job finished', () => {
  const at = (s: number) =>
    '00:' +
    String(Math.floor(s / 60)).padStart(2, '0') +
    ':' +
    String(s % 60).padStart(2, '0') +
    ',000';
  const own = Array.from(
    { length: 25 },
    (_, i) =>
      i + 1 + '\n' + at(10 + i * 3) + ' --> ' + at(11 + i * 3) + '\nOWN line ' + (i + 1) + '\n',
  ).join('\n');
  const FILE = '/subtitles/series/tt0944947%3A1%3A1/filename=late.mkv.json';
  const until = async (check: () => Promise<boolean>) => {
    for (let i = 0; i < 160 && !(await check()); i++) await new Promise((r) => setTimeout(r, 25));
  };

  it('is translated in the background and replaces the shown subtitle, with no "translating" text in between', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const upgraded: { season?: number; episode?: number }[] = [];
    current = await start({
      subWaitMs: 50,
      limits: { embeddedSoftMs: 30 },
      onUpgraded: (item) => upgraded.push(item),
      loadEmbedded: (async () => {
        await gate;
        return { raw: own, language: 'en', source: 'track', cues: 25 };
      }) as never,
    });
    const sub = ((await (await current.get(FILE)).json()) as SubsResponse).subtitles[0]!;
    const path = new URL(sub.url).pathname;
    let first = '';
    await until(async () => {
      first = await (await current!.get(path)).text();
      return first.includes('HE:');
    });
    expect(first).toContain('HE:Hello there.'); // the downloaded subtitle, translated
    expect(first).not.toContain('OWN line');

    release(); // the video's own subtitle arrives after the job finished
    let text = '';
    const seen: string[] = [];
    await until(async () => {
      text = await (await current!.get(path)).text();
      seen.push(text);
      return text.includes('HE:OWN line 1');
    });
    expect(text).toContain('HE:OWN line 1');
    expect(seen.every((t) => t.includes('HE:'))).toBe(true); // never a placeholder
    let lib: { items: { timing?: string }[] } = { items: [] };
    await until(async () => {
      lib = (await (await current!.get('/api/library')).json()) as typeof lib;
      return lib.items[0]?.timing === 'exact';
    });
    expect(lib.items[0]?.timing).toBe('exact');
    // The main screen is told, once, so the user knows to select the subtitle again.
    await until(async () => upgraded.length > 0);
    expect(upgraded).toHaveLength(1);
    expect(upgraded[0]).toMatchObject({ season: 1, episode: 1 });
    const status = (await (await current.get('/api/status')).json()) as {
      upgrade: { season?: number; episode?: number; at: number } | null;
    };
    expect(status.upgrade).toMatchObject({ season: 1, episode: 1 });
  });

  it('changes nothing when the video never gives its own subtitle', async () => {
    current = await start({
      subWaitMs: 50,
      limits: { embeddedSoftMs: 30 },
      loadEmbedded: (async () => undefined) as never,
    });
    const sub = ((await (await current.get(FILE)).json()) as SubsResponse).subtitles[0]!;
    const path = new URL(sub.url).pathname;
    let text = '';
    await until(async () => {
      text = await (await current!.get(path)).text();
      return text.includes('HE:');
    });
    await new Promise((r) => setTimeout(r, 150));
    expect(await (await current.get(path)).text()).toBe(text);
    const status = (await (await current.get('/api/status')).json()) as { upgrade: unknown };
    expect(status.upgrade).toBeNull();
  });
});

describe('saving a subtitle as an SRT file', () => {
  it('serves a finished subtitle as a download, and says 404 for anything else', async () => {
    current = await start({});
    const body = (await (
      await current.get('/subtitles/movie/tt0111161.json')
    ).json()) as SubsResponse;
    await (await current.get(new URL(body.subtitles[0]!.url).pathname)).text();
    let id = '';
    for (let i = 0; i < 60 && !id; i++) {
      const lib = (await (await current.get('/api/library')).json()) as { items: { id: string }[] };
      id = lib.items[0]?.id ?? '';
      if (!id) await new Promise((r) => setTimeout(r, 25));
    }
    expect(id).not.toBe('');
    const res = await current.get('/api/library/' + id + '/srt');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toMatch(
      /^attachment; filename\*=UTF-8''.+\.srt$/,
    );
    expect(await res.text()).toContain('HE:Hello there.');
    expect((await current.get('/api/library/' + 'a'.repeat(32) + '/srt')).status).toBe(404);
    expect((await current.get('/api/library/not-an-id/srt')).status).toBe(404);
  });
});

describe('saving a video with the subtitle inside', () => {
  it('refuses unknown subtitles and video paths that are not usable', async () => {
    current = await start({});
    const post = (id: string, body: unknown) =>
      fetch(current!.base + '/api/library/' + id + '/mux', {
        method: 'POST',
        headers: { Host: current!.host, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post('a'.repeat(32), { video: 'C:\v.mkv' })).status).toBe(404);
    const made = (await (
      await current.get('/subtitles/movie/tt0111161.json')
    ).json()) as SubsResponse;
    await (await current.get(new URL(made.subtitles[0]!.url).pathname)).text();
    let id = '';
    for (let i = 0; i < 60 && !id; i++) {
      const lib = (await (await current.get('/api/library')).json()) as { items: { id: string }[] };
      id = lib.items[0]?.id ?? '';
      if (!id) await new Promise((r) => setTimeout(r, 25));
    }
    expect((await post(id, {})).status).toBe(400);
    const relative = await post(id, { video: 'relative.mkv' });
    expect(relative.status).toBe(400);
    expect(((await relative.json()) as { code: string }).code).toBe('BAD_PATH');
  });
});

describe('the old speech tool', () => {
  it('is removed from the data folder at start', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'old-sync-'));
    mkdirSync(join(dataDir, 'tools', 'whisper'), { recursive: true });
    writeFileSync(join(dataDir, 'tools', 'whisper', 'model.bin'), 'x');
    mkdirSync(join(dataDir, 'sync-cache'), { recursive: true });
    current = await start({ dataDir });
    expect(existsSync(join(dataDir, 'tools', 'whisper'))).toBe(false);
    expect(existsSync(join(dataDir, 'sync-cache'))).toBe(false);
  });
});

describe('speaker names and sound notes', () => {
  const SDH = [
    '1\n00:00:01,000 --> 00:00:02,000\nKATARA: Water.\n',
    '2\n00:00:03,000 --> 00:00:04,000\n(groans)\n',
    '3\n00:00:05,000 --> 00:00:06,000\n- (thud)\n- Aang!\n',
  ].join('\n');
  const fetchSrt = async (h: Harness) => {
    const body = (await (await h.get('/subtitles/movie/tt0111161.json')).json()) as SubsResponse;
    return (await h.get(new URL(body.subtitles[0]!.url).pathname)).text();
  };

  it('are removed before translation by default, and a sound-only line disappears', async () => {
    current = await start({ content: SDH });
    const srt = await fetchSrt(current);
    expect(srt).toContain('HE:Water.');
    expect(srt).toContain('HE:Aang!');
    expect(srt).not.toContain('KATARA');
    expect(srt).not.toContain('groans');
    expect(srt).not.toContain('thud');
    expect(srt.match(/-->/g)).toHaveLength(2);
  });

  it('stay when the setting is switched off', async () => {
    current = await start({ content: SDH, settings: { cleanSubtitles: false } });
    const srt = await fetchSrt(current);
    expect(srt).toContain('HE:KATARA: Water.');
    expect(srt).toContain('HE:(groans)');
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
    expect(first).toContain('בחר שוב את הכתוביות בסוף התהליך');
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

  it('translates after a while without the sound check, then moves the finished subtitle when it finishes', async () => {
    const upgraded: unknown[] = [];
    current = await start({
      findStream: async () => stream,
      subWaitMs: 50,
      limits: { syncWaitMs: 40 },
      onUpgraded: (item) => upgraded.push(item),
      speechFit: async () => {
        await new Promise((r) => setTimeout(r, 400));
        return { scale: 1, offsetMs: 2000, score: 0.2, baseline: 0 };
      },
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const sub = ((await (await current.get(FILE_PATH)).json()) as SubsResponse).subtitles[0]!;
    const path = new URL(sub.url).pathname;
    const firstStart = (srt: string) => {
      const m = /(\d\d):(\d\d):(\d\d),(\d\d\d) -->/.exec(srt);
      return m
        ? ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + Number(m[4])
        : -1;
    };
    let text = '';
    for (let i = 0; i < 120 && !text.includes('HE:'); i++) {
      text = await (await current.get(path)).text();
      if (!text.includes('HE:')) await new Promise((r) => setTimeout(r, 25));
    }
    expect(text).toContain('HE:'); // translated before the sound check was done
    const before = firstStart(text);
    let after = before;
    for (let i = 0; i < 160 && after === before; i++) {
      await new Promise((r) => setTimeout(r, 25));
      after = firstStart(await (await current.get(path)).text());
    }
    expect(after - before).toBe(2000);
    expect(upgraded).toHaveLength(1);
    const status = (await (await current.get('/api/status')).json()) as { upgrade: unknown };
    expect(status.upgrade).not.toBeNull();
    let lib: { items: { timing?: string }[] } = { items: [] };
    for (let i = 0; i < 40 && lib.items[0]?.timing !== 'speech'; i++) {
      await new Promise((r) => setTimeout(r, 25));
      lib = (await (await current.get('/api/library')).json()) as typeof lib;
    }
    expect(lib.items[0]?.timing).toBe('speech');
  });

  it('gives up listening when the video sends no sound, and goes on with the subtitle', async () => {
    current = await start({
      findStream: async () => stream,
      limits: { syncNoDataMs: 120 },
      speechFit: (o) =>
        new Promise((_resolve, reject) => {
          o.onProgress?.(0);
          o.signal.addEventListener('abort', () => reject(new Error('stopped')));
        }),
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const { s } = await served('');
    expect(s).toContain('HE:');
  });

  it('Continue skips a sound check that is waiting for the video', async () => {
    current = await start({
      findStream: async () => stream,
      stallAfterMs: 60,
      speechFit: (o) =>
        new Promise((_resolve, reject) => {
          o.onProgress?.(0);
          o.signal.addEventListener('abort', () => reject(new Error('stopped')));
        }),
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const made = (await (await current.get(FILE_PATH)).json()) as SubsResponse;
    const path = new URL(made.subtitles[0]!.url).pathname;
    type St = { resumable: boolean; stage: string };
    const status = async () => (await (await current!.get('/api/status')).json()) as St;
    for (let i = 0; i < 80 && !(await status()).resumable; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect((await status()).resumable).toBe(true);
    const res = await fetch(current.base + '/api/resume', {
      method: 'POST',
      headers: { Host: current.host, 'Content-Type': 'application/json' },
      body: '{}',
    });
    expect(((await res.json()) as { ok: boolean }).ok).toBe(true);
    let text = '';
    for (let i = 0; i < 120 && !text.includes('HE:'); i++) {
      text = await (await current.get(path)).text();
      if (!text.includes('HE:')) await new Promise((r) => setTimeout(r, 25));
    }
    expect(text).toContain('HE:');
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

    it('a subtitle inside the video that arrives just after Skip is still used (it is exact)', async () => {
      const at = (s: number) =>
        `00:${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
      const own = Array.from(
        { length: 25 },
        (_, i) => `${i + 1}\n${at(10 + i * 3)} --> ${at(11 + i * 3)}\nOWN line ${i + 1}\n`,
      ).join('\n');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      current = await start({
        subWaitMs: 50,
        findStream: async () => ({
          infoHash: 'a'.repeat(40),
          fileIdx: 0,
          url: 'http://127.0.0.1:11470/x/0',
          videoPath: 'late.mkv',
          files: [],
        }),
        // The timing check is slow, so the job is still busy when the video's own subtitle arrives.
        speechFit: async (o) => {
          await new Promise<void>((resolve) => {
            if (o.signal.aborted) resolve();
            o.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return undefined;
        },
        loadEmbedded: (async () => {
          await gate;
          return { raw: own, language: 'en', source: 'track', cues: 25 };
        }) as never,
      });
      const url = await requestFile(current, 'late.mkv');
      await until(async () => (await statusOf(current!)).queue[0]?.skippable === 'local');
      const id = (await statusOf(current)).queue[0]!.id;
      expect((await post(current, `/api/jobs/${id}/skip`, {})).ok).toBe(true);
      await until(async () => (await statusOf(current!)).queue[0]?.skippable === 'sync');
      release();
      await done(current, url);
      const text = await (await current.get(new URL(url).pathname)).text();
      expect(text).toContain('HE:OWN line 1');
    });

    it("does not wait long for the video's own subtitle: goes on with the download, and the own one still wins if it comes in time", async () => {
      const at = (s: number) =>
        '00:' +
        String(Math.floor(s / 60)).padStart(2, '0') +
        ':' +
        String(s % 60).padStart(2, '0') +
        ',000';
      const own = Array.from(
        { length: 25 },
        (_, i) =>
          i + 1 + '\n' + at(10 + i * 3) + ' --> ' + at(11 + i * 3) + '\nOWN line ' + (i + 1) + '\n',
      ).join('\n');
      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      let searches = 0;
      current = await start({
        subWaitMs: 50,
        limits: { embeddedSoftMs: 40 },
        findStream: async () => ({
          infoHash: 'a'.repeat(40),
          fileIdx: 0,
          url: 'http://127.0.0.1:11470/x/0',
          videoPath: 'soft.mkv',
          files: [],
        }),
        speechFit: async (o) => {
          searches++;
          release(); // the video's own subtitle arrives while the timing is being checked
          await new Promise<void>((resolve) => {
            if (o.signal.aborted) resolve();
            o.signal.addEventListener('abort', () => resolve(), { once: true });
          });
          return undefined;
        },
        loadEmbedded: (async () => {
          await gate;
          return { raw: own, language: 'en', source: 'track', cues: 25 };
        }) as never,
      });
      const url = await requestFile(current, 'soft.mkv');
      await done(current, url);
      expect(searches).toBe(1); // the job did go on without waiting for the video
      expect(await (await current.get(new URL(url).pathname)).text()).toContain('HE:OWN line 1');
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

describe('partial subtitles (the first part is shown while the rest is translated)', () => {
  const PATH = '/subtitles/movie/tt0111161.json';
  const LONG = Array.from(
    { length: 12 },
    (_, i) =>
      `${i + 1}\n00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},500\nLine ${i + 1}\n`,
  ).join('\n');
  // 12 lines in chunks of 2: a quarter is 3 lines, so two finished chunks (4 lines) are enough.
  const LIMITS = { partialMinTotalCues: 10 };
  /** The AI answers the first two chunks at once and holds back every later one until released. */
  const held = () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const translate: NonNullable<Parameters<typeof start>[0]['translate']> = async (req) => {
      if (Number(req.cues[0]?.id) >= 5) await gate;
      return { translations: req.cues.map((c) => ({ id: c.id, text: `HE:${c.text}` })) };
    };
    return { release, translate };
  };
  const subPath = async () =>
    new URL(((await (await current!.get(PATH)).json()) as SubsResponse).subtitles[0]!.url).pathname;
  const until = async (path: string, ok: (text: string) => boolean) => {
    let text = '';
    for (let i = 0; i < 160 && !ok(text); i++) {
      text = await (await current!.get(path)).text();
      if (!ok(text)) await new Promise((r) => setTimeout(r, 25));
    }
    return text;
  };

  it('serves the translated first part with a note instead of the progress message', async () => {
    const h = held();
    current = await start({ content: LONG, subWaitMs: 50, limits: LIMITS, translate: h.translate });
    const path = await subPath();
    const text = await until(path, (t) => t.includes('HE:Line 1'));
    expect(text).toContain('HE:Line 1');
    expect(text).toContain('HE:Line 4');
    expect(text).not.toContain('HE:Line 5');
    expect(text).not.toContain('מתרגם את הכתוביות');
    expect(text).toContain('התרגום ממשיך ברקע');
    // The note runs from the end of the part to the end of the movie (the last line ends at 23.5 s).
    expect(text).toMatch(/00:00:\d\d,\d{3} --> 00:00:23,500\nהתרגום ממשיך ברקע/);
    h.release();
  });

  it('never stores the part: nothing is listed or cached until the whole subtitle is done', async () => {
    const h = held();
    current = await start({ content: LONG, subWaitMs: 50, limits: LIMITS, translate: h.translate });
    const path = await subPath();
    await until(path, (t) => t.includes('HE:Line 1'));
    const lib = (await (await current.get('/api/library')).json()) as { items: unknown[] };
    expect(lib.items).toHaveLength(0);
    h.release();
    const full = await until(path, (t) => t.includes('HE:Line 12'));
    expect(full).not.toContain('התרגום ממשיך ברקע');
    let items: unknown[] = [];
    for (let i = 0; i < 40 && items.length === 0; i++) {
      await new Promise((r) => setTimeout(r, 25));
      items = ((await (await current.get('/api/library')).json()) as { items: unknown[] }).items;
    }
    expect(items).toHaveLength(1);
  });

  it('tells the user to reselect once the whole subtitle is ready', async () => {
    const h = held();
    const upgraded: unknown[] = [];
    current = await start({
      content: LONG,
      subWaitMs: 50,
      limits: LIMITS,
      translate: h.translate,
      onUpgraded: (item) => upgraded.push(item),
    });
    const path = await subPath();
    await until(path, (t) => t.includes('HE:Line 1'));
    expect(upgraded).toHaveLength(0);
    h.release();
    await until(path, (t) => t.includes('HE:Line 12'));
    for (let i = 0; i < 40 && upgraded.length === 0; i++)
      await new Promise((r) => setTimeout(r, 25));
    expect(upgraded).toHaveLength(1);
  });

  it('says nothing extra when no part was ever shown', async () => {
    const upgraded: unknown[] = [];
    current = await start({
      content: LONG,
      subWaitMs: 2000,
      limits: LIMITS,
      onUpgraded: (item) => upgraded.push(item),
    });
    const text = await until(await subPath(), (t) => t.includes('HE:Line 12'));
    expect(text).toContain('HE:Line 12');
    await new Promise((r) => setTimeout(r, 100));
    expect(upgraded).toHaveLength(0);
  });

  it('keeps showing the part, with a stopped note, when the translation fails', async () => {
    current = await start({
      content: LONG,
      subWaitMs: 50,
      limits: LIMITS,
      translate: async (req) => {
        if (Number(req.cues[0]?.id) >= 5) {
          await new Promise((r) => setTimeout(r, 100));
          throw new AppError('PROVIDER_MODEL_UNAVAILABLE');
        }
        return { translations: req.cues.map((c) => ({ id: c.id, text: `HE:${c.text}` })) };
      },
    });
    const path = await subPath();
    const text = await until(path, (t) => t.includes('התרגום נעצר'));
    expect(text).toContain('HE:Line 1');
    expect(text).toContain('התרגום נעצר');
    expect(text).not.toContain('Subtitle unavailable');
  });

  it('does not show a part when the setting is off', async () => {
    const h = held();
    current = await start({
      content: LONG,
      subWaitMs: 50,
      limits: LIMITS,
      translate: h.translate,
      settings: { partialSubtitles: false },
    });
    const path = await subPath();
    await new Promise((r) => setTimeout(r, 300));
    const text = await (await current.get(path)).text();
    expect(text).not.toContain('HE:Line 1');
    expect(text).toContain('מתרגם את הכתוביות');
    h.release();
  });

  it('does not show a part for a short file', async () => {
    const h = held();
    current = await start({ content: LONG, subWaitMs: 50, translate: h.translate }); // default minimum is 1000 lines
    const path = await subPath();
    await new Promise((r) => setTimeout(r, 300));
    const text = await (await current.get(path)).text();
    expect(text).not.toContain('HE:Line 1');
    h.release();
  });

  it('moves the part, and then the whole subtitle, when the late sound check finishes', async () => {
    const h = held();
    current = await start({
      content: LONG,
      subWaitMs: 50,
      limits: { ...LIMITS, syncWaitMs: 40 },
      translate: h.translate,
      findStream: async () => ({
        infoHash: 'a'.repeat(40),
        fileIdx: 0,
        url: 'http://127.0.0.1:11470/x/0',
        videoPath: 'Movie.2020.1080p.mkv',
        files: [],
      }),
      speechFit: async () => {
        await new Promise((r) => setTimeout(r, 300));
        return { scale: 1, offsetMs: 2000, score: 0.2, baseline: 0 };
      },
      candidates: [cand({ fileId: 7, language: 'en', downloadCount: 100 })],
    });
    const made = (await (
      await current.get('/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json')
    ).json()) as SubsResponse;
    const path = new URL(made.subtitles[0]!.url).pathname;
    const firstStart = (t: string) =>
      /(\d\d):(\d\d):(\d\d),(\d{3}) -->/.exec(t)?.slice(1).join(':');
    const early = await until(path, (t) => t.includes('HE:Line 1'));
    expect(firstStart(early)).toBe('00:00:00:000');
    const moved = await until(path, (t) => firstStart(t) === '00:00:02:000');
    expect(firstStart(moved)).toBe('00:00:02:000');
    expect(moved).toContain('HE:Line 4');
    expect(moved).not.toContain('HE:Line 12');
    h.release();
    const full = await until(
      path,
      (t) => t.includes('HE:Line 12') && firstStart(t) === '00:00:02:000',
    );
    expect(firstStart(full)).toBe('00:00:02:000');
  });

  it('gives both requests of the same episode the part', async () => {
    const h = held();
    current = await start({ content: LONG, subWaitMs: 50, limits: LIMITS, translate: h.translate });
    const a = await subPath();
    const b = new URL(
      (
        (await (
          await current.get('/subtitles/movie/tt0111161/filename=Other.2020.mkv.json')
        ).json()) as SubsResponse
      ).subtitles[0]!.url,
    ).pathname;
    expect(a).not.toBe(b);
    const [ta, tb] = await Promise.all([
      until(a, (t) => t.includes('HE:Line 1')),
      until(b, (t) => t.includes('HE:Line 1')),
    ]);
    expect(ta).toContain('HE:Line 4');
    expect(tb).toContain('HE:Line 4');
    h.release();
  });
});

describe('developer settings: sound check modes, next episode ahead, season packs, redo', () => {
  const tagged = (tag: string) => `1
00:00:01,000 --> 00:00:03,000
${tag}
`;
  const MOVIE_FILE = '/subtitles/movie/tt0111161/filename=Movie.2020.1080p.mkv.json';
  const stream = async () => ({
    infoHash: 'a'.repeat(40),
    fileIdx: 0,
    url: 'http://127.0.0.1:11470/x/0',
    videoPath: 'Movie.2020.1080p.mkv',
    files: [],
  });
  const episodePath = (h: Harness, season: number, episode: number, file?: string) =>
    `/subtitles/series/${encodeURIComponent(`tt0944947:${season}:${episode}`)}${file ? `/filename=${file}` : ''}.json`;
  const subUrl = async (h: Harness, path: string) =>
    new URL(((await (await h.get(path)).json()) as SubsResponse).subtitles[0]!.url).pathname;
  const waitFor = async (check: () => boolean | Promise<boolean>, ms = 4000) => {
    for (let i = 0; i < ms / 25 && !(await check()); i++)
      await new Promise((r) => setTimeout(r, 25));
    return check();
  };
  const post = (h: Harness, path: string, body: unknown) =>
    fetch(h.base + path, {
      method: 'POST',
      headers: { Host: h.host, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  interface Lib {
    items: { id: string; season?: number; episode?: number }[];
  }
  const library = async (h: Harness) => (await (await h.get('/api/library')).json()) as Lib;

  it('background mode: the translation does not wait for the sound check', async () => {
    let fitFinished = false;
    current = await start({
      subWaitMs: 50,
      settings: { soundCheck: 'background' },
      findStream: stream,
      speechFit: async () => {
        await new Promise((r) => setTimeout(r, 1500));
        fitFinished = true;
        return { scale: 1, offsetMs: 2000, score: 0.2, baseline: 0 };
      },
    });
    const path = await subUrl(current, MOVIE_FILE);
    const early = await waitFor(
      async () => (await (await current!.get(path)).text()).includes('HE:'),
      1200,
    );
    expect(early).toBe(true);
    expect(fitFinished).toBe(false); // translated while the check was still listening
    // ...and the check still moves the finished subtitle when it is done.
    const moved = await waitFor(
      async () =>
        (await (await current!.get(path)).text()).includes('00:00:03,000 --> 00:00:05,000'),
      4000,
    );
    expect(moved).toBe(true);
  });

  it('shows the background sound check on the main screen, and how it ended', async () => {
    type Status = {
      backgroundSync: { percent: number } | null;
      lastSync: { outcome: string; offsetMs?: number } | null;
    };
    const status = async () => (await (await current!.get('/api/status')).json()) as Status;
    current = await start({
      subWaitMs: 50,
      settings: { soundCheck: 'background' },
      findStream: stream,
      speechFit: async (o) => {
        o.onProgress?.(40);
        await new Promise((r) => setTimeout(r, 700));
        return { scale: 1, offsetMs: 2000, score: 0.2, baseline: 0 };
      },
    });
    const path = await subUrl(current, MOVIE_FILE);
    await current.get(path);
    const running = await waitFor(async () => (await status()).backgroundSync?.percent === 40);
    expect(running).toBe(true);
    expect((await status()).lastSync).toBeNull();
    const done = await waitFor(async () => (await status()).lastSync?.outcome === 'moved');
    expect(done).toBe(true);
    expect((await status()).lastSync?.offsetMs).toBe(2000);
    expect((await status()).backgroundSync).toBeNull();
  });

  it('tells the main screen which subtitle Stremio took, once a finished one is delivered', async () => {
    type Status = { lastDelivered: { title: string; via: string } | null };
    const status = async () => (await (await current!.get('/api/status')).json()) as Status;
    current = await start({ subWaitMs: 50, settings: { prefetchNext: false } });
    const path = await subUrl(current, episodePath(current, 1, 3));
    expect((await status()).lastDelivered).toBeNull();
    const ready = await waitFor(async () =>
      (await (await current!.get(path)).text()).includes('HE:'),
    );
    expect(ready).toBe(true);
    const shown = await waitFor(async () => (await status()).lastDelivered !== null);
    expect(shown).toBe(true);
  });

  it('lists where each subtitle came from, and whether it was translated', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false },
      candidates: [
        cand({ fileId: 1, language: 'en', provider: 'subdl' }),
        cand({ fileId: 2, language: 'he' }),
      ],
      contentFor: (c) => tagged(`From${c.fileId}`),
    });
    const path = await subUrl(current, MOVIE_FILE);
    await waitFor(async () => (await (await current!.get(path)).text()).includes('From'));
    await waitFor(async () => (await library(current!)).items.length > 0);
    const item = (await library(current)).items[0] as unknown as {
      source?: { provider: string; language: string; kind: string };
    };
    // A ready subtitle in the language wins over a translation, from OpenSubtitles here.
    expect(item.source).toEqual({ provider: 'opensubtitles', language: 'he', kind: 'direct' });
    expect(current.translator.calls).toBe(0);
  });

  it('translates from English even when a ready subtitle exists, when asked to', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false, preferTranslation: true },
      candidates: [
        cand({ fileId: 1, language: 'en', provider: 'subdl' }),
        cand({ fileId: 2, language: 'he' }),
      ],
      contentFor: (c) => tagged(`From${c.fileId}`),
    });
    const path = await subUrl(current, MOVIE_FILE);
    expect(
      await waitFor(async () => (await (await current!.get(path)).text()).includes('HE:From1')),
    ).toBe(true);
    await waitFor(async () => (await library(current!)).items.length > 0);
    const item = (await library(current)).items[0] as unknown as { source?: unknown };
    expect(item.source).toEqual({ provider: 'subdl', language: 'en', kind: 'translate' });
    expect(current.translator.calls).toBeGreaterThan(0);
  });

  it('says so when the background sound check is not sure', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { soundCheck: 'background' },
      findStream: stream,
      speechFit: async () => undefined,
    });
    await current.get(await subUrl(current, MOVIE_FILE));
    const kept = await waitFor(
      async () =>
        (
          (await (await current!.get('/api/status')).json()) as {
            lastSync: { outcome: string } | null;
          }
        ).lastSync?.outcome === 'kept',
    );
    expect(kept).toBe(true);
  });

  it('wait mode: the translation waits for the sound check; off: it is never started', async () => {
    let started = 0;
    current = await start({
      subWaitMs: 50,
      settings: { soundCheck: 'off' },
      findStream: stream,
      speechFit: async () => {
        started++;
        return undefined;
      },
    });
    const path = await subUrl(current, MOVIE_FILE);
    expect(
      await waitFor(async () => (await (await current!.get(path)).text()).includes('HE:')),
    ).toBe(true);
    expect(started).toBe(0);
  });

  it('translates the next episode ahead, once, and the real request then needs no new AI work', async () => {
    const asked: number[] = [];
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: true },
      onSearch: (q) => {
        asked.push(q.video.episode ?? 0);
        // Playing episode 4 starts episode 5 ahead; there is none, so it costs no AI work.
        if (q.video.episode === 5) throw new AppError('SOURCE_SUBTITLE_NOT_FOUND');
      },
      candidatesFor: (q) => [cand({ fileId: 500 + (q.video.episode ?? 0) })],
      contentFor: (c) => tagged(`Ep${c.fileId}`),
    });
    const three = await subUrl(current, episodePath(current, 1, 3, 'Show.S01E03.mkv'));
    await current.get(three);
    expect(await waitFor(() => asked.includes(4))).toBe(true);
    await waitFor(async () => (await library(current!)).items.some((e) => e.episode === 4));
    expect(asked).not.toContain(5); // one episode ahead, no chain
    const aiBefore = current.translator.calls;
    const downloadsBefore = current.downloads;
    const four = await subUrl(current, episodePath(current, 1, 4, 'Show.S01E04.mkv'));
    const text = await waitFor(async () =>
      (await (await current!.get(four)).text()).includes('HE:'),
    );
    expect(text).toBe(true);
    expect(current.translator.calls).toBe(aiBefore); // the translation was already there
    expect(current.downloads).toBe(downloadsBefore); // so was the downloaded subtitle
  });

  it('does not translate ahead when switched off, for a movie, or in ask mode; a failing next episode shows no error', async () => {
    const asked: number[] = [];
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false },
      onSearch: (q) => void asked.push(q.video.episode ?? 0),
    });
    await current.get(await subUrl(current, episodePath(current, 1, 3)));
    await new Promise((r) => setTimeout(r, 300));
    expect(asked).toEqual([3]);
    await current.close();

    asked.length = 0;
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: true },
      onSearch: (q) => void asked.push(q.video.episode ?? 0),
    });
    await current.get(await subUrl(current, MOVIE_FILE));
    await new Promise((r) => setTimeout(r, 300));
    expect(asked).toEqual([0]);
    await current.close();

    asked.length = 0;
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: true },
      onSearch: (q) => {
        asked.push(q.video.episode ?? 0);
        if (q.video.episode === 4) throw new AppError('SOURCE_SUBTITLE_NOT_FOUND');
      },
    });
    const three = await subUrl(current, episodePath(current, 1, 3));
    await current.get(three);
    await waitFor(() => asked.includes(4));
    await new Promise((r) => setTimeout(r, 200));
    const status = (await (await current.get('/api/status')).json()) as { lastFailed?: boolean };
    expect(status.lastFailed ?? false).toBe(false);
  });

  it('takes the right episode of a season pack, and does not mix episodes up in the saved copy', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false },
      candidatesFor: (q) => [
        cand({
          fileId: 900,
          provider: 'subdl',
          pack: true,
          season: 1,
          episode: q.video.episode ?? 0,
        }),
      ],
      contentFor: (c) => tagged(`Episode${c.episode}`),
    });
    const three = await subUrl(current, episodePath(current, 1, 3));
    const four = await subUrl(current, episodePath(current, 1, 4));
    const t3 = await waitFor(async () =>
      (await (await current!.get(three)).text()).includes('HE:'),
    );
    const t4 = await waitFor(async () => (await (await current!.get(four)).text()).includes('HE:'));
    expect(t3 && t4).toBe(true);
    expect(await (await current.get(three)).text()).toContain('Episode3');
    expect(await (await current.get(four)).text()).toContain('Episode4');
  });

  it('uses a single-episode file when the season pack has no file for the episode', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false },
      candidates: [
        cand({ fileId: 1, provider: 'subdl', providerRank: 0, pack: true, season: 1, episode: 3 }),
        cand({ fileId: 2, providerRank: 1 }),
      ],
      downloadError: (c) =>
        c.fileId === 1 ? new AppError('SOURCE_SUBTITLE_NOT_FOUND') : undefined,
      contentFor: (c) => tagged(`From${c.fileId}`),
    });
    const path = await subUrl(current, episodePath(current, 1, 3));
    const done = await waitFor(async () =>
      (await (await current!.get(path)).text()).includes('HE:'),
    );
    expect(done).toBe(true);
    expect(await (await current.get(path)).text()).toContain('From2');
  });

  it('redo: makes a saved subtitle again from one source only', async () => {
    current = await start({
      subWaitMs: 50,
      settings: { prefetchNext: false },
      candidates: [
        cand({ fileId: 1, provider: 'subdl', providerRank: 0 }),
        cand({ fileId: 2, providerRank: 1 }),
      ],
      contentFor: (c) => tagged(`From${c.fileId}`),
    });
    const path = await subUrl(current, MOVIE_FILE);
    await waitFor(async () => (await (await current!.get(path)).text()).includes('HE:'));
    expect(await (await current.get(path)).text()).toContain('From1'); // the better ranked source first
    const id = (await library(current)).items[0]!.id;
    const bad = await post(current, '/api/dev/redo', { id, source: 'jimaku' });
    expect(bad.status).toBe(400); // no Jimaku key saved
    expect((await post(current, '/api/dev/redo', { id: 'x', source: 'subdl' })).status).toBe(400);
    expect(
      (await post(current, '/api/dev/redo', { id: 'a'.repeat(32), source: 'opensubtitles' }))
        .status,
    ).toBe(409);
    const ok = await post(current, '/api/dev/redo', { id, source: 'opensubtitles' });
    expect(ok.status).toBe(200);
    const redone = await waitFor(async () =>
      (await (await current!.get(path)).text()).includes('From2'),
    );
    expect(redone).toBe(true);
  });
});
