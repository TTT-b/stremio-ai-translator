import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import { AnthropicProvider, OpenAiProvider } from '../src/translation/httpProviders';
import { detectProvider } from '../src/translation/providers';

const KEY = 'sk-SECRETKEY1234567890';

const reply = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

interface Seen {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(respond: () => Response, seen: Seen[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    seen.push({
      url,
      headers: init.headers as Record<string, string>,
      body: JSON.parse(String(init.body)) as Record<string, unknown>,
    });
    return respond();
  }) as unknown as typeof fetch;
}

const req = {
  targetLanguage: 'Hebrew',
  targetLanguageCode: 'he',
  cues: [{ id: '1', text: 'Hi' }],
  context: [],
};

describe('provider auto-detection', () => {
  it('routes by key prefix', () => {
    expect(detectProvider(['AI', 'zaSyABC'].join(''))?.id).toBe('gemini');
    expect(detectProvider('sk-ant-api03-abc')?.id).toBe('anthropic');
    expect(detectProvider('sk-proj-abc')?.id).toBe('openai');
    expect(detectProvider('  sk-abc ')?.id).toBe('openai');
  });

  it('does not recognise anything else', () => {
    expect(detectProvider('')).toBeUndefined();
    expect(detectProvider('hello')).toBeUndefined();
    expect(detectProvider('AIz')).toBeUndefined();
  });

  it('is applied by the config loader', () => {
    const gem = loadConfig({ AI_API_KEY: 'AIzaX' });
    expect([gem.aiProvider, gem.aiModel]).toEqual(['gemini', 'gemini-3.5-flash-lite']);
    const ant = loadConfig({ AI_API_KEY: 'sk-ant-1' });
    expect(ant.aiProvider).toBe('anthropic');
    const oai = loadConfig({ AI_API_KEY: 'sk-1' });
    expect([oai.aiProvider, oai.aiModel]).toEqual(['openai', 'gpt-4o-mini']);
  });

  it('still reads the older GEMINI_API_KEY name, AI_API_KEY wins', () => {
    expect(loadConfig({ GEMINI_API_KEY: 'AIzaOLD' }).aiApiKey).toBe('AIzaOLD');
    expect(loadConfig({ GEMINI_API_KEY: 'AIzaOLD', AI_API_KEY: 'sk-new' }).aiApiKey).toBe('sk-new');
  });
});

describe('OpenAiProvider', () => {
  it('sends the key only as a bearer header and parses the reply', async () => {
    const seen: Seen[] = [];
    const p = new OpenAiProvider({
      apiKey: KEY,
      model: 'gpt-4o-mini',
      timeoutMs: 1000,
      fetchImpl: fakeFetch(
        () =>
          reply({
            choices: [{ message: { content: '{"translations":[{"id":"1","text":"שלום"}]}' } }],
            usage: { prompt_tokens: 5, completion_tokens: 3 },
          }),
        seen,
      ),
    });
    const r = await p.translateChunk(req);
    expect(r.translations).toEqual([{ id: '1', text: 'שלום' }]);
    expect(r.usage).toEqual({ inputTokens: 5, outputTokens: 3 });
    expect(seen[0]?.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(seen[0]?.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(seen[0]?.body.model).toBe('gpt-4o-mini');
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY);
  });

  it('maps HTTP failures to app errors', async () => {
    const make = (status: number, body: unknown = {}, h: Record<string, string> = {}) =>
      new OpenAiProvider({
        apiKey: KEY,
        model: 'm',
        timeoutMs: 1000,
        fetchImpl: fakeFetch(() => reply(body, status, h)),
      });
    await expect(make(401).translateChunk(req)).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
    await expect(
      make(429, { error: { code: 'insufficient_quota' } }).translateChunk(req),
    ).rejects.toMatchObject({ code: 'PROVIDER_QUOTA_EXCEEDED' });
    const limited = await make(429, {}, { 'retry-after': '3' })
      .translateChunk(req)
      .catch((e: unknown) => e);
    expect(limited).toMatchObject({ code: 'PROVIDER_RATE_LIMITED', retryAfterMs: 3000 });
    await expect(make(503).translateChunk(req)).rejects.toMatchObject({
      code: 'PROVIDER_TIMEOUT',
    });
  });

  it('never puts the key in an error message', async () => {
    const p = new OpenAiProvider({
      apiKey: KEY,
      model: 'm',
      timeoutMs: 1000,
      fetchImpl: fakeFetch(() => reply({ error: { message: `bad ${KEY}` } }, 401)),
    });
    const r = await p.testConnection();
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });
});

describe('AnthropicProvider', () => {
  it('uses the messages API with x-api-key and parses text blocks', async () => {
    const seen: Seen[] = [];
    const p = new AnthropicProvider({
      apiKey: 'sk-ant-SECRET',
      model: 'claude-haiku-5-5',
      timeoutMs: 1000,
      fetchImpl: fakeFetch(
        () =>
          reply({
            content: [{ type: 'text', text: '{"translations":[{"id":"1","text":"Hola"}]}' }],
            usage: { input_tokens: 7, output_tokens: 2 },
          }),
        seen,
      ),
    });
    const r = await p.translateChunk(req);
    expect(r.translations).toEqual([{ id: '1', text: 'Hola' }]);
    expect(r.usage).toEqual({ inputTokens: 7, outputTokens: 2 });
    expect(seen[0]?.url).toBe('https://api.anthropic.com/v1/messages');
    expect(seen[0]?.headers['x-api-key']).toBe('sk-ant-SECRET');
    expect(seen[0]?.headers['anthropic-version']).toBeTruthy();
    expect(typeof seen[0]?.body.system).toBe('string');
  });

  it('reports a missing key without calling the network', async () => {
    const p = new AnthropicProvider({
      apiKey: '',
      model: 'm',
      timeoutMs: 1000,
      fetchImpl: fakeFetch(() => {
        throw new Error('network must not be used');
      }),
    });
    expect(await p.testConnection()).toMatchObject({ ok: false, code: 'CONFIGURATION_INVALID' });
  });
});
