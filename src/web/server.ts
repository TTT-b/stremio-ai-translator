import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { findLanguage, KNOWN_MODELS, LANGUAGES } from '../config/languages';
import type { Config } from '../config/env';
import {
  effectiveConfig,
  parseSettingsUpdate,
  readSettings,
  writeSettings,
  type Settings,
} from '../config/settings';
import { AppError, isAppError } from '../errors';
import type { Logger } from '../logging/logger';
import { z } from 'zod';
import { loadConfig } from '../config/env';
import { updateEnvFile } from '../config/envFile';
import { OpenSubtitlesProvider } from '../sources/opensubtitles/provider';
import { selectSubtitle } from '../sources/select';
import { parseVideoId, type SourceSubtitleProvider } from '../sources/types';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import { GeminiProvider } from '../translation/gemini';
import type { TranslationProvider } from '../translation/provider';
import { translateSubtitle } from '../translation/pipeline';
import { renderStatusPage } from './html';

export interface ServerDeps {
  /** Config from the environment (before settings.json overrides). */
  config: Config;
  logger: Logger;
  settingsPath?: string;
  /** Builds the translation provider for the effective config. Injectable for tests. */
  createProvider?: (config: Config) => TranslationProvider;
  /** Builds the subtitle source provider. Injectable for tests. */
  createSourceProvider?: (config: Config, logger: Logger) => SourceSubtitleProvider;
  fetchImpl?: typeof fetch;
  /** .env file the key form writes to. Defaults to ./.env */
  envPath?: string;
  /** Called with the new config after keys are saved (so logging redaction stays current). */
  onConfigChange?: (config: Config) => void;
}

const keysSchema = z
  .object({
    geminiApiKey: z.string().trim().max(256).optional(),
    openSubtitlesApiKey: z.string().trim().max(256).optional(),
    openSubtitlesUsername: z.string().trim().max(128).optional(),
    openSubtitlesPassword: z.string().trim().max(256).optional(),
  })
  .strict();

const KEY_ENV_NAMES = {
  geminiApiKey: 'GEMINI_API_KEY',
  openSubtitlesApiKey: 'OPENSUBTITLES_API_KEY',
  openSubtitlesUsername: 'OPENSUBTITLES_USERNAME',
  openSubtitlesPassword: 'OPENSUBTITLES_PASSWORD',
} as const;

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:03,500
Good morning. Did you sleep well?

2
00:00:04,000 --> 00:00:06,000
<i>Not really. Too much coffee.</i>

3
00:00:06,500 --> 00:00:09,000
- Where are we going?
- To the harbor.
`;

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export function createApp(deps: ServerDeps): express.Express {
  const { logger } = deps;
  let envConfig = deps.config;
  const envPath = deps.envPath ?? resolve(process.cwd(), '.env');
  const app = express();
  app.disable('x-powered-by');

  const current = (): Config => effectiveConfig(envConfig, readSettings(deps.settingsPath));
  const makeSource =
    deps.createSourceProvider ??
    ((c: Config, log: Logger): SourceSubtitleProvider =>
      new OpenSubtitlesProvider({
        credentials: {
          apiKey: c.openSubtitlesApiKey,
          username: c.openSubtitlesUsername,
          password: c.openSubtitlesPassword,
          userAgent: c.openSubtitlesUserAgent,
        },
        logger: log,
        ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
      }));
  const makeProvider =
    deps.createProvider ??
    ((c: Config) =>
      new GeminiProvider({
        apiKey: c.geminiApiKey,
        model: c.geminiModel,
        timeoutMs: c.geminiTimeoutMs,
      }));

  const allowedHosts = new Set([`127.0.0.1:${envConfig.port}`, `localhost:${envConfig.port}`]);
  const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`));

  // Per-request id, host allow-list (blocks DNS rebinding), origin check (blocks cross-site POSTs).
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = randomUUID().slice(0, 8);
    res.locals.reqId = reqId;
    res.locals.log = logger.child({ reqId });
    if (!allowedHosts.has(req.headers.host ?? '')) {
      res.status(403).type('text/plain').send('Forbidden host');
      return;
    }
    const origin = req.headers.origin;
    if (origin && !allowedOrigins.has(origin)) {
      res.status(403).type('text/plain').send('Forbidden origin');
      return;
    }
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.use('/api', express.json({ limit: '10kb' }));

  app.get('/', (_req, res) => {
    const c = current();
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    const manifestUrl = `http://127.0.0.1:${c.port}/manifest.json`;
    res.type('html').send(
      renderStatusPage({
        nonce,
        geminiConfigured: c.geminiApiKey !== '',
        openSubtitlesKeyConfigured: c.openSubtitlesApiKey !== '',
        openSubtitlesLoginConfigured:
          c.openSubtitlesUsername !== '' && c.openSubtitlesPassword !== '',
        openSubtitlesUsername: c.openSubtitlesUsername,
        languages: LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
        models: [...KNOWN_MODELS],
        targetLanguage: c.targetLanguage,
        model: c.geminiModel,
        manifestUrl,
        installUrl: `stremio://127.0.0.1:${c.port}/manifest.json`,
        stremioReady: false,
        rtlFix: c.rtlFix,
      }),
    );
  });

  app.post('/api/settings', (req, res) => {
    try {
      const update = parseSettingsUpdate(req.body);
      const merged: Settings = { ...readSettings(deps.settingsPath), ...update };
      writeSettings(merged, deps.settingsPath);
      logger.info({ stage: 'CONFIG', ...merged }, 'settings saved');
      res.json({ ok: true });
    } catch {
      res.status(400).json({ ok: false, message: 'Invalid settings.' });
    }
  });

  app.post('/api/test/gemini', async (_req, res) => {
    const c = current();
    const { details, ...result } = await makeProvider(c).testConnection();
    logger.info(
      {
        stage: 'API',
        provider: 'gemini',
        model: c.geminiModel,
        ok: result.ok,
        errorCode: result.code,
        ...(details ? { details } : {}),
      },
      'gemini test',
    );
    res.json(result);
  });

  app.post('/api/test/opensubtitles', async (_req, res) => {
    const c = current();
    const { details, ...result } = await makeSource(c, logger).testConnection();
    logger.info(
      {
        stage: 'SOURCE',
        provider: 'opensubtitles',
        ok: result.ok,
        errorCode: result.code,
        ...(details ? { details } : {}),
      },
      'opensubtitles test',
    );
    res.json(result);
  });

  // Save API keys to the local .env file. Values are never echoed back or logged.
  app.post('/api/keys', (req, res) => {
    const parsed = keysSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, message: 'Invalid input.' });
      return;
    }
    const updates: Record<string, string> = {};
    for (const [field, envName] of Object.entries(KEY_ENV_NAMES)) {
      const value = parsed.data[field as keyof typeof KEY_ENV_NAMES];
      if (value) updates[envName] = value;
    }
    if (Object.keys(updates).length === 0) {
      res.status(400).json({ ok: false, message: 'Nothing to save.' });
      return;
    }
    try {
      updateEnvFile(envPath, updates);
      const nextEnv = { ...process.env, ...updates };
      envConfig = loadConfig(nextEnv);
      Object.assign(process.env, updates);
      deps.onConfigChange?.(envConfig);
      logger.info({ stage: 'CONFIG', updated: Object.keys(updates) }, 'keys saved to .env');
      res.json({ ok: true, message: `Saved: ${Object.keys(updates).join(', ')}` });
    } catch (err) {
      const e = isAppError(err) ? err : new AppError('CONFIGURATION_INVALID');
      logger.warn({ stage: 'CONFIG', errorCode: e.code }, 'saving keys failed');
      res.status(500).json({
        ok: false,
        message: `Could not save keys (${e.message}). Edit the .env file manually.`,
      });
    }
  });

  // Dev route: show what OpenSubtitles has for a title (search only - uses no download quota).
  app.get('/dev/source-search', async (req, res) => {
    const log = (res.locals.log as Logger).child({ route: 'dev-source-search' });
    try {
      const c = current();
      const type = typeof req.query.type === 'string' ? req.query.type : 'movie';
      const id = typeof req.query.id === 'string' ? req.query.id : '';
      const hash = typeof req.query.hash === 'string' ? req.query.hash : undefined;
      if (hash !== undefined && !/^[0-9a-f]{16}$/i.test(hash)) {
        throw new AppError('STREMIO_REQUEST_INVALID', 'hash must be 16 hex characters');
      }
      const video = parseVideoId(type, id);
      const candidates = await makeSource(c, log).search({
        video,
        languages: [...new Set([c.targetLanguage, 'en'])],
        ...(hash ? { movieHash: hash } : {}),
      });
      const selection = selectSubtitle(candidates, c.targetLanguage);
      res.json({
        ok: true,
        found: candidates.length,
        decision: selection.kind,
        chosen: selection.kind === 'none' ? null : selection.candidate,
      });
    } catch (err) {
      const e = isAppError(err) ? err : new AppError('SOURCE_DOWNLOAD_FAILED');
      log.warn({ errorCode: e.code }, 'dev source search failed');
      res.status(e.httpStatus).json({ ok: false, code: e.code, message: e.message });
    }
  });

  async function translateText(
    raw: string,
    c: Config,
    log: Logger,
  ): Promise<{
    output: string;
    cues: number;
    tokens: { inputTokens: number; outputTokens: number };
  }> {
    const source = parseSubtitle(raw);
    const lang = findLanguage(c.targetLanguage);
    if (!lang) throw new AppError('CONFIGURATION_INVALID', 'TARGET_LANGUAGE');
    const result = await translateSubtitle(source, makeProvider(c), {
      targetLanguageCode: lang.code,
      targetLanguageName: lang.name,
      chunkSize: c.chunkSize,
      concurrency: c.chunkConcurrency,
      maxValidationRetries: c.chunkMaxRetries,
      rtlFix: c.rtlFix && lang.rtl,
      logger: log,
      logDialogue: c.logDialogue,
    });
    return {
      output: serializeSubtitle(result.file),
      cues: source.cues.length,
      tokens: result.usage,
    };
  }

  app.post('/api/dev/sample', async (_req, res) => {
    const log = (res.locals.log as Logger).child({ route: 'dev-sample' });
    const c = current();
    try {
      const r = await translateText(SAMPLE_SRT, c, log);
      res.json({
        ok: true,
        message: `Translated ${r.cues} cues to ${c.targetLanguage}.`,
        preview: r.output,
      });
    } catch (err) {
      const e = isAppError(err) ? err : new AppError('PROVIDER_RESPONSE_INVALID');
      log.warn({ errorCode: e.code }, 'sample translation failed');
      res.json({ ok: false, code: e.code, message: e.userMessage });
    }
  });

  // Dev route: POST raw SRT/VTT text, get the translated file back.
  app.post(
    '/dev/translate',
    express.text({ type: '*/*', limit: MAX_SUBTITLE_BYTES }),
    async (req, res) => {
      const log = (res.locals.log as Logger).child({ route: 'dev-translate' });
      if (typeof req.body !== 'string' || req.body.trim() === '') {
        res.status(400).type('text/plain').send('Send the SRT/VTT file as the request body.');
        return;
      }
      try {
        const base = current();
        const lang = typeof req.query.lang === 'string' ? req.query.lang : base.targetLanguage;
        if (!findLanguage(lang)) throw new AppError('STREMIO_REQUEST_INVALID', 'unsupported lang');
        const r = await translateText(req.body, { ...base, targetLanguage: lang }, log);
        const isVtt = r.output.startsWith('WEBVTT');
        res
          .type(isVtt ? 'text/vtt; charset=utf-8' : 'application/x-subrip; charset=utf-8')
          .send(r.output);
      } catch (err) {
        const e = isAppError(err) ? err : new AppError('PROVIDER_RESPONSE_INVALID');
        log.warn({ errorCode: e.code }, 'dev translate failed');
        res.status(e.httpStatus).type('text/plain').send(`${e.code}: ${e.userMessage}`);
      }
    },
  );

  // Never leak internals: map every failure to a safe response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const e = isAppError(err) ? err : new AppError('STREMIO_REQUEST_INVALID');
    logger.warn({ errorCode: e.code }, 'request failed');
    res.status(e.httpStatus).type('text/plain').send(`${e.code}: ${e.userMessage}`);
  });

  return app;
}
