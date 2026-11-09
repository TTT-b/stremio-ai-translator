import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { chunkCues, type Chunk, type ChunkCue } from '../subtitles/chunk';
import { applyRtlFix } from '../subtitles/rtl';
import type { Cue, SubtitleFile } from '../subtitles/types';
import {
  assertSameStructure,
  findChunkProblems,
  findBrokenWords,
  findDriftedLines,
  findSuspiciousLines,
  stripForeignScripts,
} from '../subtitles/validate';
import { namesForRequest, type GlossaryNames } from './glossary';
import type { TokenUsage, TranslateChunkResult, TranslationProvider } from './provider';
import { withRetry } from './retry';

/** Persists validated chunk translations so a failed job resumes instead of restarting. */
export type ChunkOutcome = { translations: ChunkCue[]; usage: TokenUsage };

export interface ChunkStore {
  get(key: string): ChunkCue[] | undefined;
  set(key: string, translations: ChunkCue[]): void;
  /** Key for one chunk: must include everything that can change its translation. */
  keyFor(chunk: Chunk): string;
  /** Chunks being translated right now, shared by all jobs of one manager. */
  inFlight?: Map<string, Promise<ChunkOutcome>>;
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
  /** Characters with a known gender ("Nisha: female"), sent with every request. */
  cast?: string[];
  /** Names of this series with the spelling earlier episodes used (see glossary.ts). */
  glossary?: GlossaryNames;
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
  /** Resolves when it is fine to send another part to the AI (the user may have paused). */
  waitWhilePaused?: () => Promise<void>;
  /** Called with +1 when a chunk starts waiting on a rate limit and -1 when it stops. */
  onRateLimitWait?: (delta: 1 | -1) => void;
  /** Called after each chunk with cues finished so far and the file's total. */
  onProgress?: (done: number, total: number) => void;
  /**
   * Called with the finished cues from the start of the file once at least `partialMinCues` of
   * them are done, and again each time that unbroken run grows. Never called for the whole file.
   * The text is exactly what the final result will hold for those cues.
   */
  onPartial?: (cues: Cue[]) => void;
  /** How many leading cues must be finished before `onPartial` is first called. */
  partialMinCues?: number;
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
/**
 * A per-minute limit clears within a minute or so; a provider that still refuses after this long
 * is not going to clear soon, and the job is then restarted later by the manager (finished parts
 * are kept), instead of sending request after request.
 */
const RATE_BUDGET_MS = 6 * 60_000;
/**
 * After a 429 the free tier's per-minute limit (about 10 requests) is known to be the bottleneck:
 * requests are then spaced at least this far apart for the rest of the job, so the limit is not hit
 * again. Not applied before the first 429, so a key without such a limit loses no speed.
 */
const LEARNED_GAP_MS = 6500;
/** A 5xx / timeout is waited out too, but a provider that stays down must not hold a job forever. */
const OVERLOAD_MAX_WAITS = 8;
/** The extra gap between requests never grows beyond this while the provider is pushing back. */
const THROTTLE_MAX_EXTRA_MS = 8000;
const THROTTLE_FIRST_EXTRA_MS = 1000;
/** After a push-back the parallel lanes shrink to one until this many requests in a row succeed. */
const CALM_SUCCESSES = 3;
/** How often a waiting lane looks again whether it may start. */
const LANE_RECHECK_MS = 1000;

/** A request cut by the user is asked again after this short pause. */
const KICK_RETRY_MS = 500;

const isKicked = (err: AppError): boolean => err.details['kicked'] === true;

const isBackoffError = (err: unknown): err is AppError =>
  isAppError(err) &&
  // A quota error (the day's limit or credits used up) is not waited out: nothing changes in minutes.
  (err.code === 'PROVIDER_RATE_LIMITED' || err.code === 'PROVIDER_TIMEOUT');

/**
 * Adaptive request pacing shared by all parallel lanes. While the provider is happy there is no
 * delay at all (only the optional base gap). A 429/5xx pauses every lane together and adds a small
 * gap between request starts; each later success halves that gap until it is gone again.
 */
interface Throttle {
  pace(): Promise<void>;
  onSuccess(): void;
  /** `rateLimited`: a 429 (the request limit), as opposed to an overloaded server. */
  onPressure(pauseMs: number, rateLimited?: boolean): void;
  /** While the provider pushes back only the first lane keeps going; the others wait. */
  canStart(lane: number): boolean;
}

function createThrottle(opts: PipelineOptions): Throttle {
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const base = Math.max(0, opts.requestGapMs ?? 0);
  let extra = 0;
  let nextSlot = 0;
  let cooldownUntil = 0;
  let pressured = false;
  let calmStreak = 0;
  let learnedGap = 0;
  return {
    async pace() {
      const now = Date.now();
      const start = Math.max(now, nextSlot, cooldownUntil);
      nextSlot = start + Math.max(base, learnedGap) + extra;
      if (start > now) await sleep(start - now);
    },
    onSuccess() {
      extra = extra < 500 ? 0 : Math.floor(extra / 2);
      calmStreak++;
      if (calmStreak >= CALM_SUCCESSES) pressured = false;
    },
    canStart(lane) {
      return !pressured || lane === 0;
    },
    onPressure(pauseMs, rateLimited = false) {
      if (rateLimited) learnedGap = LEARNED_GAP_MS;
      pressured = true;
      calmStreak = 0;
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
          {
            stage: 'API',
            attempt: n,
            delayMs: delay,
            errorCode: err.code,
            // Why the provider pushed back (HTTP status, error name): codes only, no text from the video.
            httpStatus: err.details['status'],
            errorName: err.details['errorName'],
            reason: err.message.slice(0, 120),
          },
          'provider pushed back, waiting to retry',
        );
        waited += delay;
        throttle.onPressure(delay, err.code === 'PROVIDER_RATE_LIMITED');
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

/** The glossary entries that occur in the lines of one request (nothing is sent when none do). */
function glossaryFor(
  opts: PipelineOptions,
  lines: readonly { text: string }[],
): { glossary?: string[] } {
  const list = namesForRequest(
    opts.glossary,
    lines.map((l) => l.text),
  );
  return list.length > 0 ? { glossary: list } : {};
}

/** Most lines one chunk may send back for a second look, and how many neighbours give context. */
const MAX_REPAIR_LINES = 40;
const REPAIR_NEIGHBOURS = 2;

/**
 * Quietly translate again the few lines that came back with a stray Latin word (for example "lad"
 * inside a Hebrew sentence). One extra request per chunk at most, never a loop: whatever comes
 * back is used only if it is clean, and any failure keeps the first translation.
 */
async function repairSuspiciousLines(
  chunk: Chunk,
  translations: ChunkCue[],
  provider: TranslationProvider,
  opts: PipelineOptions,
  throttle: Throttle,
  log: Logger,
  usage: TokenUsage,
  cutOut: ReadonlySet<string>,
): Promise<ChunkCue[]> {
  const ids = [
    ...new Set([
      ...findSuspiciousLines(chunk.cues, translations, opts.targetLanguageCode),
      ...findDriftedLines(chunk.cues, translations),
      ...findBrokenWords(translations, opts.targetLanguageCode),
      ...translations.filter((t) => cutOut.has(t.id)).map((t) => t.id),
    ]),
  ].slice(0, MAX_REPAIR_LINES);
  if (ids.length === 0 || opts.isCancelled?.()) return translations;
  const wanted = new Set(ids);
  const all = chunk.cues.map((c) => ({ id: String(c.index), text: c.text }));
  const redo = all.filter((c) => wanted.has(c.id));
  const near = new Set<number>();
  all.forEach((c, i) => {
    if (!wanted.has(c.id)) return;
    for (let k = i - REPAIR_NEIGHBOURS; k <= i + REPAIR_NEIGHBOURS; k++) near.add(k);
  });
  const around = all.filter((c, i) => near.has(i) && !wanted.has(c.id));
  try {
    await throttle.pace();
    const reply = await withKick(
      provider.translateChunk({
        targetLanguage: opts.targetLanguageName,
        targetLanguageCode: opts.targetLanguageCode,
        cues: redo,
        context: around,
        upcoming: [],
        ...(opts.cast?.length ? { cast: opts.cast } : {}),
        ...glossaryFor(opts, [...redo, ...around]),
      }),
      opts,
    );
    throttle.onSuccess();
    usage.inputTokens += reply.usage?.inputTokens ?? 0;
    usage.outputTokens += reply.usage?.outputTokens ?? 0;
    const fresh = stripForeignScripts(chunk.cues, reply.translations, opts.targetLanguageCode);
    const stillBad = new Set(findSuspiciousLines(chunk.cues, fresh, opts.targetLanguageCode));
    const better = new Map<string, string>();
    for (const t of fresh) {
      if (
        wanted.has(t.id) &&
        typeof t.text === 'string' &&
        t.text.trim() !== '' &&
        !stillBad.has(t.id)
      ) {
        better.set(t.id, t.text);
      }
    }
    log.info({ stage: 'VALIDATION', lines: ids.length, fixed: better.size }, 'repaired lines');
    if (better.size === 0) return translations;
    return translations.map((t) =>
      better.has(t.id) ? { ...t, text: better.get(t.id) as string } : t,
    );
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    log.warn(
      { stage: 'VALIDATION', lines: ids.length },
      'repair attempt failed, kept first result',
    );
    return translations;
  }
}

/** Lines per request on the last attempt, when the AI keeps failing the same way on a bigger one. */
const LAST_TRY_GROUP = 8;

/** A 4xx answer (a bad request) will not change by asking again. */
const isClientError = (err: AppError): boolean => {
  const status = err.details['status'];
  return typeof status === 'number' && status >= 400 && status < 500;
};

/** The lines cut into `n` runs of nearly equal size (one run when n <= 1). */
export function splitGroups<T>(items: T[], n: number): T[][] {
  const parts = Math.max(1, Math.min(n, items.length));
  const size = Math.ceil(items.length / parts);
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out.length > 0 ? out : [items];
}

/** Largest share of a chunk's lines that may stay untranslated when the AI keeps skipping them. */
const MAX_SKIPPED_SHARE = 0.25;

/** One request to one model, with the rate-limit wait and the transient-error retries around it. */
function askModel(
  model: TranslationProvider,
  sub: ChunkCue[],
  context: ChunkCue[],
  chunk: Chunk,
  opts: PipelineOptions,
  throttle: Throttle,
  log: Logger,
): Promise<TranslateChunkResult> {
  return withRetry(
    async () =>
      waitOutRateLimits(
        async () => {
          await throttle.pace();
          const reply = await withKick(
            model.translateChunk({
              targetLanguage: opts.targetLanguageName,
              targetLanguageCode: opts.targetLanguageCode,
              cues: sub,
              context,
              upcoming: chunk.upcoming,
              ...(opts.cast?.length ? { cast: opts.cast } : {}),
              ...glossaryFor(opts, [...sub, ...context, ...chunk.upcoming]),
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
      // A malformed answer is asked again by the attempt loop (smaller, not identical).
      shouldRetry: (e) =>
        !isBackoffError(e) && !(isAppError(e) && e.code === 'PROVIDER_RESPONSE_INVALID'),
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
}

/**
 * Last help before a skipped line would stay in the source language: the stronger model (when
 * there is one) gets the missing lines in small groups, then every line still missing alone.
 * Whatever it returns is added to `have`; a failure here only means the line is not rescued.
 */
async function rescueSkipped(
  chunk: Chunk,
  source: ChunkCue[],
  have: Map<string, string>,
  provider: TranslationProvider,
  opts: PipelineOptions,
  throttle: Throttle,
  log: Logger,
): Promise<void> {
  const rescuer = provider.rescueProvider?.() ?? provider;
  const accept = (reply: TranslateChunkResult, asked: ChunkCue[]): void => {
    const wanted = new Set(asked.map((c) => c.id));
    for (const t of reply.translations) {
      if (typeof t?.id !== 'string' || typeof t.text !== 'string') continue;
      if (!wanted.has(t.id) || have.has(t.id) || /```/.test(t.text) || t.text.trim() === '') {
        continue;
      }
      have.set(t.id, t.text);
    }
  };
  const run = async (asked: ChunkCue[]): Promise<void> => {
    if (opts.isCancelled?.()) throw new CancelledError();
    const nearby = source.filter(
      (c, i) =>
        have.has(c.id) && [-2, -1, 1, 2].some((k) => asked.some((a) => a.id === source[i + k]?.id)),
    );
    try {
      accept(
        await askModel(rescuer, asked, [...chunk.context, ...nearby], chunk, opts, throttle, log),
        asked,
      );
    } catch (err) {
      if (err instanceof CancelledError) throw err;
      log.warn(
        {
          stage: 'VALIDATION',
          lines: asked.length,
          errorCode: isAppError(err) ? err.code : 'UNKNOWN',
        },
        'rescue request failed',
      );
    }
  };
  for (const group of splitGroups(
    source.filter((c) => !have.has(c.id)),
    Math.ceil(source.filter((c) => !have.has(c.id)).length / LAST_TRY_GROUP),
  )) {
    if (group.length > 0) await run(group);
  }
  for (const line of source.filter((c) => !have.has(c.id))) await run([line]);
}

async function translateOneChunkNow(
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
  /** How many requests the lines still to do are split into (grows after a cut-off or a failure). */
  let splitInto = 1;

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

  // Lines that already came back fine are kept; a retry asks only for the missing or broken ones.
  const have = new Map<string, string>();
  /** Lines where a stray foreign letter was cut out; the word may now be short a letter. */
  const cutOut = new Set<string>();
  const sourceText = new Map(source.map((c) => [c.id, c.text]));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (opts.isCancelled?.()) throw new CancelledError();
    const started = Date.now();
    const todo = source.filter((c) => !have.has(c.id));
    const todoIds = new Set(todo.map((c) => c.id));
    const nearbyDone = source.filter(
      (c, i) =>
        !todoIds.has(c.id) && [-2, -1, 1, 2].some((k) => todoIds.has(source[i + k]?.id ?? '')),
    );
    try {
      const groups = splitGroups(todo, splitInto);
      const ask = (sub: ChunkCue[]): Promise<TranslateChunkResult> =>
        askModel(provider, sub, [...chunk.context, ...nearbyDone], chunk, opts, throttle, log);
      const replies: TranslateChunkResult[] = [];
      for (const group of groups) replies.push(await ask(group));
      const result: Required<TranslateChunkResult> = {
        translations: replies.flatMap((r) => r.translations),
        usage: {
          inputTokens: replies.reduce((n, r) => n + (r.usage?.inputTokens ?? 0), 0),
          outputTokens: replies.reduce((n, r) => n + (r.usage?.outputTokens ?? 0), 0),
        },
      };
      usage.inputTokens += result.usage.inputTokens;
      usage.outputTokens += result.usage.outputTokens;

      // Stray foreign-alphabet letters are removed, not retried (a retry of a big chunk is costly).
      const cleaned = stripForeignScripts(chunk.cues, result.translations, opts.targetLanguageCode);
      if (cleaned !== result.translations) {
        log.info({ stage: 'VALIDATION', attempt }, 'removed stray foreign-script letters');
        const before = new Map(result.translations.map((t) => [t.id, t.text]));
        for (const t of cleaned) if (before.get(t.id) !== t.text) cutOut.add(t.id);
      }
      for (const t of cleaned) {
        if (
          typeof t?.id !== 'string' ||
          typeof t.text !== 'string' ||
          !todoIds.has(t.id) ||
          have.has(t.id) ||
          /```/.test(t.text) ||
          (t.text.trim() === '' && (sourceText.get(t.id) ?? '').trim() !== '')
        ) {
          continue;
        }
        have.set(t.id, t.text);
      }
      const merged: ChunkCue[] = source
        .filter((c) => have.has(c.id))
        .map((c) => ({ id: c.id, text: have.get(c.id) as string }));
      const problems = findChunkProblems(chunk.cues, merged);
      if (problems.length === 0) {
        const repaired = await repairSuspiciousLines(
          chunk,
          merged,
          provider,
          opts,
          throttle,
          log,
          usage,
          cutOut,
        );
        if (opts.chunkStore && storeKey) {
          try {
            opts.chunkStore.set(storeKey, repaired);
          } catch {
            /* cache problems must not fail the translation */
          }
        }
        log.info(
          { durationMs: Date.now() - started, cues: chunk.cues.length, tokens: usage },
          'chunk translated',
        );
        return { translations: repaired, usage };
      }
      lastProblems = problems;
      // An identical request fails identically: the last attempt asks for the missing lines in small groups.
      if (attempt + 1 === attempts) {
        splitInto = Math.max(splitInto, Math.ceil(todo.length / LAST_TRY_GROUP));
      }
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
      if (
        isAppError(err) &&
        err.code === 'PROVIDER_RESPONSE_INVALID' &&
        attempt < attempts &&
        !isClientError(err)
      ) {
        lastProblems = [err.message];
        // The answer was cut off at the output limit: ask again for half as many lines per request.
        if (err.details['truncated'] === true) {
          splitInto = Math.min(todo.length, Math.max(2, splitInto * 2));
        }
        log.warn(
          { stage: 'VALIDATION', attempt, errorCode: err.code },
          'malformed response, retrying',
        );
        continue;
      }
      throw err;
    }
  }
  // The AI keeps skipping some lines: a stronger model, then one line at a time, gets them first.
  const onlyMissing = lastProblems.every((p) => p.startsWith('missing id '));
  if (onlyMissing && have.size < source.length) {
    const before = source.length - have.size;
    await rescueSkipped(chunk, source, have, provider, opts, throttle, log);
    log.info(
      { stage: 'VALIDATION', skipped: before, rescued: before - (source.length - have.size) },
      'lines the AI skipped were asked again one by one',
    );
  }
  // Still missing: keep their original text rather than lose the whole episode.
  const skipped = source.filter((c) => !have.has(c.id));
  if (
    onlyMissing &&
    skipped.length === 0 &&
    findChunkProblems(
      chunk.cues,
      source.map((c) => ({ id: c.id, text: have.get(c.id) as string })),
    ).length === 0
  ) {
    const rescued = source.map((c) => ({ id: c.id, text: have.get(c.id) as string }));
    saveChunk(opts, storeKey, rescued);
    return { translations: rescued, usage };
  }
  if (
    skipped.length > 0 &&
    onlyMissing &&
    skipped.length <= Math.floor(source.length * MAX_SKIPPED_SHARE)
  ) {
    log.warn(
      { stage: 'VALIDATION', skipped: skipped.length, ids: skipped.map((c) => c.id).slice(0, 10) },
      'AI kept skipping some lines, keeping their original text',
    );
    const filled: ChunkCue[] = source.map((c) => ({ id: c.id, text: have.get(c.id) ?? c.text }));
    // Remembered, so a retry of the episode does not pay again for the same stubborn lines.
    saveChunk(opts, storeKey, filled);
    return { translations: filled, usage };
  }
  throw new AppError('TRANSLATION_VALIDATION_FAILED', `chunk ${chunk.number + 1}/${total}`, {
    problems: lastProblems.slice(0, 10),
  });
}

/** Remember a finished chunk; a cache problem must never fail the translation. */
function saveChunk(opts: PipelineOptions, key: string | undefined, cues: ChunkCue[]): void {
  if (!opts.chunkStore || !key) return;
  try {
    opts.chunkStore.set(key, cues);
  } catch {
    /* ignore */
  }
}

async function translateOneChunk(
  chunk: Chunk,
  total: number,
  provider: TranslationProvider,
  opts: PipelineOptions,
  throttle: Throttle,
): Promise<ChunkOutcome> {
  const inFlight = opts.chunkStore?.inFlight;
  const key = inFlight ? opts.chunkStore?.keyFor(chunk) : undefined;
  if (inFlight && key) {
    const running = inFlight.get(key);
    if (running) {
      try {
        const shared = await running;
        return { translations: shared.translations, usage: { inputTokens: 0, outputTokens: 0 } };
      } catch {
        /* the other job failed or was cancelled: translate it here instead */
      }
    }
  }
  const mine = translateOneChunkNow(chunk, total, provider, opts, throttle);
  if (!inFlight || !key) return mine;
  inFlight.set(key, mine);
  try {
    return await mine;
  } finally {
    if (inFlight.get(key) === mine) inFlight.delete(key);
  }
}

/** Run `worker` over `items` with at most `limit` running at once; fails fast. */
export async function runPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>,
  /** Resolves when the given lane may take its next item; may keep it waiting. */
  gate?: (lane: number, stopped: () => boolean) => Promise<void>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  let failed: unknown;
  let hasFailed = false;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async (_, lane) => {
    // A lane with nothing left to take must not wait for its turn: a throttled lane would
    // otherwise wait forever after the last part was taken by another lane.
    while (!hasFailed && next < items.length) {
      await gate?.(lane, () => hasFailed || next >= items.length);
      if (hasFailed) return;
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

/** Hebrew vowel and cantillation marks (niqqud) look broken in players, so they are never kept. */
export function stripHebrewPoints(text: string): string {
  return text.replace(/[֑-ׇֽֿׁׂׅׄ]/g, '');
}

/**
 * Builds the output cues from the source cues and the translations by id: dual-subtitle layout
 * and the right-to-left fix. Timestamps and order come from the source.
 */
export function assembleCues(
  sourceCues: Cue[],
  byId: ReadonlyMap<string, string>,
  opts: Pick<PipelineOptions, 'dualSubtitles' | 'rtlFix'>,
): Cue[] {
  return sourceCues.map((c) => {
    let text = stripHebrewPoints(byId.get(String(c.index)) ?? '').trim();
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
  const finished = new Map<number, { translations: ChunkCue[] }>();
  let reportedCues = 0;
  const reportPartial = (): void => {
    if (!opts.onPartial) return;
    // The unbroken run of finished chunks from the start of the file.
    let runCues = 0;
    let next = 0;
    while (finished.has(next)) runCues += chunks[next++]?.cues.length ?? 0;
    if (runCues < (opts.partialMinCues ?? 0) || runCues <= reportedCues) return;
    if (runCues >= source.cues.length) return; // the whole file is the final result
    reportedCues = runCues;
    const byId = new Map<string, string>();
    for (let i = 0; i < next; i++) {
      for (const t of finished.get(i)?.translations ?? []) byId.set(t.id, t.text);
    }
    opts.onPartial(assembleCues(source.cues.slice(0, runCues), byId, opts));
  };
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const waitForLane = async (lane: number, stopped: () => boolean): Promise<void> => {
    while (!throttle.canStart(lane) && !stopped()) await sleep(LANE_RECHECK_MS);
  };
  const results = await runPool(
    chunks,
    opts.concurrency,
    async (chunk) => {
      await opts.waitWhilePaused?.();
      const r = await translateOneChunk(chunk, chunks.length, provider, opts, throttle);
      doneCues += chunk.cues.length;
      opts.onProgress?.(doneCues, source.cues.length);
      finished.set(chunk.number, r);
      reportPartial();
      return r;
    },
    waitForLane,
  );

  const byId = new Map<string, string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const r of results) {
    for (const t of r.translations) byId.set(t.id, t.text);
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
  }

  const cues = assembleCues(source.cues, byId, opts);
  assertSameStructure(source.cues, cues);

  opts.logger.info(
    { stage: 'ASSEMBLY', cues: cues.length, tokens: usage },
    'translation assembled',
  );
  return { file: { format: source.format, cues }, usage, chunks: chunks.length };
}
