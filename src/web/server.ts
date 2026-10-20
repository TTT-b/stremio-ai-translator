import { randomBytes, randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { FileCache } from '../cache/fileCache';
import { Library } from '../jobs/library';
import { RELEASE_NOTES } from '../electron/whatsNew';
import { recentLogLines } from '../logging/diagnostics';
import { locateTools } from '../sources/embedded';
import { compareVersionsDesc, NEWS_URL, NewsFeed } from '../news/news';
import { isJobId, JobManager, type JobManagerDeps } from '../jobs/manager';
import { createStremioRouter } from '../stremio/addon';
import {
  CANCELLED_MESSAGE,
  pendingMessage,
  placeholderSrt,
  progressMessage,
} from '../stremio/placeholder';
import { fitSubtitleToVideo } from '../sync/videoFit';
import { openStremio } from '../stremio/launcher';
import { pickSample, readableLines } from './sample';
import express, { type NextFunction, type Request, type Response } from 'express';
import { findLanguage, LANGUAGES } from '../config/languages';
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
import { FallbackSource } from '../sources/fallback';
import { OpenSubtitlesProvider } from '../sources/opensubtitles/provider';
import { SubdlProvider } from '../sources/subdl/provider';
import { selectSubtitle } from '../sources/select';
import { makeTitleResolver } from '../sources/titles';
import { parseVideoId, type SourceSubtitleProvider } from '../sources/types';
import { makeTestProvider, makeTestSource, randomTestVideoId } from '../testmode';
import { parseSubtitle } from '../subtitles/parse';
import { serializeSubtitle } from '../subtitles/serialize';
import { GeminiProvider } from '../translation/gemini';
import { AnthropicProvider, OpenAiProvider } from '../translation/httpProviders';
import { PROVIDERS } from '../translation/providers';
import { verifyAiKey, type VerifyResult } from '../translation/verify';
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
  /** Asks the providers which one accepts an AI key. Injectable for tests. */
  verifyAiKey?: (key: string) => Promise<VerifyResult>;
  /** .env file the key form writes to. Defaults to ./.env */
  envPath?: string;
  /** Called with the new config after keys are saved (so logging redaction stays current). */
  onConfigChange?: (config: Config) => void;
  /** Ask mode: a new request is waiting for the user's OK (the desktop app shows a notification). */
  onPending?: JobManagerDeps['onPending'];
  /** Where cache and job files live. Defaults to ./data */
  dataDir?: string;
  /** Reads a subtitle track from the playing video file. Injectable for tests. */
  loadEmbedded?: JobManagerDeps['loadEmbedded'];
  /** Test hooks for precise sync: where the video is on Stremio's server, and which ffmpeg. */
  findStream?: JobManagerDeps['findStream'];
  ffmpegFor?: JobManagerDeps['ffmpegFor'];
  speechFit?: JobManagerDeps['speechFit'];
  /** Where the author's news.json is downloaded from. Tests point it elsewhere. */
  newsUrl?: string;
  /** Test hook: caps on how long one step of a job may take. */
  limits?: JobManagerDeps['limits'];
  /** Folder of the app's log files (for the diagnostics copy). */
  logDir?: string;
  /** Test hook: how soon a guessed-timing subtitle is checked again. */
  refreshGuessAfterMs?: number;
  stallAfterMs?: number;
  /** Test hook: opens the Stremio app. */
  openStremio?: () => Promise<{ ok: boolean; code?: string }>;
  cancelCooldownMs?: number;
  /** Test hook: receives the job manager and cache. */
  onReady?: (ctx: { jobs: JobManager; cache: FileCache }) => void;
}

/** Browser origins Stremio apps are known to use for add-on requests. */
const DEFAULT_STREMIO_ORIGINS = [
  'https://app.strem.io',
  'https://web.stremio.com',
  'https://web.strem.io',
  'http://127.0.0.1:11470',
  'http://localhost:11470',
];

const isStremioPath = (p: string) =>
  p === '/manifest.json' || p.startsWith('/subtitles/') || p.startsWith('/sub/');

const keysSchema = z
  .object({
    aiApiKey: z.string().trim().max(256).optional(),
    openSubtitlesApiKey: z.string().trim().max(256).optional(),
    subdlApiKey: z.string().trim().max(256).optional(),
    openSubtitlesUsername: z.string().trim().max(128).optional(),
    openSubtitlesPassword: z.string().trim().max(256).optional(),
  })
  .strict();

const KEY_ENV_NAMES = {
  aiApiKey: 'AI_API_KEY',
  openSubtitlesApiKey: 'OPENSUBTITLES_API_KEY',
  subdlApiKey: 'SUBDL_API_KEY',
  openSubtitlesUsername: 'OPENSUBTITLES_USERNAME',
  openSubtitlesPassword: 'OPENSUBTITLES_PASSWORD',
} as const;

const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

export function createApp(deps: ServerDeps): express.Express {
  const { logger } = deps;
  let envConfig = deps.config;
  const envPath = deps.envPath ?? resolve(process.cwd(), '.env');
  const app = express();
  app.disable('x-powered-by');

  const current = (): Config => effectiveConfig(envConfig, readSettings(deps.settingsPath));
  const dataDir = deps.dataDir ?? resolve(process.cwd(), 'data');
  const testMode = () => readSettings(deps.settingsPath).testMode === true;
  const makeSource =
    deps.createSourceProvider ??
    ((c: Config, log: Logger): SourceSubtitleProvider => {
      const fetchPart = deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {};
      const opensubtitles = new OpenSubtitlesProvider({
        credentials: {
          apiKey: c.openSubtitlesApiKey,
          username: c.openSubtitlesUsername,
          password: c.openSubtitlesPassword,
          userAgent: c.openSubtitlesUserAgent,
        },
        logger: log,
        ...fetchPart,
      });
      // The optional second source, used beside OpenSubtitles when a SubDL key is saved.
      return c.subdlApiKey
        ? new FallbackSource(
            opensubtitles,
            new SubdlProvider({
              apiKey: c.subdlApiKey,
              logger: log,
              ...fetchPart,
            }),
            readSettings(deps.settingsPath).subtitleSource === 'subdl',
          )
        : opensubtitles;
    });
  const makeProvider =
    deps.createProvider ??
    ((c: Config): TranslationProvider => {
      const opts = { apiKey: c.aiApiKey, model: c.aiModel, timeoutMs: c.aiTimeoutMs };
      if (c.aiProvider === 'anthropic') {
        return new AnthropicProvider({
          ...opts,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
      }
      if (c.aiProvider === 'openai') {
        return new OpenAiProvider({
          ...opts,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        });
      }
      return new GeminiProvider(opts);
    });

  const verify = deps.verifyAiKey ?? ((key: string) => verifyAiKey(key, deps.fetchImpl));

  const cache = new FileCache(join(dataDir, 'cache'), envConfig.cacheTtlDays * 86_400_000, logger);
  const library = new Library(join(dataDir, 'library.json'));
  // The old speech-sync tool (whisper) is gone: free the disk it used.
  for (const old of ['tools/whisper', 'sync-cache']) {
    try {
      rmSync(join(dataDir, old), { recursive: true, force: true });
    } catch (err) {
      logger.warn({ stage: 'CONFIG', error: String(err) }, 'could not remove the old sync tool');
    }
  }
  const news = new NewsFeed({
    url: deps.newsUrl ?? NEWS_URL,
    cacheFile: join(dataDir, 'news-cache.json'),
    seenFile: join(dataDir, 'news-seen.json'),
    enabled: envConfig.newsEnabled,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  const jobs = new JobManager({
    config: current,
    logger,
    cache,
    library,
    speechFit: deps.speechFit ?? fitSubtitleToVideo,
    ...(deps.findStream ? { findStream: deps.findStream } : {}),
    ...(deps.ffmpegFor ? { ffmpegFor: deps.ffmpegFor } : {}),
    ...(deps.loadEmbedded ? { loadEmbedded: deps.loadEmbedded } : {}),
    ...(deps.onPending ? { onPending: deps.onPending } : {}),
    ...(deps.limits ? { limits: deps.limits } : {}),
    ...(deps.cancelCooldownMs !== undefined ? { cancelCooldownMs: deps.cancelCooldownMs } : {}),
    ...(deps.stallAfterMs !== undefined ? { stallAfterMs: deps.stallAfterMs } : {}),
    ...(deps.refreshGuessAfterMs !== undefined
      ? { refreshGuessAfterMs: deps.refreshGuessAfterMs }
      : {}),
    testMode,
    jobsDir: join(dataDir, 'jobs'),
    makeSource: (c, l) => (testMode() ? makeTestSource(dataDir) : makeSource(c, l)),
    makeProvider: (c) => (testMode() ? makeTestProvider() : makeProvider(c)),
    // The meter only reads the account's allowance, so it stays real in test mode.
    makeQuotaSource: (c, l) => makeSource(c, l),
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
  });
  deps.onReady?.({ jobs, cache });

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
    const stremioOrigins = new Set([
      ...DEFAULT_STREMIO_ORIGINS,
      ...envConfig.stremioAllowedOrigins,
    ]);
    const originOk =
      !origin ||
      allowedOrigins.has(origin) ||
      (isStremioPath(req.path) && stremioOrigins.has(origin));
    if (!originOk) {
      logger.warn(
        { stage: 'STREMIO', origin, path: req.path.split('/')[1] },
        'request from unknown origin blocked',
      );
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

  app.get('/', (req, res) => {
    const c = current();
    const nonce = randomBytes(16).toString('base64');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    );
    const manifestUrl = `http://127.0.0.1:${c.port}/manifest.json`;
    res.type('html').send(
      renderStatusPage({
        desktop: (req.get('user-agent') ?? '').includes('Electron/'),
        nonce,
        aiConfigured: c.aiApiKey !== '',
        aiProviderLabel: PROVIDERS.find((p) => p.id === c.aiProvider)?.label ?? '',
        aiModel: c.aiModel,
        dualSubtitles: c.dualSubtitles,
        embeddedSubtitles: c.embeddedSubtitles,
        cleanSubtitles: c.cleanSubtitles,
        translationMode: c.translationMode,
        openSubtitlesKeyConfigured: c.openSubtitlesApiKey !== '',
        subdlKeyConfigured: c.subdlApiKey !== '',
        openSubtitlesLoginConfigured:
          c.openSubtitlesUsername !== '' && c.openSubtitlesPassword !== '',
        openSubtitlesUsername: c.openSubtitlesUsername,
        languages: LANGUAGES.map((l) => ({ code: l.code, name: l.name })),
        targetLanguage: c.targetLanguage,
        manifestUrl,
        // Stremio rewrites stremio:// links to https and drops the port, so a local http add-on
        // cannot be installed that way. Stremio Web accepts the http manifest URL as a parameter.
        installUrl: `https://web.stremio.com/#/addons?addon=${encodeURIComponent(manifestUrl)}`,
        stremioReady: true,
        rtlFix: c.rtlFix,
        testMode: testMode(),
        subtitleSource: readSettings(deps.settingsPath).subtitleSource ?? 'opensubtitles',
        uiLang: readSettings(deps.settingsPath).uiLanguage ?? 'he',
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

  // Test mode: puts a made-up episode in the real queue (made-up subtitle, pretend AI).
  app.post('/api/test/run', (_req, res) => {
    if (!testMode()) {
      res.status(400).json({ ok: false, message: 'Test mode is off.' });
      return;
    }
    const c = current();
    const video = parseVideoId('series', randomTestVideoId());
    jobs.ensure({ video, targetLanguage: c.targetLanguage });
    logger.info({ stage: 'API' }, 'test mode request started');
    res.json({ ok: true });
  });

  // /api/test/gemini is the older name of the same route.
  app.post(['/api/test/ai', '/api/test/gemini'], async (_req, res) => {
    const c = current();
    const { details, ...result } = await makeProvider(c).testConnection();
    logger.info(
      {
        stage: 'API',
        provider: c.aiProvider,
        model: c.aiModel,
        ok: result.ok,
        errorCode: result.code,
        ...(details ? { details } : {}),
      },
      'ai provider test',
    );
    res.json(result);
  });

  // Live numbers for the status card (polled by the page; local only). The queue lines carry video
  // titles, so this is never copied into the diagnostics (see below); it contains no dialogue.
  app.get('/api/status', (_req, res) => {
    void jobs.refreshQuota();
    res.json({ ok: true, ...jobs.stats() });
  });

  // Ask mode: the user says yes or no to a translation waiting in the queue (or stops a running one).
  app.post('/api/jobs/:id/:action', (req, res) => {
    const id = req.params.id ?? '';
    const action = req.params.action;
    if (!isJobId(id) || (action !== 'approve' && action !== 'cancel' && action !== 'skip')) {
      res.status(400).json({ ok: false, message: 'Invalid request.' });
      return;
    }
    const done =
      action === 'approve' ? jobs.approve(id) : action === 'skip' ? jobs.skip(id) : jobs.cancel(id);
    logger.info({ stage: 'API', jobId: id.slice(0, 8), action, done }, 'queue action');
    res.json({ ok: done });
  });

  // The Open Stremio button: starts the Stremio app through its stremio:// link type.
  app.post('/api/open-stremio', async (_req, res) => {
    const result = await (deps.openStremio ?? openStremio)();
    logger.info({ stage: 'API', ok: result.ok, code: result.code }, 'open stremio');
    res.json(result);
  });

  // The Continue button: cut a translation that is not being answered, or restart a cancelled/failed one.
  app.post('/api/resume', (_req, res) => {
    const action = jobs.resume();
    logger.info({ stage: 'API', action }, 'resume');
    res.json({ ok: action !== 'none', action });
  });

  // Delete translated subtitles from the local cache. Downloaded source files are kept.
  app.post('/api/cache/clear', (_req, res) => {
    try {
      const { removed, bytes } = cache.clear('translation');
      jobs.forgetFinished();
      library.clear();
      logger.info({ stage: 'CACHE', removed, bytes }, 'translation cache cleared');
      const size =
        bytes < 1024 * 1024
          ? `${(bytes / 1024).toFixed(1)} KB`
          : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
      res.json({ ok: true, removed, bytes, message: `Translation cache cleared (${size}).` });
    } catch {
      logger.warn({ stage: 'CACHE', errorCode: 'CACHE_WRITE_FAILED' }, 'clearing cache failed');
      res.status(500).json({ ok: false, message: 'Could not clear the cache.' });
    }
  });

  // The user's subtitles, for the "My subtitles" screen (titles and numbers only, no dialogue).
  app.get('/api/library', (_req, res) => {
    const items = library.list().map(({ keys: _keys, ...rest }) => rest);
    res.json({ ok: true, items, totalBytes: items.reduce((n, e) => n + e.bytes, 0) });
  });

  const deleteSchema = z.union([
    z.object({ all: z.literal(true) }).strict(),
    z.object({ ids: z.array(z.string().regex(/^[0-9a-f]{32}$/)).max(200) }).strict(),
  ]);

  // Delete chosen subtitles (or all). Downloaded source files stay, so no OpenSubtitles quota is lost.
  app.post('/api/library/delete', (req, res) => {
    const parsed = deleteSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ ok: false, message: 'Invalid input.' });
      return;
    }
    try {
      const gone = 'all' in parsed.data ? library.clear() : library.remove(parsed.data.ids);
      for (const entry of gone) {
        for (const key of entry.keys) cache.delete(key);
        jobs.forget(entry.id);
      }
      logger.info({ stage: 'CACHE', removed: gone.length }, 'library entries deleted');
      res.json({ ok: true, removed: gone.length });
    } catch {
      logger.warn({ stage: 'CACHE', errorCode: 'CACHE_WRITE_FAILED' }, 'library delete failed');
      res.status(500).json({ ok: false, message: 'Could not delete.' });
    }
  });

  app.get('/api/news', async (_req, res) => {
    const { items, online } = await news.get();
    const releases = Object.entries(RELEASE_NOTES)
      .sort((a, b) => compareVersionsDesc(a[0], b[0]))
      .map(([version, notes]) => ({ version, notes }));
    res.json({ ok: true, online, items, seen: news.seen(), releases });
  });

  // A short report the user can copy and send when something does not work: settings as yes/no,
  // whether Stremio's server and ffmpeg are found, and the latest log lines. No keys, no subtitle text.
  app.get('/api/diagnostics', async (_req, res) => {
    const c = current();
    let stremio = 'not reachable';
    try {
      const r = await (deps.fetchImpl ?? fetch)(`${c.stremioServerUrl}/heartbeat`, {
        signal: AbortSignal.timeout(2000),
      });
      stremio = r.ok ? 'reachable' : `answered ${r.status}`;
    } catch {
      /* stays "not reachable" */
    }
    const yes = (b: boolean) => (b ? 'yes' : 'no');
    const version = Object.keys(RELEASE_NOTES).sort(compareVersionsDesc)[0] ?? '?';
    const lines = [
      'AI Subtitle Translator - diagnostics',
      `version: ${version}`,
      `time: ${new Date().toISOString()}`,
      `system: ${process.platform} ${process.arch}, node ${process.versions.node}`,
      `AI provider: ${c.aiProvider} (key set: ${yes(c.aiApiKey !== '')})`,
      `OpenSubtitles key / login set: ${yes(c.openSubtitlesApiKey !== '')} / ${yes(c.openSubtitlesUsername !== '' && c.openSubtitlesPassword !== '')}`,
      `SubDL key set: ${yes(c.subdlApiKey !== '')}`,
      `translation mode: ${c.translationMode}`,
      `target language: ${c.targetLanguage}, dual: ${yes(c.dualSubtitles)}, embedded subtitles: ${yes(c.embeddedSubtitles)}`,
      `Stremio server (${c.stremioServerUrl}): ${stremio}`,
      `ffmpeg found: ${yes(locateTools(c.ffmpegPath) !== undefined)}`,
      // Counters only: no titles of what the user watches (the queue is reduced to its length).
      `jobs: ${JSON.stringify({ ...jobs.stats(), queue: jobs.stats().queue.length })}`,
      '',
      'recent events:',
      ...(deps.logDir ? recentLogLines(deps.logDir) : ['(no log folder)']),
    ];
    res.type('text/plain').send(lines.join('\n'));
  });

  app.post('/api/news/seen', (req, res) => {
    const ids: unknown = (req.body as { ids?: unknown } | undefined)?.ids;
    if (!news.markSeen(ids)) {
      res.status(400).json({ ok: false, message: 'Invalid input.' });
      return;
    }
    res.json({ ok: true });
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

  // Only used when a SubDL key is saved: checks that SubDL accepts it (no download is made).
  app.post('/api/test/subdl', async (_req, res) => {
    const c = current();
    const { details, ...result } = await new SubdlProvider({
      apiKey: c.subdlApiKey,
      logger,
      ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    }).testConnection();
    logger.info(
      {
        stage: 'SOURCE',
        provider: 'subdl',
        ok: result.ok,
        errorCode: result.code,
        ...(details ? { details } : {}),
      },
      'subdl test',
    );
    res.json(result);
  });

  // Save API keys to the local .env file. Values are never echoed back or logged.
  app.post('/api/keys', async (req, res) => {
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
    // An AI key is saved only after a provider has accepted it; that provider is remembered.
    let verifiedLabel = '';
    if (updates.AI_API_KEY) {
      const verdict = await verify(updates.AI_API_KEY);
      logger.info(
        {
          stage: 'API',
          ok: verdict.ok,
          provider: verdict.ok ? verdict.provider.id : undefined,
          reason: verdict.ok ? undefined : verdict.reason,
        },
        'ai key verification',
      );
      if (!verdict.ok) {
        const unreachable = verdict.reason === 'unreachable';
        res.status(unreachable ? 503 : 401).json({
          ok: false,
          message: unreachable
            ? 'Could not verify the key right now (no clear answer from the providers). Check your internet connection and try again. Nothing was saved.'
            : 'The key was rejected by Google Gemini, OpenAI and Anthropic. Nothing was saved - check that you copied the whole key.',
        });
        return;
      }
      updates.AI_PROVIDER = verdict.provider.id;
      verifiedLabel = verdict.provider.label;
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
      const others = Object.keys(updates).filter((k) => k !== 'AI_API_KEY' && k !== 'AI_PROVIDER');
      const parts = [
        ...(verifiedLabel ? [`Key verified: ${verifiedLabel}`] : []),
        ...(others.length ? [`Saved: ${others.join(', ')}`] : []),
      ];
      res.json({
        ok: true,
        message: parts.join('. ') || 'Saved',
        ...(verifiedLabel ? { provider: verifiedLabel } : {}),
      });
    } catch (err) {
      const e = isAppError(err) ? err : new AppError('CONFIGURATION_INVALID');
      logger.warn({ stage: 'CONFIG', errorCode: e.code }, 'saving keys failed');
      res.status(500).json({
        ok: false,
        message: `Could not save keys (${e.message}). Make sure the app data folder is writable.`,
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
      const filename =
        typeof req.query.filename === 'string' ? req.query.filename.slice(0, 300) : undefined;
      const video = parseVideoId(type, id);
      const candidates = await makeSource(c, log).search({
        video,
        languages: [...new Set([c.targetLanguage, 'en'])],
        ...(hash ? { movieHash: hash } : {}),
        resolveTitles: makeTitleResolver({
          video,
          filename,
          logger: log,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        }),
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
    lines: string;
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
      dualSubtitles: c.dualSubtitles,
      logger: log,
      logDialogue: c.logDialogue,
    });
    return {
      output: serializeSubtitle(result.file),
      lines: readableLines(result.file.cues.map((cue) => cue.text)),
      cues: source.cues.length,
      tokens: result.usage,
    };
  }

  app.post('/api/dev/sample', async (_req, res) => {
    const log = (res.locals.log as Logger).child({ route: 'dev-sample' });
    const c = current();
    try {
      const r = await translateText(pickSample(), c, log);
      res.json({
        ok: true,
        message: `Translated ${r.cues} cues to ${c.targetLanguage}.`,
        preview: r.lines,
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

  // Serve a job's subtitle. Waits briefly for a running translation, then falls back to a placeholder.
  app.get('/sub/:file', async (req, res) => {
    const log = (res.locals.log as Logger).child({ stage: 'DELIVERY' });
    const started = Date.now();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    const send = (body: string, state: string, jobId?: string) => {
      res.type('application/x-subrip; charset=utf-8').send(body);
      log.info(
        {
          state,
          jobId: jobId?.slice(0, 8),
          bytes: Buffer.byteLength(body),
          durationMs: Date.now() - started,
          httpStatus: 200,
        },
        'subtitle delivered',
      );
    };
    const m = /^([0-9a-f]{32})\.srt$/.exec(req.params.file ?? '');
    const job = m ? jobs.get(m[1] as string) : undefined;
    if (!job) {
      send(
        placeholderSrt('Unknown subtitle request — reselect the subtitle in Stremio'),
        'unknown',
      );
      return;
    }
    await jobs.waitFor(job, current().subWaitMs);
    if (job.status === 'done' && job.result)
      send(job.result.content, `ready:${job.result.via}`, job.id);
    else if (job.status === 'failed' && job.error) {
      send(
        placeholderSrt(`Subtitle unavailable: ${job.error.userMessage}`),
        `failed:${job.error.code}`,
        job.id,
      );
    } else if (job.status === 'pending') {
      send(
        placeholderSrt(pendingMessage(readSettings(deps.settingsPath).uiLanguage ?? 'he')),
        'pending',
        job.id,
      );
    } else if (job.status === 'cancelled') {
      send(placeholderSrt(CANCELLED_MESSAGE), 'cancelled', job.id);
    } else {
      send(
        placeholderSrt(
          progressMessage(
            readSettings(deps.settingsPath).uiLanguage ?? 'he',
            job.stage,
            job.progress && job.progress.total > 0
              ? Math.min(100, Math.floor((job.progress.done / job.progress.total) * 100))
              : null,
          ),
        ),
        'in-progress',
        job.id,
      );
    }
  });

  // Stremio add-on protocol: /manifest.json and /subtitles/... (mounted last, after the UI routes).
  app.use(createStremioRouter({ config: current, jobs, logger }));

  // Never leak internals: map every failure to a safe response.
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    const e = isAppError(err) ? err : new AppError('STREMIO_REQUEST_INVALID');
    logger.warn({ errorCode: e.code }, 'request failed');
    res.status(e.httpStatus).type('text/plain').send(`${e.code}: ${e.userMessage}`);
  });

  return app;
}
