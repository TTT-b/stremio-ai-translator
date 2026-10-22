// CREATOR ONLY - delete together with src/web/creatorDiagnostics.ts before merging to main.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { LibraryEntry } from '../src/jobs/library';
import { titleLines } from '../src/web/creatorDiagnostics';

describe('titleLines', () => {
  it('numbers the titles like the table and writes ? when the title is unknown', () => {
    const dir = mkdtempSync(join(tmpdir(), 'creator-'));
    writeFileSync(
      join(dir, 'app-2026-10-22.log'),
      ['tt1', 'tt2']
        .map((videoId) => JSON.stringify({ level: 30, videoId, msg: 'job done' }))
        .join('\n'),
    );
    const entries = [{ titleKey: 'imdb:tt1', title: 'Show One' }] as LibraryEntry[];
    const out = titleLines(dir, entries).join('\n');
    expect(out).toMatch(/1\s+tt1\s+Show One/);
    expect(out).toMatch(/2\s+tt2\s+\?/);
  });
});
