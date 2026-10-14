import { z } from 'zod';
import { AppError } from '../errors';
import { DEFAULT_MODEL, findLanguage } from './languages';

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
  GEMINI_API_KEY: optionalString,
  GEMINI_MODEL: optionalString.transform((v) => v || DEFAULT_MODEL),
  OPENSUBTITLES_API_KEY: optionalString,
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
  CHUNK_SIZE: intRange(60, 5, 200),
  CHUNK_CONCURRENCY: intRange(2, 1, 6),
  CHUNK_MAX_RETRIES: intRange(2, 0, 5),
  GEMINI_TIMEOUT_MS: intRange(90000, 5000, 600000),
  RTL_FIX: boolish,
  LOG_DIALOGUE: boolish,
});

export interface Config {
  geminiApiKey: string;
  geminiModel: string;
  openSubtitlesApiKey: string;
  openSubtitlesUsername: string;
  openSubtitlesPassword: string;
  openSubtitlesUserAgent: string;
  targetLanguage: string;
  host: '127.0.0.1';
  port: number;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  chunkSize: number;
  chunkConcurrency: number;
  chunkMaxRetries: number;
  geminiTimeoutMs: number;
  rtlFix: boolean;
  logDialogue: boolean;
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
  return {
    geminiApiKey: e.GEMINI_API_KEY,
    geminiModel: e.GEMINI_MODEL,
    openSubtitlesApiKey: e.OPENSUBTITLES_API_KEY,
    openSubtitlesUsername: e.OPENSUBTITLES_USERNAME,
    openSubtitlesPassword: e.OPENSUBTITLES_PASSWORD,
    openSubtitlesUserAgent: e.OPENSUBTITLES_USER_AGENT,
    targetLanguage: e.TARGET_LANGUAGE,
    host: '127.0.0.1',
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    chunkSize: e.CHUNK_SIZE,
    chunkConcurrency: e.CHUNK_CONCURRENCY,
    chunkMaxRetries: e.CHUNK_MAX_RETRIES,
    geminiTimeoutMs: e.GEMINI_TIMEOUT_MS,
    rtlFix: e.RTL_FIX,
    logDialogue: e.LOG_DIALOGUE,
  };
}

/** Names of the variables that hold secrets (used for redaction and status display). */
export function secretValues(config: Config): string[] {
  return [config.geminiApiKey, config.openSubtitlesApiKey, config.openSubtitlesPassword].filter(
    (v) => v.length >= 4,
  );
}
