import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@google/genai';
import { AppError } from '../src/errors';
import { parseSubtitle } from '../src/subtitles/parse';
import type { Cue } from '../src/subtitles/types';
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

/** A sleep stub that records the pause and moves the (faked) clock forward, like a real sleep. */
const clockSleep = (log: number[]) => async (ms: number) => {
  log.push(ms);
  vi.setSystemTime(Date.now() + ms);
};

describe('translateSubtitle', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

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

  describe('partial results', () => {
    const eight = {
      format: 'srt' as const,
      cues: Array.from({ length: 8 }, (_, i) => ({
        index: i + 1,
        startMs: i * 1000,
        endMs: i * 1000 + 800,
        text: `Line ${i + 1}`,
      })),
    };

    it('reports the leading cues once they reach the minimum, and again as they grow', async () => {
      const sizes: number[] = [];
      const r = await translateSubtitle(
        eight,
        new FakeProvider(),
        opts({
          concurrency: 1,
          partialMinCues: 2,
          onPartial: (cues) => sizes.push(cues.length),
        }),
      );
      expect(sizes).toEqual([2, 4, 6]); // the last step is the full result, not a partial
      expect(r.file.cues).toHaveLength(8);
    });

    it('does not report before the minimum is reached', async () => {
      const sizes: number[] = [];
      await translateSubtitle(
        eight,
        new FakeProvider(),
        opts({ concurrency: 1, partialMinCues: 5, onPartial: (cues) => sizes.push(cues.length) }),
      );
      expect(sizes).toEqual([6]);
    });

    it('only reports a run that starts at the first line, never a gap', async () => {
      const sizes: number[] = [];
      const seen: string[] = [];
      let releaseFirst: () => void = () => undefined;
      const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      const provider = new FakeProvider(async (req) => {
        if (req.cues[0]?.id === '1') await firstGate; // the first chunk ends last of the first three
        return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
      });
      await translateSubtitle(
        eight,
        provider,
        opts({
          concurrency: 3,
          partialMinCues: 2,
          onProgress: (done) => {
            if (done >= 4) releaseFirst(); // chunks 2 and 3 are finished
          },
          onPartial: (cues) => {
            sizes.push(cues.length);
            seen.push(cues[0]?.text ?? '');
          },
        }),
      );
      expect(sizes.every((n, i) => i === 0 || n > (sizes[i - 1] as number))).toBe(true);
      expect(sizes[0]).toBe(6); // chunks 2 and 3 finished first but were not reported alone
      expect(seen.every((t) => t === 'T:Line 1')).toBe(true);
    });

    it('gives the same text in the partial as in the final result, with the same timing', async () => {
      let partial: Cue[] = [];
      const r = await translateSubtitle(
        eight,
        new FakeProvider(),
        opts({
          concurrency: 1,
          dualSubtitles: true,
          rtlFix: true,
          partialMinCues: 2,
          onPartial: (cues) => {
            partial = cues;
          },
        }),
      );
      expect(partial.length).toBeGreaterThan(0);
      expect(partial).toEqual(r.file.cues.slice(0, partial.length));
    });

    it('is silent when no callback is given', async () => {
      const r = await translateSubtitle(eight, new FakeProvider(), opts({ partialMinCues: 2 }));
      expect(r.file.cues).toHaveLength(8);
    });
  });

  it('waits out rate limits and quota errors with growing pauses, then succeeds', async () => {
    const sleeps: number[] = [];
    const waits: number[] = [];
    const provider = new FakeProvider((req, n) => {
      if (n === 1) throw new AppError('PROVIDER_RATE_LIMITED');
      if (n === 2) throw new AppError('PROVIDER_QUOTA_EXCEEDED');
      return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
    });
    const r = await translateSubtitle(
      source,
      provider,
      opts({
        concurrency: 1,
        chunkSize: 100,
        sleep: clockSleep(sleeps),
        onRateLimitWait: (d) => waits.push(d),
      }),
    );
    expect(r.file.cues).toHaveLength(3);
    expect(sleeps.slice(0, 2)).toEqual([5000, 10000]);
    expect(waits.reduce((a, b) => a + b, 0)).toBe(0); // every wait was closed again
    expect(waits).toContain(1);
  });

  it('waits out a long run of 503 (overloaded) answers instead of failing the translation', async () => {
    const sleeps: number[] = [];
    const provider = new FakeProvider((req, n) => {
      if (n <= 5) throw new AppError('PROVIDER_TIMEOUT', 'HTTP 503');
      return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
    });
    const r = await translateSubtitle(
      source,
      provider,
      opts({
        concurrency: 1,
        chunkSize: 100,
        sleep: clockSleep(sleeps),
      }),
    );
    expect(r.file.cues).toHaveLength(3);
    expect(provider.calls).toBe(6);
    expect(sleeps.filter((ms) => ms >= 5000).slice(0, 5)).toEqual([
      5000, 10000, 20000, 40000, 60000,
    ]);
  });

  it('gives up on a provider that stays down after a bounded number of waits', async () => {
    const provider = new FakeProvider(() => {
      throw new AppError('PROVIDER_TIMEOUT', 'HTTP 503');
    });
    await expect(
      translateSubtitle(source, provider, opts({ concurrency: 1, chunkSize: 100 })),
    ).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(provider.calls).toBe(9); // first try + 8 waits, no second layer of retries
  });

  it('adds no delay at all while the provider answers normally', async () => {
    const sleeps: number[] = [];
    await translateSubtitle(
      source,
      new FakeProvider(),
      opts({
        chunkSize: 1,
        concurrency: 3,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
      }),
    );
    expect(sleeps).toEqual([]);
  });

  it('gives up with the original error once the wait budget is spent', async () => {
    const provider = new FakeProvider(() => {
      throw new AppError('PROVIDER_RATE_LIMITED');
    });
    await expect(
      translateSubtitle(
        source,
        provider,
        opts({ rateLimitBudgetMs: 12_000, sleep: async () => undefined }),
      ),
    ).rejects.toMatchObject({ code: 'PROVIDER_RATE_LIMITED' });
  });

  it('removes a stray Arabic letter inside Hebrew text without a retry', async () => {
    const provider = new FakeProvider((req) => ({
      translations: req.cues.map((c) => ({ id: c.id, text: '\u05E9\u05DC\u0645\u05D5\u05DD' })),
    }));
    const r = await translateSubtitle(source, provider, opts({ chunkSize: 100, concurrency: 1 }));
    expect(provider.calls).toBe(1);
    expect(r.file.cues.every((c) => c.text === '\u05E9\u05DC\u05D5\u05DD')).toBe(true);
  });

  it('sends the lines that follow a chunk as "upcoming" context', async () => {
    const seen: string[][] = [];
    const provider = new FakeProvider((req) => {
      seen.push((req.upcoming ?? []).map((c) => c.id));
      return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
    });
    await translateSubtitle(source, provider, opts({ chunkSize: 2, concurrency: 1 }));
    expect(seen).toEqual([['3'], []]);
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

  it('a request that is not answered is cut by a kick and asked again, finished parts kept', async () => {
    const kicks = new Set<() => void>();
    const provider = new FakeProvider(async (req, call) => {
      if (call === 1) return new Promise<never>(() => undefined); // the AI never answers the first request
      return { translations: req.cues.map((c) => ({ id: c.id, text: 'T:' + c.text })) };
    });
    const work = translateSubtitle(
      source,
      provider,
      opts({
        chunkSize: 100,
        concurrency: 1,
        registerKick: (cut) => {
          kicks.add(cut);
          return () => void kicks.delete(cut);
        },
      }),
    );
    for (let i = 0; i < 50 && kicks.size === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(kicks.size).toBe(1);
    for (const cut of [...kicks]) cut();
    const result = await work;
    expect(provider.calls).toBe(2);
    expect(result.file.cues).toHaveLength(source.cues.length);
    expect(kicks.size).toBe(0);
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
    const key = ['AI', 'zaSySECRETSECRETSECRETSECRET1234'].join('');
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
