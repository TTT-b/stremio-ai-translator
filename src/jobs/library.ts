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
  /** Cache entries removed together with this subtitle. */
  keys: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(5000),
});

export type LibraryEntry = z.infer<typeof entrySchema>;

const fileSchema = z.object({ v: z.literal(1), entries: z.array(entrySchema) });

export class Library {
  private entries = new Map<string, LibraryEntry>();

  constructor(private readonly file: string) {
    try {
      const parsed = fileSchema.safeParse(JSON.parse(readFileSync(file, 'utf8')));
      if (parsed.success) for (const e of parsed.data.entries) this.entries.set(e.id, e);
    } catch {
      /* no index yet, or unreadable: start empty */
    }
  }

  has(id: string): boolean {
    return this.entries.has(id);
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
      this.save();
      return;
    }
    const keys = [...new Set([...old.keys, ...entry.keys])].slice(0, 5000);
    const timing = entry.timing ?? old.timing;
    const merged: LibraryEntry = {
      ...entry,
      ...(timing ? { timing } : {}),
      createdAt: old.createdAt,
      keys,
    };
    const same =
      keys.length === old.keys.length &&
      merged.timing === old.timing &&
      merged.cues === old.cues &&
      merged.bytes === old.bytes &&
      merged.title === old.title;
    if (same) return;
    this.entries.set(entry.id, merged);
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
