import { z } from 'zod';
import { AppError } from '../errors';
import { detectProvider, PROVIDERS, type ProviderId } from '../translation/providers';
import { findLanguage } from './languages';

const boolish = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim().toLowerCase())
  .pipe(z.enum(['', 'true', 'false', '1', '0']))
  .transform((v) => v === 'true' || v === '1');

const intRange = (def: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v.trim() === '' ? def : Number(v)))
    .pipe(z.number().int().min(min).max(max));

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v ?? '').trim());

const envSchema = z.object({
  /** Key for whichever provider it belongs to (detected from its prefix). */
  AI_API_KEY: optionalString,
  /** Written by the app after a provider accepted the key: gemini, anthropic or openai. */
  AI_PROVIDER: optionalString,
  /** Older name for the same thing; used when AI_API_KEY is empty. */
  GEMINI_API_KEY: optionalString,
  OPENSUBTITLES_API_KEY: optionalString,
  /** Optional second subtitle source (free key from subdl.com). */
  SUBDL_API_KEY: optionalString,
  /** Optional third source for anime (free key from jimaku.cc; its subtitles are Japanese). */
  JIMAKU_API_KEY: optionalString,
  OPENSUBTITLES_USERNAME: optionalString,
  OPENSUBTITLES_PASSWORD: optionalString,
  OPENSUBTITLES_USER_AGENT: optionalString.transform((v) => v || 'StremioAITranslator v1.0'),
  TARGET_LANGUAGE: optionalString
    .transform((v) => (v || 'he').toLowerCase())
    .refine((v) => findLanguage(v) !== undefined, {
      message: 'must be a supported language code (for example: he, en, ar, es, fr, de)',
    }),
  PORT: intRange(7000, 1024, 65535),
  LOG_LEVEL: optionalString
    .transform((v) => (v || 'info').toLowerCase())
    .pipe(z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])),
  CHUNK_SIZE: intRange(80, 1, 200),
  CHUNK_CONCURRENCY: intRange(4, 1, 6),
  /** Fixed gap between request starts. 0 = none: the pipeline slows down by itself on 429/5xx. */
  CHUNK_DELAY_MS: intRange(0, 0, 60000),
  CHUNK_MAX_RETRIES: intRange(2, 0, 5),
  GEMINI_TIMEOUT_MS: intRange(120000, 5000, 600000),
  /** On by default for RTL languages; only an explicit RTL_FIX=false turns it off. */
  RTL_FIX: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().toLowerCase())
    .pipe(z.enum(['', 'true', 'false', '1', '0']))
    .transform((v) => v !== 'false' && v !== '0'),
  /** Remove speaker names and sound notes from subtitles before translating (default on). */
  CLEAN_SUBTITLES: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().toLowerCase())
    .pipe(z.enum(['', 'true', 'false', '1', '0']))
    .transform((v) => v !== 'false' && v !== '0'),
  /** Show the first part of a long subtitle while the rest is still being translated (default on). */
  PARTIAL_SUBTITLES: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().toLowerCase())
    .pipe(z.enum(['', 'true', 'false', '1', '0']))
    .transform((v) => v !== 'false' && v !== '0'),
  /** Use text subtitle tracks stored inside the playing video file (default on). */
  EMBEDDED_SUBTITLES: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().toLowerCase())
    .pipe(z.enum(['', 'true', 'false', '1', '0']))
    .transform((v) => v !== 'false' && v !== '0'),
  /** auto: translate as soon as Stremio asks. ask: wait for the user's OK in the app first. */
  TRANSLATION_MODE: optionalString.transform((v) => (v.toLowerCase() === 'ask' ? 'ask' : 'auto')),
  /** Download the author's news.json now and then (default on). */
  NEWS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v ?? '').trim().toLowerCase())
    .pipe(z.enum(['', 'true', 'false', '1', '0']))
    .transform((v) => v !== 'false' && v !== '0'),
  /** Stremio's local streaming server; only loopback addresses are accepted. */
  STREMIO_SERVER_URL: optionalString.transform((v) =>
    /^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/.test(v) ? v : 'http://127.0.0.1:11470',
  ),
  /** ffmpeg.exe to read the subtitle tracks with; empty = the one in Stremio's install folder. */
  FFMPEG_PATH: optionalString,
  LOG_DIALOGUE: boolish,
  CACHE_TTL_DAYS: intRange(90, 1, 3650),
  SUB_WAIT_MS: intRange(15000, 0, 60000),
  MAX_CONCURRENT_JOBS: intRange(4, 1, 8),
  STREMIO_ALLOWED_ORIGINS: optionalString,
});

export interface Config {
  /** API key of the AI provider (Gemini, Anthropic or OpenAI). */
  aiApiKey: string;
  /** Provider detected from the key prefix (Gemini when the prefix is not recognised). */
  aiProvider: ProviderId;
  /** Fixed per provider; not user-selectable. */
  aiModel: string;
  openSubtitlesApiKey: string;
  subdlApiKey: string;
  jimakuApiKey: string;
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
  openSubtitlesUserAgent: string;
  targetLanguage: string;
  host: '127.0.0.1';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  chunkSize: number;
  chunkConcurrency: number;
  /** Fixed minimum gap between provider requests, in ms (0 = adaptive only). */
  chunkDelayMs: number;
  chunkMaxRetries: number;
  aiTimeoutMs: number;
  rtlFix: boolean;
  logDialogue: boolean;
  /** Put the original line above the translation. Set on the config page. */
  dualSubtitles: boolean;
  /** Prefer a text subtitle track inside the playing video file (exact timing). */
  embeddedSubtitles: boolean;
  /** Remove speaker names and sound notes before translating. Set on the config page. */
  cleanSubtitles: boolean;
  /** Serve the first quarter of a long subtitle while the rest is still being translated. */
  partialSubtitles: boolean;
  /** Take the right episode out of a whole-season zip (SubDL). Developer setting. */
  seasonPacks: boolean;
  /** Translate from English even when a ready subtitle in the language exists. Developer setting. */
  preferTranslation: boolean;
  /** Translate the next episode in the background while this one plays. Developer setting. */
  prefetchNext: boolean;
  /**
   * background: translate at once, the sound check goes on beside it. wait: the translation waits
   * up to 30 s for the sound check. off: no sound check. Developer setting.
   */
  soundCheck: 'background' | 'wait' | 'off';
  /** How long the job waits for the video's own subtitle before it goes on without it. */
  embeddedWaitSec: number;
  /** The video's own subtitle is skipped when reading the file would take longer than this. */
  embeddedMaxEtaSec: number;
  stremioServerUrl: string;
  ffmpegPath: string;
  translationMode: 'auto' | 'ask';
  /** Show the author's messages (news.json from GitHub). */
  newsEnabled: boolean;
  cacheTtlDays: number;
  /** How long /sub/<job>.srt waits for a running translation before sending the placeholder. */
  subWaitMs: number;
  maxConcurrentJobs: number;
  /** Extra browser Origins allowed to call the Stremio routes. */
  stremioAllowedOrigins: string[];
}

/**
 * Validate environment variables. Throws AppError(CONFIGURATION_INVALID) naming each bad
 * variable - never its value. API keys are optional at startup so the status page can
 * report what is missing; features that need them check again when used.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
    throw new AppError('CONFIGURATION_INVALID', problems.join('; '), { problems });
  }
  const e = parsed.data;
  const aiApiKey = e.AI_API_KEY || e.GEMINI_API_KEY;
  // The provider that verified the key wins; the prefix is only a fallback for hand-edited files.
  const provider =
    PROVIDERS.find((p) => p.id === e.AI_PROVIDER.toLowerCase()) ??
    detectProvider(aiApiKey) ??
    (PROVIDERS[0] as (typeof PROVIDERS)[number]);
  return {
    aiApiKey,
    aiProvider: provider.id,
    aiModel: provider.model, // fixed on purpose: not user-selectable
    openSubtitlesApiKey: e.OPENSUBTITLES_API_KEY,
    subdlApiKey: e.SUBDL_API_KEY,
    jimakuApiKey: e.JIMAKU_API_KEY,
    openSubtitlesUsername: e.OPENSUBTITLES_USERNAME,
    openSubtitlesPassword: e.OPENSUBTITLES_PASSWORD,
    openSubtitlesUserAgent: e.OPENSUBTITLES_USER_AGENT,
    targetLanguage: e.TARGET_LANGUAGE,
    host: '127.0.0.1',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    chunkSize: e.CHUNK_SIZE,
    chunkConcurrency: e.CHUNK_CONCURRENCY,
    chunkDelayMs: e.CHUNK_DELAY_MS,
    chunkMaxRetries: e.CHUNK_MAX_RETRIES,
    aiTimeoutMs: e.GEMINI_TIMEOUT_MS,
    rtlFix: e.RTL_FIX,
    logDialogue: e.LOG_DIALOGUE,
    dualSubtitles: false,
    embeddedSubtitles: e.EMBEDDED_SUBTITLES,
    cleanSubtitles: e.CLEAN_SUBTITLES,
    partialSubtitles: e.PARTIAL_SUBTITLES,
    seasonPacks: true,
    preferTranslation: false,
    prefetchNext: false,
    soundCheck: 'background',
    embeddedWaitSec: 15,
    embeddedMaxEtaSec: 180,
    stremioServerUrl: e.STREMIO_SERVER_URL,
    ffmpegPath: e.FFMPEG_PATH,
    newsEnabled: e.NEWS_ENABLED,
    translationMode: e.TRANSLATION_MODE,
    cacheTtlDays: e.CACHE_TTL_DAYS,
    subWaitMs: e.SUB_WAIT_MS,
    maxConcurrentJobs: e.MAX_CONCURRENT_JOBS,
    stremioAllowedOrigins: e.STREMIO_ALLOWED_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\/[^/\s]+$/.test(s)),
  };
}

/** Names of the variables that hold secrets (used for redaction and status display). */
export function secretValues(config: Config): string[] {
  return [
    config.aiApiKey,
    config.openSubtitlesApiKey,
    config.openSubtitlesPassword,
    config.subdlApiKey,
    config.jimakuApiKey,
  ].filter((v) => v.length >= 4);
}
