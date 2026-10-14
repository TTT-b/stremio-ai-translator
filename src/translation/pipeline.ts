import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { chunkCues, type Chunk, type ChunkCue } from '../subtitles/chunk';
import { applyRtlFix } from '../subtitles/rtl';
import type { Cue, SubtitleFile } from '../subtitles/types';
import { assertSameStructure, findChunkProblems } from '../subtitles/validate';
import type { TokenUsage, TranslationProvider } from './provider';
import { withRetry } from './retry';

export interface PipelineOptions {
  targetLanguageCode: string;
  targetLanguageName: string;
  chunkSize: number;
  concurrency: number;
  /** Extra attempts when a chunk comes back invalid. */
  maxValidationRetries: number;
  /** Attempts for transient provider errors (429/5xx/timeouts). */
  maxTransientAttempts?: number;
  rtlFix: boolean;
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

async function translateOneChunk(
  chunk: Chunk,
  total: number,
  provider: TranslationProvider,
  opts: PipelineOptions,
): Promise<{ translations: ChunkCue[]; usage: TokenUsage }> {
  const log = opts.logger.child({ stage: 'CHUNK', chunk: `${chunk.number + 1}/${total}` });
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  const source: ChunkCue[] = chunk.cues.map((c) => ({ id: String(c.index), text: c.text }));
  const attempts = opts.maxValidationRetries + 1;
  let lastProblems: string[] = [];

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const started = Date.now();
    try {
      const result = await withRetry(
        () =>
          provider.translateChunk({
            targetLanguage: opts.targetLanguageName,
            targetLanguageCode: opts.targetLanguageCode,
            cues: source,
            context: chunk.context,
          }),
        {
          maxAttempts: opts.maxTransientAttempts ?? 4,
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

      const problems = findChunkProblems(chunk.cues, result.translations);
      if (problems.length === 0) {
        log.info(
          { durationMs: Date.now() - started, cues: chunk.cues.length, tokens: usage },
          'chunk translated',
        );
        return { translations: result.translations, usage };
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

  const results = await runPool(chunks, opts.concurrency, (chunk) =>
    translateOneChunk(chunk, chunks.length, provider, opts),
  );

  const byId = new Map<string, string>();
  const usage: TokenUsage = { inputTokens: 0, outputTokens: 0 };
  for (const r of results) {
    for (const t of r.translations) byId.set(t.id, t.text);
    usage.inputTokens += r.usage.inputTokens;
    usage.outputTokens += r.usage.outputTokens;
  }

  const cues: Cue[] = source.cues.map((c) => {
    let text = (byId.get(String(c.index)) ?? '').trim();
    if (opts.rtlFix) text = applyRtlFix(text);
    return { ...c, text };
  });
  assertSameStructure(source.cues, cues);

  opts.logger.info(
    { stage: 'ASSEMBLY', cues: cues.length, tokens: usage },
    'translation assembled',
  );
  return { file: { format: source.format, cues }, usage, chunks: chunks.length };
}
