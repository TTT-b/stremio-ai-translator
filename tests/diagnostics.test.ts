import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { videoTable } from '../src/logging/diagnostics';

const logWith = (lines: object[]): string => {
  const dir = mkdtempSync(join(tmpdir(), 'diag-'));
  writeFileSync(
    join(dir, 'app-2026-10-22.log'),
    lines.map((l) => JSON.stringify({ level: 30, time: 1792334500000, ...l })).join('\n'),
  );
  return dir;
};

const done = (videoId: string, via: string, cues: number, durationMs: number) => ({
  videoId,
  stage: 'ASSEMBLY',
  msg: 'job done',
  via,
  cues,
  durationMs,
});

describe('videoTable', () => {
  it('says so when no video was handled yet', () => {
    expect(videoTable(logWith([{ stage: 'CONFIG', msg: 'started' }]))).toEqual([
      'videos: none yet',
    ]);
  });

  it('gives one row per video: where the subtitle came from, its timing and the sound check', () => {
    const dir = logWith([
      {
        videoId: 'tt1:1:4',
        stage: 'SOURCE',
        msg: 'embedded subtitle',
        embedded: 'used',
        via: 'track',
      },
      done('tt1:1:4', 'translated', 612, 14000),
      {
        videoId: 'tt2:2:4',
        stage: 'SOURCE',
        msg: 'subtitle selected',
        decision: 'direct',
        provider: 'opensubtitles',
        hashMatch: true,
      },
      done('tt2:2:4', 'direct', 540, 31000),
      {
        videoId: 'tt3',
        stage: 'SOURCE',
        msg: 'subtitle selected',
        decision: 'translate',
        provider: 'subdl',
        hashMatch: false,
      },
      {
        videoId: 'tt3',
        stage: 'SOURCE',
        msg: 'subtitle moved onto the speech',
        sync: 'fitted',
        offsetMs: -2500,
        scale: 1.0427,
        parts: '4m:+0.1 12m:-0.2 19m:+3.1',
      },
      done('tt3', 'translated', 1826, 152000),
      {
        videoId: 'tt4:1:31',
        stage: 'SOURCE',
        msg: 'subtitle selected',
        decision: 'direct',
        hashMatch: false,
      },
      { videoId: 'tt4:1:31', stage: 'SOURCE', msg: 'timing left as it was', sync: 'fit-unsure' },
      done('tt4:1:31', 'direct', 389, 96000),
    ]);
    const text = videoTable(dir).join('\n');
    expect(text).toMatch(/1\s+tt1:1:4\s+embedded\s+exact\s+not needed\s+14 s\s+612/);
    expect(text).toMatch(
      /2\s+tt2:2:4\s+opensubtitles, hash match\s+exact\s+not needed\s+31 s\s+540/,
    );
    expect(text).toMatch(
      /3\s+tt3\s+subdl \(translated\)\s+speech\s+moved -2\.5 s, x1\.0427\s+152 s\s+1826/,
    );
    expect(text).toMatch(/4\s+tt4:1:31\s+opensubtitles\s+estimated\s+unsure\s+96 s\s+389/);
  });

  it('shows a failed job and a "no data" sound check', () => {
    const text = videoTable(
      logWith([
        {
          videoId: 'tt5',
          stage: 'SOURCE',
          msg: 'the video is not sending its sound',
          sync: 'no-data',
        },
        done('tt5', 'direct', 402, 60000),
        { videoId: 'tt6', stage: 'API', level: 50, msg: 'job failed', errorCode: 'AI_QUOTA' },
      ]),
    ).join('\n');
    expect(text).toMatch(/1\s+tt5\s+opensubtitles\s+estimated\s+no data from video\s+60 s\s+402/);
    expect(text).toMatch(/2\s+tt6\s+.*failed: AI_QUOTA/);
  });

  it('tells episodes of one series apart and writes season and episode', () => {
    const ep = (episode: number) => ({ ...done('tt9', 'direct', 300, 5000), season: 2, episode });
    const text = videoTable(logWith([ep(3), ep(4)])).join('\n');
    expect(text).toMatch(/1\s+tt9 S2E3\s/);
    expect(text).toMatch(/2\s+tt9 S2E4\s/);
  });

  it('keeps only the latest videos, newest last', () => {
    const lines = Array.from({ length: 7 }, (_, i) => done(`tt${i}`, 'direct', 100 + i, 1000));
    const text = videoTable(logWith(lines), 5).join('\n');
    expect(text).not.toContain('tt0 ');
    expect(text).not.toContain('tt1 ');
    expect(text).toMatch(/5\s+tt6\s/);
  });

  it('never prints anything but codes and numbers', () => {
    const text = videoTable(
      logWith([
        { ...done('tt7', 'direct', 10, 1000), text: 'SECRET DIALOGUE', apiKey: 'kkkkkkkkkkkk' },
      ]),
    ).join('\n');
    expect(text).not.toContain('SECRET DIALOGUE');
    expect(text).not.toContain('kkkkkkkkkkkk');
  });
});
