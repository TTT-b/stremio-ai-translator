import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';
import { AppError } from '../errors';
import type { Logger } from '../logging/logger';
import { MAX_NAMES_PER_SERIES, MAX_SERIES, type GlossaryNames } from './glossary';

const nameSchema = z.object({
  /** The spelling in the target language. */
  t: z.string().min(1).max(60),
  /** In how many episodes this spelling was seen (used to drop the least certain names first). */
  n: z.number().int().min(1),
});

const fileSchema = z.object({
  v: z.literal(1),
  series: z.record(
    z.string().max(40),
    z.object({
      /** Last time the series was translated or looked up; retention cleanup can use it. */
      lastUsed: z.number(),
      names: z.record(z.string().min(1).max(60), nameSchema),
    }),
  ),
});
type GlossaryFile = z.infer<typeof fileSchema>;

/**
 * One small JSON file with the names of each series, so every episode spells them the same way.
 * Capped in names per series and in series; a missing, corrupt or wrongly shaped file is empty.
 */
export class GlossaryStore {
  constructor(
    private readonly file: string,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now,
  ) {}

  /** The names learned for a series (and marks the series as used now). */
  get(seriesKey: string): GlossaryNames {
    const data = this.load();
    const entry = data.series[seriesKey];
    if (!entry) return {};
    try {
      this.save({
        ...data,
        series: { ...data.series, [seriesKey]: { ...entry, lastUsed: this.now() } },
      });
    } catch {
      /* the timestamp is a nicety: reading must not fail */
    }
    return Object.fromEntries(Object.entries(entry.names).map(([k, v]) => [k, v.t]));
  }

  /** Adds new names. A spelling already stored is never replaced, only confirmed. */
  learn(seriesKey: string, found: GlossaryNames): void {
    const data = this.load();
    const old = data.series[seriesKey]?.names ?? {};
    const names = { ...old };
    for (const [name, spelling] of Object.entries(found)) {
      const parsed = nameSchema.safeParse({ t: spelling, n: 1 });
      if (!parsed.success || name.length > 60) continue;
      const known = names[name];
      names[name] = known
        ? known.t === spelling
          ? { ...known, n: known.n + 1 }
          : known
        : parsed.data;
    }
    const kept = Object.entries(names)
      .map(([k, v], order) => ({ k, v, order }))
      .sort((a, b) => b.v.n - a.v.n || a.order - b.order)
      .slice(0, MAX_NAMES_PER_SERIES);
    const series = {
      ...data.series,
      [seriesKey]: { lastUsed: this.now(), names: Object.fromEntries(kept.map((e) => [e.k, e.v])) },
    };
    const newest = Object.entries(series)
      .sort((a, b) => b[1].lastUsed - a[1].lastUsed)
      .slice(0, MAX_SERIES);
    this.save({ v: 1, series: Object.fromEntries(newest) });
    this.logger.info(
      { stage: 'CACHE', names: kept.length, added: kept.length - Object.keys(old).length },
      'series names saved',
    );
  }

  private load(): GlossaryFile {
    let raw: string;
    try {
      raw = readFileSync(this.file, 'utf8');
    } catch {
      return { v: 1, series: {} };
    }
    try {
      return fileSchema.parse(JSON.parse(raw));
    } catch {
      this.logger.warn({ stage: 'CACHE', errorCode: 'CACHE_READ_FAILED' }, 'names file ignored');
      return { v: 1, series: {} };
    }
  }

  private save(data: GlossaryFile): void {
    const tmp = `${this.file}.${process.pid}.tmp`;
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, this.file);
    } catch {
      try {
        unlinkSync(tmp);
      } catch {
        /* nothing to remove */
      }
      throw new AppError('CACHE_WRITE_FAILED', 'names file');
    }
  }
}
