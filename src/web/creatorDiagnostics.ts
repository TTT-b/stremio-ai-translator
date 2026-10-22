// CREATOR ONLY - delete this file, its two hooks in server.ts and html.ts, and its test before merging to main.
import type { Express } from 'express';
import { recentVideoIds } from '../logging/diagnostics';
import type { LibraryEntry } from '../jobs/library';

/** On only when the add-on runs from the code with CREATOR_DIAGNOSTICS=1, never in the packaged app. */
export const creatorMode = (): boolean => process.env.CREATOR_DIAGNOSTICS === '1';

/** "#  video  title", matching the numbers of the table in the normal diagnostics. */
export function titleLines(logDir: string, entries: LibraryEntry[]): string[] {
  const ids = recentVideoIds(logDir);
  if (ids.length === 0) return [];
  const titles = new Map(entries.map((e) => [e.titleKey, e.title]));
  return [
    'titles (creator only):',
    ...ids.map((id, i) => {
      const imdb = id.split(' ')[0] ?? id;
      return `${String(i + 1).padStart(2)}  ${id}  ${titles.get(`imdb:${imdb}`) ?? '?'}`;
    }),
  ];
}

/** GET /api/diagnostics-titles: the titles of the table's videos; 404 unless creator mode is on. */
export function registerCreatorDiagnostics(
  app: Express,
  logDir: string | undefined,
  entries: () => LibraryEntry[],
): void {
  app.get('/api/diagnostics-titles', (_req, res) => {
    if (!creatorMode() || !logDir) {
      res.status(404).end();
      return;
    }
    res.type('text/plain').send(titleLines(logDir, entries()).join('\n'));
  });
}
