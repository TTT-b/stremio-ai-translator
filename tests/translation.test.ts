import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { AppError } from '../src/errors';
import { parseSubtitle } from '../src/subtitles/parse';
import {
  GeminiProvider,
  parseModelJson,
  parseRetryAfterMs,
  type GeminiClientLike,
} from '../src/translation/gemini';
import { translateSubtitle, type PipelineOptions } from '../src/translation/pipeline';
import { backoffDelay, withRetry } from '../src/translation/retry';
import { FakeProvider, silentLogger } from './helpers';

const source = parseSubtitle(readFileSync('tests/fixtures/sample.srt', 'utf8'));

const opts = (over: Partial<PipelineOptions> = {}): PipelineOptions => ({
  targetLanguageCode: 'he',
  targetLanguageName: 'Hebrew',
  chunkSize: 2,
  concurrency: 2,
  maxValidationRetries: 2,
  rtlFix: false,
  logger: silentLogger(),
  sleep: async () => {},
  ...over,
});

describe('translateSubtitle', () => {
  it('translates all cues and keeps timestamps and count', async () => {
    const provider = new FakeProvider();
    const r = await translateSubtitle(source, provider, opts());
    expect(provider.calls).toBe(2);
    expect(r.file.cues).toHaveLength(3);
    expect(r.file.cues.map((c) => [c.startMs, c.endMs])).toEqual(
      source.cues.map((c) => [c.startMs, c.endMs]),
    );
    expect(r.file.cues[0]?.text).toBe('T:Hello there.');
  });

  it('dual mode keeps the original on top and the translation directly below', async () => {
    const r = await translateSubtitle(source, new FakeProvider(), opts({ dualSubtitles: true }));
    expect(r.file.cues[0]?.text).toBe('Hello there.\nT:Hello there.');
    expect(r.file.cues).toHaveLength(3);
    expect(r.file.cues.map((c) => [c.startMs, c.endMs])).toEqual(
      source.cues.map((c) => [c.startMs, c.endMs]),
    );
  });

  it('dual mode is exactly two lines even for multi-line cues, with RTL marks on line 2 only', async () => {
    const multi = {
      format: 'srt' as const,
      cues: [{ index: 1, startMs: 0, endMs: 1000, text: 'Hi there,\nfriend.' }],
    };
    const provider = new FakeProvider((req) => ({
      translations: req.cues.map((c) => ({ id: c.id, text: 'שלום\nחבר.' })),
    }));
    const r = await translateSubtitle(multi, provider, opts({ dualSubtitles: true, rtlFix: true }));
    const lines = (r.file.cues[0]?.text ?? '').split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Hi there, friend.');
    expect(lines[1]).toBe('‏שלום חבר.‏');
  });

  it('reports progress as cues finish', async () => {
    const seen: [number, number][] = [];
    await translateSubtitle(
      source,
      new FakeProvider(),
      opts({ onProgress: (d, t) => seen.push([d, t]) }),
    );
    expect(seen[0]).toEqual([0, 3]);
    expect(seen[seen.length - 1]).toEqual([3, 3]);
  });

  it('retries an invalid chunk then succeeds', async () => {
    const provider = new FakeProvider((req, n) =>
      n === 1
        ? { translations: [] } // missing everything
        : { translations: req.cues.map((c) => ({ id: c.id, text: `ok:${c.text}` })) },
    );
    const r = await translateSubtitle(source, provider, opts({ chunkSize: 10 }));
    expect(provider.calls).toBe(2);
    expect(r.file.cues[0]?.text).toBe('ok:Hello there.');
  });

  it('fails clearly when a chunk stays invalid (no corrupted output)', async () => {
    const provider = new FakeProvider(() => ({ translations: [{ id: '1', text: 'x' }] }));
    await expect(
      translateSubtitle(source, provider, opts({ chunkSize: 10, maxValidationRetries: 1 })),
    ).rejects.toMatchObject({
      code: 'TRANSLATION_VALIDATION_FAILED',
    });
    expect(provider.calls).toBe(2);
  });

  it('retries transient errors but not invalid-key errors', async () => {
    const flaky = new FakeProvider((req, n) => {
      if (n < 3) throw new AppError('PROVIDER_RATE_LIMITED');
      return { translations: req.cues.map((c) => ({ id: c.id, text: 'x' })) };
    });
    await translateSubtitle(source, flaky, opts({ chunkSize: 10 }));
    expect(flaky.calls).toBe(3);

    const badKey = new FakeProvider(() => {
      throw new AppError('INVALID_API_KEY');
    });
    await expect(translateSubtitle(source, badKey, opts({ chunkSize: 10 }))).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
    expect(badKey.calls).toBe(1);
  });

  it('respects the concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const provider = new FakeProvider(async (req) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 10));
      active--;
      return { translations: req.cues.map((c) => ({ id: c.id, text: 'x' })) };
    });
    await translateSubtitle(source, provider, opts({ chunkSize: 1, concurrency: 2 }));
    expect(peak).toBe(2);
  });

  it('resumes from stored chunks after a failure instead of starting over', async () => {
    const store = new Map<string, { id: string; text: string }[]>();
    const chunkStore = {
      keyFor: (c: { cues: { index: number }[] }) => c.cues.map((x) => x.index).join(','),
      get: (k: string) => store.get(k),
      set: (k: string, v: { id: string; text: string }[]) => void store.set(k, v),
    };
    // chunkSize 1 -> 3 chunks, sequential. The second chunk fails hard on the first run.
    const failing = new FakeProvider((req) => {
      if (req.cues[0]?.id === '2') throw new AppError('INVALID_API_KEY');
      return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
    });
    await expect(
      translateSubtitle(source, failing, opts({ chunkSize: 1, concurrency: 1, chunkStore })),
    ).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
    expect(store.size).toBe(1);

    const healthy = new FakeProvider();
    const r = await translateSubtitle(
      source,
      healthy,
      opts({ chunkSize: 1, concurrency: 1, chunkStore }),
    );
    expect(healthy.calls).toBe(2); // chunk 1 restored from the store
    expect(r.file.cues).toHaveLength(3);
  });

  it('applies the RTL fix only when enabled', async () => {
    const r = await translateSubtitle(source, new FakeProvider(), opts({ rtlFix: true }));
    expect(r.file.cues[0]?.text.startsWith('‏')).toBe(true);
  });
});

describe('withRetry / backoff', () => {
  it('stops after maxAttempts', async () => {
    const fn = vi.fn(async () => {
      throw new AppError('PROVIDER_TIMEOUT');
    });
    await expect(
      withRetry(fn, { maxAttempts: 3, baseDelayMs: 1, maxDelayMs: 5, sleep: async () => {} }),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('uses retryAfterMs and caps it', async () => {
    const delays: number[] = [];
    let n = 0;
    await withRetry(
      async () => {
        if (n++ === 0) {
          const e = new AppError('PROVIDER_RATE_LIMITED');
          e.retryAfterMs = 99_999;
          throw e;
        }
        return 'ok';
      },
      {
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 500,
        sleep: async (ms) => void delays.push(ms),
      },
    );
    expect(delays).toEqual([500]);
  });

  it('backoff grows and stays within the cap', () => {
    const r = () => 1;
    expect(backoffDelay(1, 100, 1000, r)).toBe(100);
    expect(backoffDelay(3, 100, 1000, r)).toBe(400);
    expect(backoffDelay(10, 100, 1000, r)).toBe(1000);
  });
});

describe('GeminiProvider', () => {
  const apiError = (status: number, message: string) => new ApiError({ status, message });
  const providerWith = (client: GeminiClientLike, apiKey = 'k') =>
    new GeminiProvider({ apiKey, model: 'm', timeoutMs: 1000, client });
  const throwing = (err: unknown): GeminiClientLike => ({
    models: {
      generateContent: async () => {
        throw err;
      },
    },
  });

  it('normalizes provider errors', () => {
    const p = providerWith(throwing(null));
    expect(
      p.normalizeError(apiError(400, 'API key not valid. Please pass a valid API key.')).code,
    ).toBe('INVALID_API_KEY');
    expect(p.normalizeError(apiError(403, 'forbidden')).code).toBe('INVALID_API_KEY');
    expect(p.normalizeError(apiError(404, 'model not found')).code).toBe(
      'PROVIDER_MODEL_UNAVAILABLE',
    );
    const rl = p.normalizeError(apiError(429, 'Resource exhausted. Please retry in 12.5s'));
    expect(rl.code).toBe('PROVIDER_RATE_LIMITED');
    expect(rl.retryable).toBe(true);
    expect(rl.retryAfterMs).toBe(12_500);
    expect(p.normalizeError(apiError(429, 'You exceeded your current quota, per day')).code).toBe(
      'PROVIDER_QUOTA_EXCEEDED',
    );
    const credits = p.normalizeError(apiError(402, 'Your prepayment credits are depleted.'));
    expect(credits.code).toBe('PROVIDER_QUOTA_EXCEEDED');
    expect(credits.retryable).toBe(false);
    const gone = p.normalizeError(apiError(404, 'This model is no longer available to new users.'));
    expect(gone.code).toBe('PROVIDER_MODEL_UNAVAILABLE');
    expect(gone.message).toContain('not available to this key');
    expect(p.normalizeError(apiError(503, 'overloaded')).code).toBe('PROVIDER_TIMEOUT');
    expect(p.normalizeError(Object.assign(new Error('x'), { name: 'AbortError' })).code).toBe(
      'PROVIDER_TIMEOUT',
    );
    expect(p.normalizeError(new Error('fetch failed')).code).toBe('PROVIDER_TIMEOUT');
  });

  it('error messages never contain the API key', () => {
    const key = 'AIzaSySECRETSECRETSECRETSECRET1234';
    const p = providerWith(throwing(null), key);
    const e = p.normalizeError(apiError(400, `API key not valid: ${key}`));
    expect(e.message).not.toContain(key);
  });

  it('testConnection reports success and failure', async () => {
    const ok = await providerWith({
      models: { generateContent: async () => ({ text: 'ok' }) },
    }).testConnection();
    expect(ok.ok).toBe(true);
    const bad = await providerWith(throwing(apiError(401, 'bad'))).testConnection();
    expect(bad).toMatchObject({ ok: false, code: 'INVALID_API_KEY' });
    const none = await providerWith(throwing(null), '').testConnection();
    expect(none).toMatchObject({ ok: false, code: 'CONFIGURATION_INVALID' });
  });

  it('translateChunk parses structured JSON and reports usage', async () => {
    const p = providerWith({
      models: {
        generateContent: async () => ({
          text: JSON.stringify({ translations: [{ id: '1', text: 'שלום' }] }),
          usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
        }),
      },
    });
    const r = await p.translateChunk({
      targetLanguage: 'Hebrew',
      targetLanguageCode: 'he',
      cues: [{ id: '1', text: 'Hello' }],
      context: [],
    });
    expect(r.translations).toEqual([{ id: '1', text: 'שלום' }]);
    expect(r.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it('malformed JSON becomes PROVIDER_RESPONSE_INVALID', async () => {
    const p = providerWith({
      models: { generateContent: async () => ({ text: 'Sure! Here you go' }) },
    });
    await expect(
      p.translateChunk({
        targetLanguage: 'Hebrew',
        targetLanguageCode: 'he',
        cues: [],
        context: [],
      }),
    ).rejects.toMatchObject({ code: 'PROVIDER_RESPONSE_INVALID' });
  });

  it('parse helpers', () => {
    expect(parseRetryAfterMs('please retry in 3s')).toBe(3000);
    expect(parseRetryAfterMs('"retryDelay": "7s"')).toBe(7000);
    expect(parseRetryAfterMs('nothing')).toBeUndefined();
    expect(parseModelJson('```json\n{"translations":[]}\n```').translations).toEqual([]);
    expect(() => parseModelJson('{"translations":"no"}')).toThrow(AppError);
  });
});
