import { mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import pino, { type Logger } from 'pino';
import pretty from 'pino-pretty';
import { createRedactor } from './redact';

export type Stage =
  | 'CONFIG'
  | 'STREMIO'
  | 'SOURCE'
  | 'DOWNLOAD'
  | 'PARSER'
  | 'CACHE'
  | 'CHUNK'
  | 'API'
  | 'VALIDATION'
  | 'ASSEMBLY'
  | 'DELIVERY';

export interface LoggerOptions {
  level: string;
  /** Called on every log line so secrets loaded later are still redacted. */
  secrets: () => string[];
  /** Directory for the rotating daily log file. Omit to log to the console only. */
  logDir?: string;
  /** Write to the console (disabled in tests). */
  console?: boolean;
  /** Keep this many days of log files. */
  retentionDays?: number;
}

export function pruneOldLogs(dir: string, retentionDays: number, now = Date.now()): void {
  try {
    for (const name of readdirSync(dir)) {
      if (!/^app-\d{4}-\d{2}-\d{2}\.log$/.test(name)) continue;
      const path = join(dir, name);
      if (now - statSync(path).mtimeMs > retentionDays * 86_400_000) unlinkSync(path);
    }
  } catch {
    /* best effort */
  }
}

export function createLogger(opts: LoggerOptions): Logger {
  const { scrub, scrubString } = createRedactor(opts.secrets);
  const streams: pino.StreamEntry[] = [];

  if (opts.console !== false) {
    streams.push({
      stream: pretty({ colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }),
    });
  }
  if (opts.logDir) {
    mkdirSync(opts.logDir, { recursive: true });
    pruneOldLogs(opts.logDir, opts.retentionDays ?? 14);
    const day = new Date().toISOString().slice(0, 10);
    streams.push({
      stream: pino.destination({ dest: join(opts.logDir, `app-${day}.log`), sync: false }),
    });
  }

  return pino(
    {
      level: opts.level,
      base: undefined,
      formatters: {
        log: (obj) => scrub(obj) as Record<string, unknown>,
      },
      hooks: {
        logMethod(args, method) {
          const [first, ...rest] = args as [unknown, ...unknown[]];
          if (typeof first === 'string') {
            method.apply(this, [scrubString(first), ...rest] as Parameters<typeof method>);
          } else {
            const msg = typeof rest[0] === 'string' ? scrubString(rest[0]) : rest[0];
            method.apply(this, [first, msg, ...rest.slice(1)] as Parameters<typeof method>);
          }
        },
      },
    },
    pino.multistream(streams),
  );
}

export type { Logger };
