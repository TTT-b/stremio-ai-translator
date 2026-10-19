import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { isStremioInstallUrl } from '../src/electron/links';
import { verifyAiKey } from '../src/translation/verify';

type Answers = Record<string, number | 'throw'>;
type Asked = { url: string; headers: Record<string, string> }[];

function fakeFetch(answers: Answers, asked: Asked = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    asked.push({ url, headers: init.headers as Record<string, string> });
    const a = answers[new URL(url).host];
    if (a === 'throw' || a === undefined) throw new Error('fetch failed');
    return new Response('{}', { status: a });
  }) as unknown as typeof fetch;
}

const G = 'generativelanguage.googleapis.com';
const O = 'api.openai.com';
const A = 'api.anthropic.com';

describe('verifyAiKey', () => {
  it('finds the provider that answers 200, whatever the prefix', async () => {
    const r = await verifyAiKey('AQ.weird', fakeFetch({ [G]: 200, [O]: 401, [A]: 401 }));
    expect(r).toMatchObject({ ok: true, provider: { id: 'gemini' } });
  });

  it('keeps asking after 400/401/403 and stops at the first success', async () => {
    const asked: Asked = [];
    const r = await verifyAiKey('sk-ant-x', fakeFetch({ [A]: 200, [G]: 400, [O]: 401 }, asked));
    expect(r).toMatchObject({ ok: true, provider: { id: 'anthropic' } });
    expect(asked).toHaveLength(1); // the prefix hint is asked first
    const wrongHint = await verifyAiKey('sk-proj-x', fakeFetch({ [O]: 401, [A]: 200, [G]: 403 }));
    expect(wrongHint).toMatchObject({ ok: true, provider: { id: 'anthropic' } });
  });

  it('rejects when everyone says 400/401/403', async () => {
    expect(await verifyAiKey('nope', fakeFetch({ [G]: 400, [O]: 401, [A]: 403 }))).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('is "unreachable" (not "invalid") on network errors or 429/5xx', async () => {
    expect(await verifyAiKey('k', fakeFetch({ [G]: 'throw', [O]: 401, [A]: 401 }))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
    expect(await verifyAiKey('k', fakeFetch({ [G]: 429, [O]: 401, [A]: 401 }))).toEqual({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('puts the key only in headers, never in the URL', async () => {
    const asked: Asked = [];
    await verifyAiKey('SECRETKEYVALUE', fakeFetch({ [G]: 401, [O]: 401, [A]: 401 }, asked));
    expect(asked).toHaveLength(3);
    for (const a of asked) {
      expect(a.url).not.toContain('SECRETKEYVALUE');
      expect(JSON.stringify(a.headers)).toContain('SECRETKEYVALUE');
    }
  });

  it('treats an empty key as invalid without calling anyone', async () => {
    expect(await verifyAiKey('  ', fakeFetch({}))).toEqual({ ok: false, reason: 'invalid' });
  });
});

describe('saved provider wins over the prefix', () => {
  it('uses AI_PROVIDER when set', () => {
    const c = loadConfig({ AI_API_KEY: 'AQ.weird', AI_PROVIDER: 'gemini' });
    expect([c.aiProvider, c.aiModel]).toEqual(['gemini', 'gemini-3.5-flash-lite']);
    expect(loadConfig({ AI_API_KEY: 'sk-1', AI_PROVIDER: 'anthropic' }).aiProvider).toBe(
      'anthropic',
    );
  });
});

describe('isStremioInstallUrl', () => {
  it('allows only the local add-on manifest link', () => {
    expect(isStremioInstallUrl('stremio://127.0.0.1:7000/manifest.json')).toBe(true);
    expect(isStremioInstallUrl('stremio://evil.example/manifest.json')).toBe(false);
    expect(isStremioInstallUrl('stremio://127.0.0.1:7000/../x')).toBe(false);
    expect(isStremioInstallUrl('file:///C:/Windows/system32/calc.exe')).toBe(false);
    expect(isStremioInstallUrl('https://127.0.0.1:7000/manifest.json')).toBe(false);
  });
});
