import { isAppError } from '../errors';

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Return false to rethrow an error at once even though it is marked retryable. */
  shouldRetry?: (error: unknown) => boolean;
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Delay for the given 1-based failed attempt: exponential backoff with full jitter. */
export function backoffDelay(
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number,
): number {
  const ceiling = Math.min(maxMs, baseMs * 2 ** (attempt - 1));
  return Math.round(ceiling / 2 + (random() * ceiling) / 2);
}

/**
 * Run `fn`, retrying only errors that are AppErrors marked retryable.
 * Honors `retryAfterMs` (capped at maxDelayMs) when the provider supplied one.
 */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions): Promise<T> {
  const sleep = opts.sleep ?? defaultSleep;
  const random = opts.random ?? Math.random;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isAppError(err) || !err.retryable || attempt >= opts.maxAttempts) throw err;
      if (opts.shouldRetry && !opts.shouldRetry(err)) throw err;
      const delayMs =
        err.retryAfterMs !== undefined
          ? Math.min(err.retryAfterMs, opts.maxDelayMs)
          : backoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs, random);
      opts.onRetry?.({ attempt, delayMs, error: err });
      await sleep(delayMs);
    }
  }
}
