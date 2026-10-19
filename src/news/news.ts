import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Messages from the add-on's author to everyone who has the app (news and update notes). They
 * live in `news.json` in the GitHub repository; the app downloads that one small file now and
 * then (nothing about the user is sent) and keeps the last copy for when it is offline. The
 * page shows the text only: no HTML, and links must be https.
 */
export const NEWS_URL =
  'https://raw.githubusercontent.com/TTT-b/stremio-ai-translator/main/news.json';

const MAX_BYTES = 64 * 1024;
const REFRESH_MS = 30 * 60 * 1000;
const RETRY_MS = 60 * 1000;

const pair = (max: number) => z.object({ he: z.string().max(max), en: z.string().max(max) });

const itemSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,64}$/),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  title: pair(120),
  body: pair(1500),
  link: z
    .string()
    .regex(/^https:\/\/[^\s"'<>]{1,300}$/)
    .optional(),
});

export const newsFileSchema = z.object({ v: z.literal(1), items: z.array(itemSchema).max(50) });

export type NewsItem = z.infer<typeof itemSchema>;

const idsSchema = z.array(z.string().regex(/^[A-Za-z0-9._-]{1,64}$/)).max(200);

export interface NewsFeedOptions {
  url: string;
  /** Last downloaded copy, for offline use. */
  cacheFile: string;
  /** Ids of the messages the user has already opened. */
  seenFile: string;
  /** False = never go online (only the saved copy is shown). */
  enabled: boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class NewsFeed {
  private items: NewsItem[] = [];
  private seenIds = new Set<string>();
  private nextFetchAt = 0;
  private online = false;
  private inFlight: Promise<void> | undefined;

  constructor(private readonly opts: NewsFeedOptions) {
    this.items = this.readItems();
    try {
      const parsed = idsSchema.safeParse(JSON.parse(readFileSync(opts.seenFile, 'utf8')));
      if (parsed.success) this.seenIds = new Set(parsed.data);
    } catch {
      /* nothing seen yet */
    }
  }

  private readItems(): NewsItem[] {
    try {
      const parsed = newsFileSchema.safeParse(
        JSON.parse(readFileSync(this.opts.cacheFile, 'utf8')),
      );
      return parsed.success ? parsed.data.items : [];
    } catch {
      return [];
    }
  }

  private now(): number {
    return (this.opts.now ?? Date.now)();
  }

  private async refresh(): Promise<void> {
    const f = this.opts.fetchImpl ?? fetch;
    try {
      const res = await f(this.opts.url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_BYTES) throw new Error('too large');
      const parsed = newsFileSchema.parse(JSON.parse(text));
      this.items = parsed.items;
      this.online = true;
      this.nextFetchAt = this.now() + REFRESH_MS;
      try {
        mkdirSync(dirname(this.opts.cacheFile), { recursive: true });
        const tmp = `${this.opts.cacheFile}.tmp`;
        writeFileSync(tmp, JSON.stringify(parsed), 'utf8');
        renameSync(tmp, this.opts.cacheFile);
      } catch {
        /* the saved copy is a convenience */
      }
    } catch {
      this.online = false;
      this.nextFetchAt = this.now() + RETRY_MS; // keep showing the saved copy, try again soon
    }
  }

  /** Newest first. Never throws; offline or invalid data just keeps the saved copy. */
  async get(): Promise<{ items: NewsItem[]; online: boolean }> {
    if (this.opts.enabled && this.now() >= this.nextFetchAt) {
      this.inFlight ??= this.refresh().finally(() => {
        this.inFlight = undefined;
      });
      await this.inFlight;
    }
    const items = [...this.items].sort((a, b) => b.date.localeCompare(a.date));
    return { items, online: this.online };
  }

  seen(): string[] {
    return [...this.seenIds];
  }

  /** Remember that these were opened. Returns false for malformed input. */
  markSeen(ids: unknown): boolean {
    const parsed = idsSchema.safeParse(ids);
    if (!parsed.success) return false;
    for (const id of parsed.data) this.seenIds.add(id);
    try {
      mkdirSync(dirname(this.opts.seenFile), { recursive: true });
      const tmp = `${this.opts.seenFile}.tmp`;
      writeFileSync(tmp, JSON.stringify([...this.seenIds].slice(-500)), 'utf8');
      renameSync(tmp, this.opts.seenFile);
    } catch {
      /* worst case the same message shows as new once more */
    }
    return true;
  }
}

/** "1.10.0" sorts after "1.9.0": compare release versions numerically, newest first. */
export function compareVersionsDesc(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pb[i] ?? 0) - (pa[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
