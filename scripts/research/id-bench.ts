/**
 * Research: measures how often the AI sends back every line id it was asked for ("missing id"),
 * on a real subtitle file and the real provider, through the app's own pipeline.
 *
 *   npx tsx scripts/research/id-bench.ts --file=data/research/inc-brrip.srt [--chunk=80]
 *       [--limit=1500] [--concurrency=4] [--model=...] [--out=result.json]
 *
 * RESEARCH_ENV may point at the .env to read. Keys are used, never printed. No dialogue is
 * printed or saved: only ids and counts. Nothing is cached on disk.
 */
import { GoogleGenAI } from '@google/genai';
import { config as loadEnv } from 'dotenv';
import { readFileSync, writeFileSync } from 'node:fs';
import pino from 'pino';
import { loadConfig } from '../../src/config/env';
import { findLanguage } from '../../src/config/languages';
import { isAppError } from '../../src/errors';
import { cleanSubtitle } from '../../src/subtitles/clean';
import { parseSubtitle } from '../../src/subtitles/parse';
import { ModelFallbackProvider } from '../../src/translation/fallback';
import { GeminiProvider, type GeminiClientLike } from '../../src/translation/gemini';
import { translateSubtitle } from '../../src/translation/pipeline';
import type {
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from '../../src/translation/provider';
import { GEMINI_FALLBACKS } from '../../src/translation/providers';

loadEnv({ path: process.env['RESEARCH_ENV'] ?? '.env', quiet: true });

const flag = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

interface Call {
  model: string;
  asked: number;
  /** Asked ids that came back exactly once. */
  good: number;
  missing: number;
  duplicate: number;
  unknown: number;
  empty: number;
  error?: string;
  ms: number;
  missingIds?: string[];
}

const calls: Call[] = [];

/** Why each answer of the model ended (STOP, MAX_TOKENS, ...) and how long it was: codes and counts only. */
const endings: { model: string; finish: string; outTokens: number; chars: number }[] = [];

/** The real client, with a note taken of how every answer ended. */
function watchedClient(apiKey: string, timeoutMs: number): GeminiClientLike {
  const real = new GoogleGenAI({ apiKey, httpOptions: { timeout: timeoutMs } });
  return {
    models: {
      async generateContent(params) {
        const res = await real.models.generateContent(params);
        endings.push({
          model: params.model,
          finish: String(res.candidates?.[0]?.finishReason ?? 'none'),
          outTokens: res.usageMetadata?.candidatesTokenCount ?? 0,
          chars: (res.text ?? '').length,
        });
        return res;
      },
    },
  };
}

/** Counts what every single request returns; changes nothing. */
function counting(inner: TranslationProvider, model: string): TranslationProvider {
  return {
    testConnection: () => inner.testConnection(),
    getProviderName: () => inner.getProviderName(),
    getModelInformation: () => inner.getModelInformation(),
    normalizeError: (e) => inner.normalizeError(e),
    async translateChunk(req: TranslateChunkRequest): Promise<TranslateChunkResult> {
      const started = Date.now();
      const base = { model, asked: req.cues.length, ms: 0 };
      try {
        const reply = await inner.translateChunk(req);
        const asked = new Set(req.cues.map((c) => c.id));
        const seen = new Map<string, number>();
        let unknown = 0;
        let empty = 0;
        for (const t of reply.translations) {
          if (!asked.has(t.id)) unknown++;
          else seen.set(t.id, (seen.get(t.id) ?? 0) + 1);
          if (t.text.trim() === '') empty++;
        }
        const missingIds = [...asked].filter((id) => !seen.has(id));
        calls.push({
          ...base,
          ms: Date.now() - started,
          good: [...seen.values()].filter((n) => n === 1).length,
          missing: missingIds.length,
          duplicate: [...seen.values()].filter((n) => n > 1).length,
          unknown,
          empty,
          ...(missingIds.length ? { missingIds: missingIds.slice(0, 30) } : {}),
        });
        return reply;
      } catch (err) {
        calls.push({
          ...base,
          ms: Date.now() - started,
          good: 0,
          missing: 0,
          duplicate: 0,
          unknown: 0,
          empty: 0,
          error: isAppError(err)
            ? `${err.code}${err.details['truncated'] ? ':cut-off' : ''}`
            : 'UNKNOWN',
        });
        throw err;
      }
    },
  };
}

async function main(): Promise<void> {
  const path = flag('file');
  if (!path) throw new Error('--file=... is required');
  const config = loadConfig();
  const model = flag('model') ?? config.aiModel;
  const chunkSize = Number(flag('chunk') ?? 80);
  const limit = Number(flag('limit') ?? 1800);
  const parsed = cleanSubtitle(parseSubtitle(readFileSync(path, 'utf8')));
  const source = { ...parsed, cues: parsed.cues.slice(0, limit) };
  const language = findLanguage(config.targetLanguage);
  if (!language) throw new Error('unknown target language');

  const events = new Map<string, number>();
  const logger = pino(
    { level: 'info' },
    {
      write(line: string): void {
        try {
          const msg = (JSON.parse(line) as { msg?: string }).msg ?? '';
          events.set(msg, (events.get(msg) ?? 0) + 1);
        } catch {
          /* not a log line */
        }
      },
    },
  );
  const opts = {
    apiKey: config.aiApiKey,
    model,
    timeoutMs: config.aiTimeoutMs,
    client: watchedClient(config.aiApiKey, config.aiTimeoutMs),
  };
  // --no-switch keeps every request on the one model, to measure that model alone.
  const chain = process.argv.includes('--no-switch')
    ? [model]
    : [model, ...GEMINI_FALLBACKS.filter((m) => m !== model)];
  const provider = new ModelFallbackProvider(chain, (m) =>
    counting(new GeminiProvider({ ...opts, model: m }), m),
  );

  const started = Date.now();
  let outcome = 'ok';
  let untranslated = 0;
  try {
    const result = await translateSubtitle(source, provider, {
      targetLanguageCode: language.code,
      targetLanguageName: language.name,
      chunkSize,
      concurrency: Number(flag('concurrency') ?? 4),
      maxValidationRetries: 2,
      rtlFix: false,
      logger,
    });
    // A line that still has no Hebrew letter although its source has letters was not translated.
    untranslated = result.file.cues.filter(
      (c, i) =>
        /\p{L}/u.test((source.cues[i] as { text: string }).text) &&
        !/\p{Script=Hebrew}/u.test(c.text),
    ).length;
  } catch (err) {
    outcome = isAppError(err) ? err.code : 'UNKNOWN';
  }

  const ok = calls.filter((c) => !c.error);
  const first = ok.filter((c) => c.asked >= Math.min(chunkSize, 20));
  const sum = (list: Call[], k: 'asked' | 'good' | 'missing' | 'duplicate' | 'unknown'): number =>
    list.reduce((n, c) => n + c[k], 0);
  const summary = {
    file: path.replace(/^.*[\\/]/, ''),
    model,
    chunkSize,
    lines: source.cues.length,
    outcome,
    seconds: Math.round((Date.now() - started) / 1000),
    requests: calls.length,
    requestErrors: calls.filter((c) => c.error).map((c) => c.error),
    fullRequests: first.length,
    fullRequestsWithAllIds: first.filter((c) => c.missing === 0).length,
    idsAsked: sum(first, 'asked'),
    idsReturnedOnce: sum(first, 'good'),
    idsMissing: sum(first, 'missing'),
    idsDuplicate: sum(first, 'duplicate'),
    idsUnknown: sum(first, 'unknown'),
    linesLeftUntranslated: untranslated,
    events: Object.fromEntries(events),
    endings: endings.filter((e) => e.finish !== 'STOP'),
    allEndings: endings,
    calls,
  };
  const short = { ...summary, calls: calls.length, allEndings: endings.length };
  process.stdout.write(`${JSON.stringify(short, null, 1)}\n`);
  const out = flag('out');
  if (out) writeFileSync(out, JSON.stringify(summary, null, 1), 'utf8');
}

main().catch((err: unknown) => {
  process.stderr.write(`failed: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exitCode = 1;
});
