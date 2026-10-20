import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { AppError } from '../src/errors';
import { PROVIDERS } from '../src/translation/providers';
import { createApp } from '../src/web/server';
import { FakeProvider, silentLogger } from './helpers';
import { createServer, request as httpRequest, type Server } from 'node:http';

const SECRET_KEY = 'AIzaSyFAKEKEYFAKEKEYFAKEKEYFAKEKEY12345';
const OS_PASSWORD = 'os-password-secret';

describe('local web server', () => {
  let server: Server;
  let base: string;
  let settingsPath: string;
  let hostHeader: string;
  let providerFailsWith: AppError | undefined;
  let freePort = 0;
  let stremioOpened = 0;
  let envPath: string;

  beforeAll(async () => {
    settingsPath = join(mkdtempSync(join(tmpdir(), 'settings-')), 'settings.json');
    // Pick a free port first so the server's Host allow-list matches the real address.
    freePort = await new Promise<number>((resolve) => {
      const probe = createServer().listen(0, '127.0.0.1', () => {
        const p = (probe.address() as AddressInfo).port;
        probe.close(() => resolve(p));
      });
    });
    const config = loadConfig({
      PORT: String(freePort),
      GEMINI_API_KEY: SECRET_KEY,
      OPENSUBTITLES_PASSWORD: OS_PASSWORD,
    });
    envPath = join(mkdtempSync(join(tmpdir(), 'env-')), '.env');
    writeFileSync(envPath, '# my settings\nPORT=7000\nGEMINI_API_KEY=old\n', 'utf8');
    const app = createApp({
      config,
      logger: silentLogger(),
      settingsPath,
      envPath,
      createSourceProvider: () => ({
        getProviderName: () => 'fake-source',
        testConnection: async () => ({
          ok: true,
          provider: 'fake-source',
          model: '-',
          message: 'ok',
        }),
        download: async () => ({ content: '', fileName: 'x.srt' }),
        search: async () => [
          {
            fileId: 7,
            language: 'en',
            fileName: 'x.srt',
            downloadCount: 5,
            rating: 8,
            hashMatch: false,
            hearingImpaired: false,
            machineTranslated: false,
          },
        ],
      }),
      // Stand-in for the providers' own answer: the key text decides who "accepts" it.
      openStremio: async () => {
        stremioOpened++;
        return { ok: true };
      },
      verifyAiKey: async (key) => {
        if (key.startsWith('offline')) return { ok: false, reason: 'unreachable' };
        if (key.startsWith('bad')) return { ok: false, reason: 'invalid' };
        const id = key.startsWith('sk-ant')
          ? 'anthropic'
          : key.startsWith('sk-')
            ? 'openai'
            : 'gemini';
        const provider = PROVIDERS.find((p) => p.id === id) as (typeof PROVIDERS)[number];
        return { ok: true, provider };
      },
      createProvider: () =>
        new FakeProvider(async (req) => {
          if (providerFailsWith) throw providerFailsWith;
          return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
        }),
    });
    await new Promise<void>((resolve) => {
      server = app.listen(freePort, '127.0.0.1', resolve);
    });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    hostHeader = `127.0.0.1:${freePort}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const get = (path: string, headers: Record<string, string> = {}) =>
    fetch(base + path, { headers: { Host: hostHeader, ...headers } });
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(base + path, {
      method: 'POST',
      headers: { Host: hostHeader, 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });

  it('serves the status page with security headers and no secrets', async () => {
    const res = await get('/');
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
    expect(html).toContain('מפתח API של ספק ה-AI');
    expect(html).toContain('Google Gemini'); // provider detected from the saved key
    expect(html).toContain(
      'https://web.stremio.com/#/addons?addon=http%3A%2F%2F127.0.0.1%3A' +
        hostHeader.split(':')[1] +
        '%2Fmanifest.json',
    );
    expect(html).not.toContain(SECRET_KEY);
    expect(html).not.toContain(OS_PASSWORD);
  });

  it('rejects unknown Host headers and foreign origins', async () => {
    // fetch() cannot override Host/Origin, so use a raw HTTP request.
    const raw = (method: string, path: string, headers: Record<string, string>) =>
      new Promise<number>((resolve, reject) => {
        const url = new URL(base);
        const req = httpRequest(
          { host: url.hostname, port: url.port, method, path, headers },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? 0);
          },
        );
        req.on('error', reject);
        req.end();
      });
    expect(await raw('GET', '/', { Host: 'evil.example:80' })).toBe(403);
    expect(
      await raw('POST', '/api/test/gemini', { Host: hostHeader, Origin: 'https://evil.example' }),
    ).toBe(403);
  });

  it('Test Gemini works through the provider', async () => {
    const res = await post('/api/test/gemini', {});
    expect(await res.json()).toMatchObject({ ok: true, provider: 'fake' });
  });

  it('Test OpenSubtitles goes through the source provider', async () => {
    const res = await post('/api/test/opensubtitles', {});
    expect(await res.json()).toMatchObject({ ok: true, provider: 'fake-source' });
  });

  it('saves keys to .env, keeps other lines, and never echoes the value', async () => {
    const newKey = 'AIzaSyNEWKEYNEWKEYNEWKEYNEWKEY123456';
    const res = await post('/api/keys', {
      aiApiKey: newKey,
      openSubtitlesPassword: "pa ss#word'x",
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(text).not.toContain(newKey);
    const env = readFileSync(envPath, 'utf8');
    expect(env).toContain('# my settings');
    expect(env).toContain('PORT=7000');
    expect(env).toContain(`AI_API_KEY=${newKey}`);
    expect(env).toContain("OPENSUBTITLES_PASSWORD=`pa ss#word'x`");
    // The status page now reports it as configured without showing it.
    const html = await (await get('/')).text();
    expect(html).not.toContain(newKey);
  });

  it('rejects a key no provider accepts and leaves .env untouched', async () => {
    const before = readFileSync(envPath, 'utf8');
    const res = await post('/api/keys', { aiApiKey: 'bad-key-123' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
    expect(readFileSync(envPath, 'utf8')).toBe(before);
  });

  it('does not save when the providers cannot be reached', async () => {
    const before = readFileSync(envPath, 'utf8');
    const res = await post('/api/keys', { aiApiKey: 'offline-key' });
    expect(res.status).toBe(503);
    expect(readFileSync(envPath, 'utf8')).toBe(before);
  });

  it('remembers which provider accepted the key, whatever its prefix', async () => {
    const res = await post('/api/keys', { aiApiKey: 'AQ.Ab8RN6FAKEKEYFAKEKEY' });
    expect(await res.json()).toMatchObject({ ok: true, provider: 'Google Gemini' });
    expect(readFileSync(envPath, 'utf8')).toContain('AI_PROVIDER=gemini');
    expect((await post('/api/keys', { aiApiKey: 'sk-ant-api03-FAKEFAKEFAKE' })).status).toBe(200);
    expect(readFileSync(envPath, 'utf8')).toContain('AI_PROVIDER=anthropic');
    expect((await post('/api/keys', { aiApiKey: 'sk-FAKEFAKEFAKE' })).status).toBe(200);
    const html = await (await get('/')).text();
    expect(html).toContain('OpenAI');
    expect(html).not.toContain('sk-FAKEFAKEFAKE');
  });

  it('reports live status and clears the translation cache', async () => {
    const before = (await (await get('/api/status')).json()) as { ok: boolean; state: string };
    expect(before.ok).toBe(true);
    expect(['waiting', 'idle', 'translating', 'error']).toContain(before.state);
    const res = await post('/api/cache/clear', {});
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('rejects unknown or empty key payloads', async () => {
    expect((await post('/api/keys', { evil: 'x' })).status).toBe(400);
    expect((await post('/api/keys', {})).status).toBe(400);
  });

  it('dev source-search reports the decision without downloading', async () => {
    const res = await get('/dev/source-search?type=movie&id=tt0111161');
    expect(await res.json()).toMatchObject({ ok: true, found: 1, decision: 'translate' });
    expect((await get('/dev/source-search?type=movie&id=nope')).status).toBe(400);
  });

  it('saves settings to settings.json and rejects invalid ones', async () => {
    const ok = await post('/api/settings', {
      targetLanguage: 'es',
      dualSubtitles: true,
    });
    expect(await ok.json()).toEqual({ ok: true });
    expect(JSON.parse(readFileSync(settingsPath, 'utf8'))).toMatchObject({
      targetLanguage: 'es',
      dualSubtitles: true,
    });
    expect(readFileSync(settingsPath, 'utf8')).not.toContain(SECRET_KEY);
    const bad = await post('/api/settings', { targetLanguage: '<script>' });
    expect(bad.status).toBe(400);
    await post('/api/settings', { targetLanguage: 'he', dualSubtitles: false });
  });

  it('dev route translates a posted SRT and preserves structure', async () => {
    const srt = readFileSync('tests/fixtures/sample.srt', 'utf8');
    const res = await fetch(`${base}/dev/translate`, {
      method: 'POST',
      headers: { Host: hostHeader, 'Content-Type': 'text/plain' },
      body: srt,
    });
    const text = await res.text();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/x-subrip');
    expect(text).toContain('00:00:03,500 --> 00:00:05,250');
    expect(text).toContain('T:Hello there.');
  });

  it('dev route returns a safe error when translation fails', async () => {
    providerFailsWith = new AppError('INVALID_API_KEY');
    const res = await fetch(`${base}/dev/translate`, {
      method: 'POST',
      headers: { Host: hostHeader, 'Content-Type': 'text/plain' },
      body: readFileSync('tests/fixtures/sample.srt', 'utf8'),
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toContain('INVALID_API_KEY');
    providerFailsWith = undefined;
  });

  it('Open Stremio starts the app through the launcher, and only for the local page', async () => {
    const res = await post('/api/open-stremio', {});
    expect(await res.json()).toEqual({ ok: true });
    expect(stremioOpened).toBe(1);
    const foreign = await post('/api/open-stremio', {}, { Origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(stremioOpened).toBe(1);
  });

  it('sample translation endpoint returns a preview', async () => {
    const body = (await (await post('/api/dev/sample', {})).json()) as {
      ok: boolean;
      preview: string;
    };
    expect(body.ok).toBe(true);
    expect(body.preview.trim().length).toBeGreaterThan(0);
    expect(body.preview).not.toContain('-->'); // plain lines, not the raw SRT
    expect(body.preview).not.toContain('<i>');
  });
});
