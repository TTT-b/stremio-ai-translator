import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { chunkCues, type Chunk, type ChunkCue } from '../subtitles/chunk';
import { applyRtlFix } from '../subtitles/rtl';
import type { Cue, SubtitleFile } from '../subtitles/types';
import { assertSameStructure, findChunkProblems, stripForeignScripts } from '../subtitles/validate';
import type { TokenUsage, TranslationProvider } from './provider';
import { withRetry } from './retry';

/** Persists validated chunk translations so a failed job resumes instead of restarting. */
export interface ChunkStore {
  get(key: string): ChunkCue[] | undefined;
  set(key: string, translations: ChunkCue[]): void;
  /** Key for one chunk: must include everything that can change its translation. */
  keyFor(chunk: Chunk): string;
}

/** Thrown when the user cancelled the job: the translation stops before its next request. */
export class CancelledError extends Error {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

export interface PipelineOptions {
  chunkStore?: ChunkStore;
  /** Checked before every request to the provider. */
  isCancelled?: () => boolean;
  targetLanguageCode: string;
  targetLanguageName: string;
  chunkSize: number;
  concurrency: number;
  /** Extra attempts when a chunk comes back invalid. */
  maxValidationRetries: number;
  /** Attempts for transient provider errors (429/5xx/timeouts). */
  maxTransientAttempts?: number;
  rtlFix: boolean;
  /** Keep the original text on top and put the translation directly below it. */
  dualSubtitles?: boolean;
  /** Minimum gap between the starts of two provider requests (free-tier friendly). */
  requestGapMs?: number;
  /** How long one chunk may keep waiting out rate limits / quota before the job fails. */
  rateLimitBudgetMs?: number;
  /**
   * Lets the user's "Continue" cut a request that is not being answered: the pipeline hands over a
   * function that fails the request at once (as a timeout, so it is asked again) and gets back a
   * function to call when the request ends.
   */
  registerKick?: (kick: () => void) => () => void;
  /** Called with +1 when a chunk starts waiting on a rate limit and -1 when it stops. */
  onRateLimitWait?: (delta: 1 | -1) => void;
  /** Called after each chunk with cues finished so far and the file's total. */
  onProgress?: (done: number, total: number) => void;
  logger: Logger;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
  /** Log dialogue text at debug level (LOG_DIALOGUE). */
  logDialogue?: boolean;
}

export interface PipelineResult {
  file: SubtitleFile;
  usage: TokenUsage;
  chunks: number;
}

const RATE_WAIT_BASE_MS = 5000;
const RATE_WAIT_MAX_MS = 60_000;
const RATE_BUDGET_MS = 20 * 60_000;
/** A 5xx / timeout is waited out too, but a provider that stays down must not hold a job forever. */
const OVERLOAD_MAX_WAITS = 8;
/** The extra gap between requests never grows beyond this while the provider is pushing back. */
const THROTTLE_MAX_EXTRA_MS = 8000;
const THROTTLE_FIRST_EXTRA_MS = 1000;

/** A request cut by the user is asked again after this short pause. */
const KICK_RETRY_MS = 500;

const isKicked = (err: AppError): boolean => err.details['kicked'] === true;

const isBackoffError = (err: unknown): err is AppError =>
  isAppError(err) &&
  (err.code === 'PROVIDER_RATE_LIMITED' ||
    err.code === 'PROVIDER_QUOTA_EXCEEDED' ||
    err.code === 'PROVIDER_TIMEOUT');

/**
 * Adaptive request pacing shared by all parallel lanes. While the provider is happy there is no
 * delay at all (only the optional base gap). A 429/5xx pauses every lane together and adds a small
 * gap between request starts; each later success halves that gap until it is gone again.
 */
interface Throttle {
  pace(): Promise<void>;
  onSuccess(): void;
  onPressure(pauseMs: number): void;
}

function createThrottle(opts: PipelineOptions): Throttle {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = Math.max(0, opts.requestGapMs ?? 0);
  let extra = 0;
  let nextSlot = 0;
  let cooldownUntil = 0;
  return {
    async pace() {
      const now = Date.now();
      const start = Math.max(now, nextSlot, cooldownUntil);
      nextSlot = start + base + extra;
      if (start > now) await sleep(start - now);
    },
    onSuccess() {
      extra = extra < 500 ? 0 : Math.floor(extra / 2);
    },
    onPressure(pauseMs) {
      cooldownUntil = Math.max(cooldownUntil, Date.now() + pauseMs);
      extra = Math.min(THROTTLE_MAX_EXTRA_MS, Math.max(extra * 2, THROTTLE_FIRST_EXTRA_MS));
    },
  };
}

/**
 * Rate limits, quota errors and provider overload (429, 5xx, timeouts) are waited out, never fatal
 * at once: pause with exponential backoff (5s, 10s, ... capped at 60s, or the provider's own
 * retry-after), tell the shared throttle so the other lanes slow down too, and ask again. Only after
 * the budget is spent does the original error reach the caller.
 */
async function waitOutRateLimits<T>(
  call: () => Promise<T>,
  opts: PipelineOptions,
  log: Logger,
  throttle: Throttle,
): Promise<T> {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const budget = opts.rateLimitBudgetMs ?? RATE_BUDGET_MS;
  let waited = 0;
  let waiting = false;
  try {
    for (let n = 1; ; n++) {
      try {
        return await call();
      } catch (err) {
        if (!isBackoffError(err)) throw err;
        if (err.code === 'PROVIDER_TIMEOUT' && n > OVERLOAD_MAX_WAITS) throw err;
        const hinted = err.retryAfterMs;
        const delay = isKicked(err)
          ? KICK_RETRY_MS
          : Math.min(
              RATE_WAIT_MAX_MS,
              Math.max(hinted ?? 0, RATE_WAIT_BASE_MS * 2 ** Math.min(n - 1, 4)),
            );
        if (waited + delay > budget) throw err;
        if (!waiting) {
          waiting = true;
          opts.onRateLimitWait?.(1);
        }
        log.warn(
          { stage: 'API', attempt: n, delayMs: delay, errorCode: err.code },
          'provider pushed back, waiting to retry',
        );
        waited += delay;
        throttle.onPressure(delay);
        await sleep(delay);
      }
    }
  } finally {
    if (waiting) opts.onRateLimitWait?.(-1);
  }
}

/** The request, but the user may cut it short (see registerKick). */
function withKick<T>(call: Promise<T>, opts: PipelineOptions): Promise<T> {
  const register = opts.registerKick;
  if (!register) return call;
  return new Promise<T>((resolve, reject) => {
    const stop = register(() => {
      stop();
      reject(new AppError('PROVIDER_TIMEOUT', 'restarted by the user', { kicked: true }));
    });
    call.then(
      (value) => {
        stop();
        resolve(value);
      },
      (error: unknown) => {
        stop();
        reject(error);
      },
    );
  });
}

async function translateOneChunk(
  chunk: Chunk,
  total: number,
  provider: TranslationProvider,
  opts: PipelineOptions,
  throttle: Throttle,
): Promise<{ translations: ChunkCue[]; usage: TokenUsage }> {
  const log = opts.logger.child({ stage: 'CHUNK', chunk: `${chunk.number + 1}/${total}` });
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const source: ChunkCue[] = chunk.cues.map((c) => ({ id: String(c.index), text: c.text }));
  const attempts = opts.maxValidationRetries + 1;
  let lastProblems: string[] = [];

  if (opts.isCancelled?.()) throw new CancelledError();
  const storeKey = opts.chunkStore?.keyFor(chunk);
  if (opts.chunkStore && storeKey) {
    const stored = opts.chunkStore.get(storeKey);
    if (stored) {
      const cleaned = stripForeignScripts(chunk.cues, stored, opts.targetLanguageCode);
      if (findChunkProblems(chunk.cues, cleaned).length === 0) {
        log.info({ cues: chunk.cues.length, resumed: true }, 'chunk restored from cache');
        return { translations: cleaned, usage };
      }
    }
  }

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.isCancelled?.()) throw new CancelledError();
    const started = Date.now();
    try {
      const result = await withRetry(
        async () =>
          waitOutRateLimits(
            async () => {
              await throttle.pace();
              const reply = await withKick(
                provider.translateChunk({
                  targetLanguage: opts.targetLanguageName,
                  targetLanguageCode: opts.targetLanguageCode,
                  cues: source,
                  context: chunk.context,
                  upcoming: chunk.upcoming,
                }),
                opts,
              );
              throttle.onSuccess();
              return reply;
            },
            opts,
            log,
            throttle,
          ),
        {
          maxAttempts: opts.maxTransientAttempts ?? 4,
          // Overload / rate limits were already waited out above; do not wait them out again.
          shouldRetry: (e) => !isBackoffError(e),
          baseDelayMs: opts.retryBaseDelayMs ?? 1000,
          maxDelayMs: opts.retryMaxDelayMs ?? 30_000,
          ...(opts.sleep ? { sleep: opts.sleep } : {}),
          onRetry: ({ attempt: a, delayMs, error }) =>
            log.warn(
              {
                stage: 'API',
                attempt: a,
                delayMs,
                errorCode: isAppError(error) ? error.code : 'UNKNOWN',
              },
              'transient provider error, retrying',
            ),
        },
      );
      usage.inputTokens += result.usage?.inputTokens ?? 0;
      usage.outputTokens += result.usage?.outputTokens ?? 0;

      // Stray foreign-alphabet letters are removed, not retried (a retry of a big chunk is costly).
      const cleaned = stripForeignScripts(chunk.cues, result.translations, opts.targetLanguageCode);
      if (cleaned !== result.translations) {
        log.info({ stage: 'VALIDATION', attempt }, 'removed stray foreign-script letters');
      }
      const problems = findChunkProblems(chunk.cues, cleaned);
      if (problems.length === 0) {
        if (opts.chunkStore && storeKey) {
          try {
            opts.chunkStore.set(storeKey, cleaned);
          } catch {
            /* cache problems must not fail the translation */
          }
        }
        log.info(
          { durationMs: Date.now() - started, cues: chunk.cues.length, tokens: usage },
          'chunk translated',
        );
        return { translations: cleaned, usage };
      }
      lastProblems = problems;
      log.warn(
        {
          stage: 'VALIDATION',
          attempt,
          problems: problems.slice(0, 5),
          problemCount: problems.length,
        },
        'chunk failed validation',
      );
    } catch (err) {
      // Malformed provider output is worth another attempt; anything else is final.
      if (isAppError(err) && err.code === 'PROVIDER_RESPONSE_INVALID' && attempt < attempts) {
        lastProblems = [err.message];
        log.warn(
          { stage: 'VALIDATION', attempt, errorCode: err.code },
          'malformed response, retrying',
        );
        continue;
      }
      throw err;
    }
  }
  throw new AppError('TRANSLATION_VALIDATION_FAILED', `chunk ${chunk.number + 1}/${total}`, {
    problems: lastProblems.slice(0, 10),
  });
}

/** Run `worker` over `items` with at most `limit` running at once; fails fast. */
async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown;
  let hasFailed = false;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!hasFailed) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i] as T);
      } catch (err) {
        if (!hasFailed) {
          hasFailed = true;
          failed = err;
        }
      }
    }
  });
  await Promise.all(lanes);
  if (hasFailed) throw failed;
  return results;
}

/** Translate a parsed subtitle file. Timestamps and cue order come from the source, never the AI. */
export async function translateSubtitle(
  source: SubtitleFile,
  provider: TranslationProvider,
  opts: PipelineOptions,
): Promise<PipelineResult> {
  const chunks = chunkCues(source.cues, opts.chunkSize);
  opts.logger.info(
    {
      stage: 'CHUNK',
      cues: source.cues.length,
      chunks: chunks.length,
      concurrency: opts.concurrency,
    },
    'starting translation',
  );

  const throttle = createThrottle(opts);
  let doneCues = 0;
  opts.onProgress?.(0, source.cues.length);
  const results = await runPool(chunks, opts.concurrency, async (chunk) => {
    const r = await translateOneChunk(chunk, chunks.length, provider, opts, throttle);
    doneCues += chunk.cues.length;
    opts.onProgress?.(doneCues, source.cues.length);
    return r;
  });

  const byId = new Map<string, string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const r of results) {
    for (const t of r.translations) byId.set(t.id, t.text);
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
  }

  const cues: Cue[] = source.cues.map((c) => {
    let text = (byId.get(String(c.index)) ?? '').trim();
    if (opts.dualSubtitles) {
      // Strictly two lines: original, "\n", translation. Inner line breaks are folded into
      // spaces so a multi-line cue cannot produce more (or blank) lines that players mis-render.
      const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').trim();
      const original = oneLine(c.text);
      let translated = oneLine(text);
      if (opts.rtlFix) translated = applyRtlFix(translated);
      text = translated === '' ? original : `${original}\n${translated}`;
    } else if (opts.rtlFix) {
      text = applyRtlFix(text);
    }
    return { ...c, text };
  });
  assertSameStructure(source.cues, cues);

  opts.logger.info(
    { stage: 'ASSEMBLY', cues: cues.length, tokens: usage },
    'translation assembled',
  );
  return { file: { format: source.format, cues }, usage, chunks: chunks.length };
}
