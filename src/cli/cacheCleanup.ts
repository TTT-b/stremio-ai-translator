import { resolve } from 'node:path';
import 'dotenv/config';
import { FileCache } from '../cache/fileCache';
import { loadConfig } from '../config/env';
import { createLogger } from '../logging/logger';

// Usage: npm run cache:cleanup  - removes expired and corrupt cache entries.
const config = loadConfig();
const logger = createLogger({ level: 'warn', secrets: () => [], console: false });
const cache = new FileCache(
  resolve(process.cwd(), 'data', 'cache'),
  config.cacheTtlDays * 86_400_000,
  logger,
);
const { removed, kept } = cache.cleanup();
console.log(`Cache cleanup done: removed ${removed}, kept ${kept}.`);
