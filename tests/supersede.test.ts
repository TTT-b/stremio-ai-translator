import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
import type { JobManager, JobSpec } from '../src/jobs/manager';
import { createApp } from '../src/web/server';
import { FakeProvider, silentLogger } from './helpers';

const never = () => new Promise<never>(() => undefined);

const spec = (over: Partial<JobSpec> = {}, episode = 1): JobSpec => ({
  video: {
    type: 'series',
    idKind: 'imdb',
    externalId: 'tt0903747',
    imdbId: 'tt0903747',
    season: 1,
    episode,
  },
  targetLanguage: 'he',
  filename: 'Show.S01E01.720p.mkv',
  ...over,
});

let manager: JobManager;

/** A manager whose jobs stay running: the source search never answers. */
async function startManager(): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), 'supersede-'));
  writeFileSync(
    join(dataDir, 'settings.json'),
    JSON.stringify({ prefetchNext: false, soundCheck: 'wait' }),
  );
  const app = createApp({
    config: loadConfig({ PORT: '38123', GEMINI_API_KEY: 'k'.repeat(12), SUB_WAIT_MS: '2000' }),
    logger: silentLogger(),
    settingsPath: join(dataDir, 'settings.json'),
    envPath: join(dataDir, '.env'),
    dataDir,
    createProvider: () => new FakeProvider(),
    createSourceProvider: () => ({
      getProviderName: () => 'fake-source',
      testConnection: async () => ({
        ok: true,
        provider: 'fake-source',
        model: '-',
        message: 'ok',
      }),
      search: never,
      download: never,
    }),
    loadEmbedded: async () => undefined,
    speechFit: async () => undefined,
    cueFit: async () => undefined,
    limits: { syncFindWaitMs: 0 },
    onReady: (ctx) => {
      manager = ctx.jobs;
    },
    fetchImpl: (async () =>
      new Response(JSON.stringify({ meta: { name: 'Test Show' } }), {
        status: 200,
      })) as typeof fetch,
  });
  void app;
}

beforeEach(startManager);

describe('a request for another video file of the same episode (supersedeOthers)', () => {
  it('skips the search of the older running job', () => {
    const older = manager.ensure(spec());
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }));
    expect(older.searchSkipped).toBe(true);
    expect(older.syncStopped).toBeUndefined();
  });

  it('also stops the sound check of the older job when it had one running', () => {
    const older = manager.ensure(spec());
    older.syncPercent = 40;
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }));
    expect(older.searchSkipped).toBe(true);
    expect(older.syncStopped).toBe(true);
  });

  it('also stops the sound check of the older job when it was waiting for one', () => {
    const older = manager.ensure(spec());
    older.syncWaiting = true;
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }));
    expect(older.syncStopped).toBe(true);
  });

  it('does not touch the new job itself', () => {
    manager.ensure(spec());
    const newer = manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }));
    expect(newer.searchSkipped).toBeUndefined();
    expect(newer.syncStopped).toBeUndefined();
  });

  it('does nothing when the file name is the same', () => {
    const older = manager.ensure(spec());
    older.syncPercent = 40;
    manager.ensure(spec({ movieHash: 'abcdef0123456789' }));
    expect(older.searchSkipped).toBeUndefined();
    expect(older.syncStopped).toBeUndefined();
  });

  it('does nothing for a different episode', () => {
    const other = manager.ensure(spec({}, 2));
    other.syncPercent = 40;
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }, 1));
    expect(other.searchSkipped).toBeUndefined();
    expect(other.syncStopped).toBeUndefined();
  });

  it('does nothing when the new request has no file name', () => {
    const older = manager.ensure(spec());
    older.syncPercent = 40;
    const noFile = spec();
    delete noFile.filename;
    manager.ensure(noFile);
    expect(older.searchSkipped).toBeUndefined();
    expect(older.syncStopped).toBeUndefined();
  });

  it('does nothing when the new request is a prefetch', () => {
    const older = manager.ensure(spec());
    older.syncPercent = 40;
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv', prefetch: true }));
    expect(older.searchSkipped).toBeUndefined();
    expect(older.syncStopped).toBeUndefined();
  });

  it('does nothing when the new job is a restored one', () => {
    const older = manager.ensure(spec());
    older.syncPercent = 40;
    manager.ensure(spec({ filename: 'Show.S01E01.1080p.mkv' }), true);
    expect(older.searchSkipped).toBeUndefined();
    expect(older.syncStopped).toBeUndefined();
  });
});
