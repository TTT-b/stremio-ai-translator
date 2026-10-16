import { config as loadDotenv } from 'dotenv';
import type { Server } from 'node:http';
import { resolve } from 'node:path';
import type { Logger } from 'pino';
import { loadConfig, secretValues, type Config } from './config/env';
import { AppError } from './errors';
import { createLogger } from './logging/logger';
import { createApp } from './web/server';

export interface RunningAddon {
  server: Server;
  logger: Logger;
  port: number;
  stop: () => Promise<void>;
}

/**
 * Start the add-on with every file (.env, settings.json, data/, logs/) under `root`.
 * Rejects with an AppError instead of exiting, so the caller decides how to show it.
 */
export function startAddon(root: string): Promise<RunningAddon> {
  const envPath = resolve(root, '.env');
  loadDotenv({ path: envPath, quiet: true });
  const config: Config = loadConfig();
  let current = config;

  const logger = createLogger({
    level: config.logLevel,
    secrets: () => secretValues(current),
    logDir: resolve(root, 'logs'),
  });
  logger.info(
    {
      stage: 'CONFIG',
      port: config.port,
      targetLanguage: config.targetLanguage,
      provider: config.aiProvider,
      model: config.aiModel,
      aiKey: config.aiApiKey !== '',
      openSubtitlesKey: config.openSubtitlesApiKey !== '',
    },
    'configuration loaded',
  );

  const app = createApp({
    config,
    logger,
    envPath,
    settingsPath: resolve(root, 'settings.json'),
    dataDir: resolve(root, 'data'),
    onConfigChange: (next) => {
      current = next; // keeps log redaction aware of newly saved keys
    },
  });

  return new Promise((resolvePromise, reject) => {
    const server = app.listen(config.port, config.host, () => {
      logger.info({ stage: 'CONFIG' }, `Open http://127.0.0.1:${config.port}/ in your browser`);
      resolvePromise({
        server,
        logger,
        port: config.port,
        stop: () => new Promise<void>((done) => server.close(() => done())),
      });
    });
    server.on('error', (err: NodeJS.ErrnoException) => {
      reject(
        err.code === 'EADDRINUSE'
          ? new AppError(
              'CONFIGURATION_INVALID',
              `Port ${config.port} is already in use. Close the other copy of the app or change PORT.`,
            )
          : new AppError('CONFIGURATION_INVALID', 'Server failed to start'),
      );
    });
  });
}
