import { resolve } from 'node:path';
import 'dotenv/config';
import { loadConfig, secretValues, type Config } from './config/env';
import { isAppError } from './errors';
import { createLogger } from './logging/logger';
import { createApp } from './web/server';

let config: Config;
try {
  config = loadConfig();
} catch (err) {
  // Logger is not available yet; the message names variables, never values.
  console.error(`[CONFIG] ${isAppError(err) ? err.message : 'Unknown configuration error'}`);
  console.error('[CONFIG] Fix the .env file (see .env.example) and start again.');
  process.exit(1);
}

const logger = createLogger({
  level: config.logLevel,
  secrets: () => secretValues(config),
  logDir: resolve(process.cwd(), 'logs'),
});

logger.info(
  {
    stage: 'CONFIG',
    port: config.port,
    targetLanguage: config.targetLanguage,
    model: config.geminiModel,
    geminiKey: config.geminiApiKey !== '',
    openSubtitlesKey: config.openSubtitlesApiKey !== '',
  },
  'configuration loaded',
);

const app = createApp({
  config,
  logger,
  onConfigChange: (next) => {
    config = next; // keeps log redaction aware of newly saved keys
  },
});
const server = app.listen(config.port, config.host, () => {
  logger.info({ stage: 'CONFIG' }, `Open http://127.0.0.1:${config.port}/ in your browser`);
});
server.on('error', (err: NodeJS.ErrnoException) => {
  logger.error(
    { stage: 'CONFIG', code: err.code },
    err.code === 'EADDRINUSE'
      ? `Port ${config.port} is already in use. Change PORT in .env or stop the other program.`
      : 'Server failed to start',
  );
  process.exit(1);
});

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    logger.info({ stage: 'CONFIG' }, 'shutting down');
    server.close(() => process.exit(0));
  });
}
