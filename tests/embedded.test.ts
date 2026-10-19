import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  decodeSubtitleBytes,
  findSidecars,
  findStream,
  languageMatches,
  loadEmbeddedSubtitle,
  rankTracks,
  type Exec,
} from '../src/sources/embedded';
import { silentLogger } from './helpers';

const HASH = 'ba0b39de2c19ceadcfb1b441d8b6d668e57458ef';
const FILE = 'Show - S01E08 - Winter Solstice.mkv';

const stats = (files: string[] = [`Show [1080p]\\Book One\\${FILE}`]) =>
  JSON.stringify({
    [HASH]: { infoHash: HASH, name: 'Show', files: files.map((path) => ({ path, length: 1 })) },
  });

const fetchStats = (body: string, status = 200): typeof fetch =>
  (async () => new Response(body, { status })) as typeof fetch;

const srt = (n: number) =>
  Array.from(
    { length: n },
    (_, i) =>
      `${i + 1}\n00:00:${String(i % 60).padStart(2, '0')},000 --> 00:00:${String(i % 60).padStart(2, '0')},500\nLine ${i}\n`,
  ).join('\n');

const tools = () => {
  const dir = mkdtempSync(join(tmpdir(), 'tools-'));
  writeFileSync(join(dir, 'ffmpeg.exe'), '');
  writeFileSync(join(dir, 'ffprobe.exe'), '');
  return dir;
};

const probe = (streams: object[]) => Buffer.from(JSON.stringify({ streams }));

describe('languageMatches', () => {
  it('maps two-letter codes onto ffprobe language tags', () => {
    expect(languageMatches('heb', 'he')).toBe(true);
    expect(languageMatches('eng', 'en')).toBe(true);
    expect(languageMatches('en-US', 'en')).toBe(true);
    expect(languageMatches('eng', 'he')).toBe(false);
    expect(languageMatches(undefined, 'en')).toBe(false);
  });
});

describe('rankTracks', () => {
  const t = (index: number, language: string, title = '') => ({ index, language, title });

  it('prefers the target language, then the source language, full dialogue before SDH', () => {
    const ranked = rankTracks(
      [t(2, 'eng', 'SDH'), t(3, 'eng'), t(4, 'heb'), t(5, 'fre')],
      'he',
      'en',
    );
    expect(ranked.map((r) => [r.track.index, r.language])).toEqual([
      [4, 'he'],
      [3, 'en'],
      [2, 'en'],
    ]);
  });

  it('never uses forced or commentary tracks', () => {
    expect(rankTracks([t(2, 'eng', 'Forced'), t(3, 'eng', 'Commentary')], 'he', 'en')).toEqual([]);
  });
});

describe('findStream', () => {
  it('finds the torrent file that has the playing file name', async () => {
    const r = await findStream('http://127.0.0.1:11470', FILE.toUpperCase(), fetchStats(stats()));
    expect(r).toMatchObject({
      infoHash: HASH,
      fileIdx: 0,
      url: `http://127.0.0.1:11470/${HASH}/0`,
    });
  });

  it('returns nothing for a file that is not on the local server', async () => {
    expect(
      await findStream('http://127.0.0.1:11470', 'Other.mkv', fetchStats(stats())),
    ).toBeUndefined();
    expect(await findStream('http://127.0.0.1:11470', FILE, fetchStats('{}', 500))).toBeUndefined();
    expect(await findStream('http://127.0.0.1:11470', FILE, fetchStats('{"x":1}'))).toBeUndefined();
  });
});

describe('loadEmbeddedSubtitle', () => {
  const run = (over: {
    exec: Exec;
    stats?: string;
    toolDirs?: string[];
    waitMs?: number;
    sleep?: (ms: number) => Promise<void>;
    fetchImpl?: typeof fetch;
  }) =>
    loadEmbeddedSubtitle(
      { filename: FILE, targetLanguage: 'he' },
      {
        serverUrl: 'http://127.0.0.1:11470',
        ffmpegPath: '',
        logger: silentLogger(),
        fetchImpl: over.fetchImpl ?? fetchStats(over.stats ?? stats()),
        exec: over.exec,
        waitMs: over.waitMs ?? 0,
        ...(over.sleep ? { sleep: over.sleep } : {}),
        toolDirs: over.toolDirs ?? [tools()],
      },
    );

  it('reads the English track of the playing file', async () => {
    const calls: string[][] = [];
    const out = await run({
      exec: async (_cmd, args) => {
        calls.push(args);
        return args.includes('json')
          ? probe([{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }])
          : Buffer.from(srt(40));
      },
    });
    expect(out).toMatchObject({ language: 'en', cues: 40, streamIndex: 2 });
    const extract = calls.find((a) => a.includes('-map'))!;
    expect(extract).toContain(`http://127.0.0.1:11470/${HASH}/0`);
    expect(extract).toContain('0:2');
  });

  it('prefers a track in the target language', async () => {
    const out = await run({
      exec: async (_cmd, args) =>
        args.includes('json')
          ? probe([
              { index: 2, codec_name: 'subrip', tags: { language: 'eng' } },
              { index: 3, codec_name: 'subrip', tags: { language: 'heb' } },
            ])
          : Buffer.from(srt(30)),
    });
    expect(out).toMatchObject({ language: 'he', streamIndex: 3 });
  });

  it('removes the <font> styling that ffmpeg adds to converted mp4 tracks', async () => {
    const styled = srt(30).replace(/Line (\d+)/g, '<font face="Serif" size="18">Line $1</font>');
    const out = await run({
      exec: async (_cmd, args) =>
        args.includes('json')
          ? probe([{ index: 2, codec_name: 'mov_text', tags: { language: 'eng' } }])
          : Buffer.from(styled),
    });
    expect(out?.raw).toContain('Line 0');
    expect(out?.raw).not.toMatch(/<\/?font/i);
  });
  it('waits for the torrent to appear on the local server, then uses it', async () => {
    let lookups = 0;
    const slept: number[] = [];
    const out = await run({
      waitMs: 8000,
      sleep: async (ms) => {
        slept.push(ms);
      },
      fetchImpl: (async () => new Response(++lookups < 3 ? '{}' : stats())) as typeof fetch,
      exec: async (_cmd, args) =>
        args.includes('json')
          ? probe([{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }])
          : Buffer.from(srt(30)),
    });
    expect(out).toMatchObject({ language: 'en', cues: 30 });
    expect(slept).toEqual([1000, 1000]);
  });

  it('gives up after the wait when the video never shows up', async () => {
    const slept: number[] = [];
    const out = await run({
      waitMs: 3000,
      sleep: async (ms) => {
        slept.push(ms);
      },
      exec: async () => {
        throw new Error('must not run');
      },
      stats: stats(['Other\\file.mkv']),
    });
    expect(out).toBeUndefined();
    expect(slept).toHaveLength(3);
  });
  it('ignores picture subtitle tracks', async () => {
    const out = await run({
      exec: async () =>
        probe([{ index: 2, codec_name: 'hdmv_pgs_subtitle', tags: { language: 'eng' } }]),
    });
    expect(out).toBeUndefined();
  });

  it('tries the next track when one is too short, and gives up quietly otherwise', async () => {
    const out = await run({
      exec: async (_cmd, args) => {
        if (args.includes('json')) {
          return probe([
            { index: 2, codec_name: 'subrip', tags: { language: 'eng', title: 'Signs' } },
            { index: 3, codec_name: 'subrip', tags: { language: 'eng' } },
          ]);
        }
        return Buffer.from(srt(args.includes('0:3') ? 25 : 2));
      },
    });
    expect(out).toMatchObject({ streamIndex: 3 });
    expect(await run({ exec: async () => Buffer.from('not json') })).toBeUndefined();
    expect(
      await run({
        exec: async () => {
          throw new Error('boom');
        },
      }),
    ).toBeUndefined();
  });

  it('does nothing without ffmpeg or when the video is not on the local server', async () => {
    const exec: Exec = async () => {
      throw new Error('must not run');
    };
    expect(await run({ exec, toolDirs: [mkdtempSync(join(tmpdir(), 'empty-'))] })).toBeUndefined();
    expect(await run({ exec, stats: stats(['Other\\file.mkv']) })).toBeUndefined();
  });
});

describe('subtitle files shipped in the torrent', () => {
  const files = (paths: [string, number][]) => paths.map(([path, length]) => ({ path, length }));
  const video = 'Show.S01.1080p-GRP\\Show.S01E09.1080p-GRP.mp4';

  it('matches the folder named like the video, target language first, smaller file first', () => {
    const out = findSidecars(
      {
        videoPath: video,
        files: files([
          [video, 400_000],
          ['Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\3_English.srt', 30_000],
          ['Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\2_English.srt', 28_000],
          ['Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\1_Hebrew.srt', 20_000],
          ['Show.S01.1080p-GRP\\Subs\\Show.S01E10.1080p-GRP\\2_English.srt', 1_000],
          ['Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\4_French.srt', 1_000],
        ]),
      },
      'he',
      'en',
    );
    expect(out.map((s) => [s.index, s.language])).toEqual([
      [3, 'he'],
      [2, 'en'],
      [1, 'en'],
    ]);
  });

  it('also finds subtitle files named like the video, and ignores other episodes', () => {
    const out = findSidecars(
      {
        videoPath: 'Movie.2020.mkv',
        files: files([
          ['Movie.2020.mkv', 1],
          ['Movie.2020.en.srt', 5],
          ['Other.Movie.en.srt', 5],
          ['notes.txt', 5],
        ]),
      },
      'he',
      'en',
    );
    expect(out.map((s) => s.path)).toEqual(['Movie.2020.en.srt']);
  });

  it('reads a subtitle file from the local server when the video has no embedded track', async () => {
    const wanted = 'Show.S01E09.1080p-GRP.mp4';
    const paths = [
      'Show.S01.1080p-GRP\\Show.S01E09.1080p-GRP.mp4',
      'Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\2_English.srt',
    ];
    const requested: string[] = [];
    const out = await loadEmbeddedSubtitle(
      { filename: wanted, targetLanguage: 'he' },
      {
        serverUrl: 'http://127.0.0.1:11470',
        ffmpegPath: '',
        logger: silentLogger(),
        waitMs: 0,
        toolDirs: [mkdtempSync(join(tmpdir(), 'empty-'))],
        fetchImpl: (async (input: string | URL | Request) => {
          const url = String(input);
          requested.push(url);
          return url.endsWith('/stats.json') ? new Response(stats(paths)) : new Response(srt(40));
        }) as typeof fetch,
      },
    );
    expect(out).toMatchObject({ language: 'en', cues: 40, source: 'file' });
    expect(requested).toContain(`http://127.0.0.1:11470/${HASH}/1`);
  });

  it('decodes UTF-8, UTF-16 and Windows-1252 subtitle bytes', () => {
    expect(
      decodeSubtitleBytes(Buffer.from(`\uFEFFhello ${'\u05E9\u05DC\u05D5\u05DD'}`, 'utf8')),
    ).toBe(`hello ${'\u05E9\u05DC\u05D5\u05DD'}`);
    expect(decodeSubtitleBytes(Buffer.from('\uFEFFhi', 'utf16le'))).toBe('hi');
    expect(decodeSubtitleBytes(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]))).toBe('café');
  });
});

describe('a video that is still loading', () => {
  const paths = ['Show.S01/Show.S01E11.mkv'];
  const query = { filename: 'Show.S01E11.mkv', targetLanguage: 'he' };
  const probe = JSON.stringify({
    streams: [{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }],
  });
  const deps = (over: Partial<Parameters<typeof loadEmbeddedSubtitle>[1]>) => ({
    serverUrl: 'http://127.0.0.1:11470',
    ffmpegPath: '',
    logger: silentLogger(),
    waitMs: 0,
    toolDirs: [tools()],
    fetchImpl: (async () => new Response(stats(paths))) as typeof fetch,
    ...over,
  });

  it('tries again when the track exists but cannot be read yet, and uses it once it can', async () => {
    let reads = 0;
    const out = await loadEmbeddedSubtitle(
      query,
      deps({
        budgetMs: 2000,
        retryBudgetMs: 60_000, // the lookup may go on for a while
        retryGapMs: 0,
        sleep: async () => undefined,
        exec: async (cmd) => {
          if (/ffprobe/i.test(cmd)) return Buffer.from(probe);
          reads++;
          if (reads < 3) throw new Error('not downloaded yet'); // the video is still loading
          return Buffer.from(srt(40));
        },
      }),
    );
    expect(out?.cues).toBe(40);
    expect(reads).toBe(3);
  });

  it('does not wait when there are no tracks at all', async () => {
    let calls = 0;
    const out = await loadEmbeddedSubtitle(
      query,
      deps({
        budgetMs: 2000,
        retryBudgetMs: 60_000,
        retryGapMs: 0,
        sleep: async () => undefined,
        exec: async (cmd) => {
          calls++;
          return /ffprobe/i.test(cmd)
            ? Buffer.from(JSON.stringify({ streams: [] }))
            : Buffer.from('');
        },
      }),
    );
    expect(out).toBeUndefined();
    expect(calls).toBe(1); // only the one probe
  });

  it('stops trying when the user cancels', async () => {
    let reads = 0;
    let stop = false;
    const out = await loadEmbeddedSubtitle(
      query,
      deps({
        budgetMs: 2000,
        retryBudgetMs: 60_000,
        retryGapMs: 0,
        sleep: async () => undefined,
        shouldStop: () => stop,
        exec: async (cmd) => {
          if (/ffprobe/i.test(cmd)) return Buffer.from(probe);
          reads++;
          stop = true;
          throw new Error('not downloaded yet');
        },
      }),
    );
    expect(out).toBeUndefined();
    expect(reads).toBe(1);
  });
});

describe('time budget', () => {
  const paths = [
    'Show.S01.1080p-GRP\\Show.S01E09.1080p-GRP.mp4',
    'Show.S01.1080p-GRP\\Subs\\Show.S01E09.1080p-GRP\\2_English.srt',
  ];
  const base = (over: Partial<Parameters<typeof loadEmbeddedSubtitle>[1]>) => ({
    serverUrl: 'http://127.0.0.1:11470',
    ffmpegPath: '',
    logger: silentLogger(),
    waitMs: 0,
    toolDirs: [tools()],
    fetchImpl: (async (input: string | URL | Request) =>
      String(input).endsWith('/stats.json')
        ? new Response(stats(paths))
        : new Response(srt(40))) as typeof fetch,
    ...over,
  });
  const query = { filename: 'Show.S01E09.1080p-GRP.mp4', targetLanguage: 'he' };

  it('does nothing when there is no time left', async () => {
    let calls = 0;
    const out = await loadEmbeddedSubtitle(
      query,
      base({
        budgetMs: 0,
        exec: async () => {
          calls++;
          return Buffer.from('');
        },
      }),
    );
    expect(out).toBeUndefined();
    expect(calls).toBe(0);
  });

  it('never gives ffprobe or ffmpeg more than the time that is left', async () => {
    const limits: number[] = [];
    const out = await loadEmbeddedSubtitle(
      { ...query, filename: 'Movie.mkv' },
      base({
        budgetMs: 20_000,
        fetchImpl: fetchStats(stats(['Movie.mkv'])),
        exec: async (_cmd, args, opts) => {
          limits.push(opts.timeoutMs);
          if (args.includes('json')) {
            return probe([{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }]);
          }
          throw new Error('timeout'); // the file is not downloaded: reading it would stall
        },
      }),
    );
    expect(out).toBeUndefined();
    expect(limits.length).toBeGreaterThanOrEqual(2);
    for (const ms of limits) expect(ms).toBeLessThanOrEqual(20_000);
  });

  it('prefers the quick subtitle file over reading the video, and a failed read does not stop it', async () => {
    const extractions: string[][] = [];
    let first = true;
    const out = await loadEmbeddedSubtitle(
      query,
      base({
        exec: async (_cmd, args) => {
          if (args.includes('json')) {
            return probe([{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }]);
          }
          extractions.push(args);
          return Buffer.from(srt(30));
        },
        fetchImpl: (async (input: string | URL | Request) => {
          if (String(input).endsWith('/stats.json')) return new Response(stats(paths));
          if (first) {
            first = false;
            throw new Error('not downloaded yet');
          }
          return new Response(srt(40));
        }) as typeof fetch,
      }),
    );
    // The file read failed once, so the English track inside the video was used instead.
    expect(out).toMatchObject({ language: 'en', source: 'track' });
    expect(extractions).toHaveLength(1);

    first = false;
    const quick = await loadEmbeddedSubtitle(
      query,
      base({
        exec: async (_cmd, args) => {
          if (args.includes('json')) {
            return probe([{ index: 2, codec_name: 'subrip', tags: { language: 'eng' } }]);
          }
          throw new Error('must not read the video');
        },
      }),
    );
    expect(quick).toMatchObject({ language: 'en', source: 'file' });
  });
});
