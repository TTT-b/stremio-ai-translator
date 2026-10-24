import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { z } from 'zod';

/**
 * Index of the subtitles this app has produced, so the page can list them by title and delete
 * some or all. Holds titles and numbers only, never subtitle text. Stored as one small JSON file.
 */
const entrySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  kind: z.enum(['movie', 'series']),
  /** Stable per title, e.g. "imdb:tt0944947"; episodes of one series share it. */
  titleKey: z.string().max(80),
  title: z.string().max(200),
  season: z.number().int().optional(),
  episode: z.number().int().optional(),
  language: z.string().max(16),
  cues: z.number().int(),
  bytes: z.number().int(),
  createdAt: z.number(),
  /** Timing from the video itself or a hash match ('exact'), placed on the speech ('speech'), or guessed ('estimated'). */
  timing: z.enum(['exact', 'speech', 'estimated']).optional(),
  /** Where the source subtitle came from, so the sources can be compared. */
  source: z
    .object({
      provider: z.enum(['subdl', 'opensubtitles', 'jimaku', 'video']),
      language: z.string().max(16),
      kind: z.enum(['direct', 'translate']),
    })
    .optional(),
  /** File name of the video this was made for, to find it again on Stremio's server. */
  filename: z.string().max(300).optional(),
  /** Cache entries removed together with this subtitle. */
  keys: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(5000),
  /**
   * Stremio asks twice for one episode (two job ids). They are one line in the list: the other
   * ids are kept here so the app still knows that subtitle was made.
   */
  alias: z
    .array(z.string().regex(/^[0-9a-f]{32}$/))
    .max(50)
    .optional(),
});

export type LibraryEntry = z.infer<typeof entrySchema>;

const fileSchema = z.object({ v: z.literal(1), entries: z.array(entrySchema) });

export class Library {
  private entries = new Map<string, LibraryEntry>();

  constructor(private readonly file: string) {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.success) {
        for (const e of parsed.data.entries) this.entries.set(e.id, e);
        // Entries saved before the same episode was merged into one line.
        let merged = false;
        for (const e of [...this.entries.values()]) merged = this.collapse(e.id) || merged;
        if (merged) this.save();
      }
    } catch {
      /* no index yet, or unreadable: start empty */
    }
  }

  has(id: string): boolean {
    return (
      this.entries.has(id) || [...this.entries.values()].some((e) => e.alias?.includes(id) ?? false)
    );
  }

  /**
   * One line per episode (and language): every other entry for the same one is folded into the
   * given entry, keeping its cache keys (so deleting removes everything) and its ids. The better
   * known timing and the video file name are kept. Returns true when something was folded.
   */
  private collapse(id: string): boolean {
    const main = this.entries.get(id);
    if (!main) return false;
    const twins = [...this.entries.values()].filter(
      (o) =>
        o.id !== main.id &&
        o.titleKey === main.titleKey &&
        o.season === main.season &&
        o.episode === main.episode &&
        o.language === main.language,
    );
    if (twins.length === 0) return false;
    const rank = { exact: 3, speech: 2, estimated: 1 } as const;
    let timing = main.timing;
    let filename = main.filename;
    let source = main.source;
    let createdAt = main.createdAt;
    const keys = [...main.keys];
    const alias = [...(main.alias ?? [])];
    for (const t of twins) {
      this.entries.delete(t.id);
      keys.push(...t.keys);
      alias.push(t.id, ...(t.alias ?? []));
      if (t.timing && (!timing || rank[t.timing] > rank[timing])) timing = t.timing;
      filename ??= t.filename;
      source ??= t.source;
      createdAt = Math.min(createdAt, t.createdAt);
    }
    this.entries.set(main.id, {
      ...main,
      keys: [...new Set(keys)].slice(0, 5000),
      alias: [...new Set(alias)].slice(0, 50),
      createdAt,
      ...(timing ? { timing } : {}),
      ...(filename ? { filename } : {}),
      ...(source ? { source } : {}),
    });
    return true;
  }

  get(id: string): LibraryEntry | undefined {
    return this.entries.get(id);
  }

  list(): LibraryEntry[] {
    return [...this.entries.values()].sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * List a subtitle, or refresh its entry when it is made again: the earlier cache keys are kept
   * (so deleting removes everything that was ever stored for it), and so is the date. Nothing is written when nothing changed.
   */
  add(entry: LibraryEntry): void {
    const old = this.entries.get(entry.id);
    if (!old) {
      this.entries.set(entry.id, entry);
      this.collapse(entry.id);
      this.save();
      return;
    }
    const keys = [...new Set([...old.keys, ...entry.keys])].slice(0, 5000);
    const timing = entry.timing ?? old.timing;
    const filename = entry.filename ?? old.filename;
    const source = entry.source ?? old.source;
    const merged: LibraryEntry = {
      ...entry,
      ...(source ? { source } : {}),
      ...(timing ? { timing } : {}),
      ...(filename ? { filename } : {}),
      createdAt: old.createdAt,
      keys,
      ...(old.alias ? { alias: old.alias } : {}),
    };
    const same =
      keys.length === old.keys.length &&
      merged.timing === old.timing &&
      merged.filename === old.filename &&
      merged.cues === old.cues &&
      merged.bytes === old.bytes &&
      merged.title === old.title;
    if (same) return;
    this.entries.set(entry.id, merged);
    this.collapse(entry.id);
    this.save();
  }

  /** Remove the given ids; returns the entries that existed so the caller can drop their files. */
  remove(ids: string[]): LibraryEntry[] {
    const gone: LibraryEntry[] = [];
    for (const id of ids) {
      const e = this.entries.get(id);
      if (e) {
        gone.push(e);
        this.entries.delete(id);
      }
    }
    if (gone.length > 0) this.save();
    return gone;
  }

  clear(): LibraryEntry[] {
    return this.remove([...this.entries.keys()]);
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ v: 1, entries: this.list() }), 'utf8');
      renameSync(tmp, this.file);
    } catch {
      /* the list is a convenience; translations keep working without it */
    }
  }
}

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** A safe file name for saving a subtitle: "Title S01E15.he.srt" (no characters Windows refuses). */
export function srtFileName(
  entry: Pick<LibraryEntry, 'title' | 'season' | 'episode' | 'language'>,
): string {
  const title =
    [...entry.title]
      .filter((ch) => ch.charCodeAt(0) >= 32)
      .join('')
      .replace(/[\\/:*?"<>|]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'subtitle';
  const episode =
    entry.season !== undefined && entry.episode !== undefined
      ? ` S${pad2(entry.season)}E${pad2(entry.episode)}`
      : '';
  const language = entry.language.replace(/[^A-Za-z0-9-]/g, '').slice(0, 16);
  return `${title}${episode}${language ? '.' + language : ''}.srt`;
}
