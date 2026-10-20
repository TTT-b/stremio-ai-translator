import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkVideoPath,
  languageCode3,
  MuxError,
  muxArgs,
  muxSubtitle,
  outputPathFor,
} from '../src/video/mux';

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), 'mux-test-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('languageCode3', () => {
  it.each([
    ['he', 'heb'],
    ['en', 'eng'],
    ['pt-BR', 'por'],
    ['fra', 'fra'],
    ['xx', 'und'],
    ['', 'und'],
  ])('%s -> %s', (input, expected) => expect(languageCode3(input)).toBe(expected));
});

describe('checkVideoPath', () => {
  it('rejects things that are not an existing absolute video path', () => {
    const yes = () => true;
    expect(() => checkVideoPath(undefined, yes)).toThrow(MuxError);
    expect(() => checkVideoPath('', yes)).toThrow(MuxError);
    expect(() => checkVideoPath('relative/video.mkv', yes)).toThrow(MuxError);
    expect(() => checkVideoPath(join(tmp(), 'missing.mkv'))).toThrow(MuxError);
    expect(() => checkVideoPath(join(tmp(), 'notes.txt'), yes)).toThrow(/not a video/);
  });

  it('accepts an existing video file', () => {
    const file = join(tmp(), 'Show.S01E01.MKV');
    writeFileSync(file, 'x');
    expect(checkVideoPath(file)).toBe(file);
  });
});

describe('outputPathFor', () => {
  it('goes next to the video and never over a file', () => {
    const dir = tmp();
    const video = join(dir, 'Show.S01E01.mkv');
    expect(outputPathFor(video, 'he')).toBe(join(dir, 'Show.S01E01.heb.mkv'));
    writeFileSync(join(dir, 'Show.S01E01.heb.mkv'), 'x');
    expect(outputPathFor(video, 'he')).toBe(join(dir, 'Show.S01E01.heb (2).mkv'));
  });
});

describe('muxArgs', () => {
  it('copies the video, puts the subtitle first and marks it default', () => {
    const args = muxArgs('in.mkv', 'sub.srt', 'out.mkv', 'he');
    expect(args).toEqual(expect.arrayContaining(['-c', 'copy', '-c:s', 'srt', '-metadata:s:s:0']));
    expect(args.indexOf('1:0')).toBeLessThan(args.indexOf('0:v'));
    expect(args).toContain('language=heb');
    expect(args).toContain('default');
    expect(args.at(-1)).toBe('out.mkv');
  });
});

describe('muxSubtitle', () => {
  const video = () => {
    const file = join(tmp(), 'Movie.mp4');
    writeFileSync(file, 'video');
    return file;
  };

  it('runs ffmpeg with the subtitle text and returns the new file', async () => {
    const file = video();
    let seen = '';
    const out = await muxSubtitle({
      ffmpeg: 'ffmpeg',
      video: file,
      srt: '1\n00:00:01,000 --> 00:00:02,000\nשלום\n',
      language: 'he',
      run: async (_ffmpeg, args) => {
        seen = readFileSync(args[args.indexOf('-i', args.indexOf('-i') + 1) + 1] as string, 'utf8');
        writeFileSync(args.at(-1) as string, 'muxed');
      },
    });
    expect(out.endsWith('Movie.heb.mkv')).toBe(true);
    expect(readFileSync(out, 'utf8')).toBe('muxed');
    expect(seen).toContain('שלום');
    expect(readFileSync(file, 'utf8')).toBe('video'); // the original is untouched
  });

  it('removes a half-written file and reports FAILED when ffmpeg breaks', async () => {
    const file = video();
    const failing = muxSubtitle({
      ffmpeg: 'ffmpeg',
      video: file,
      srt: 'x',
      language: 'he',
      run: async (_f, args) => {
        writeFileSync(args.at(-1) as string, 'half');
        throw new Error('boom');
      },
    });
    await expect(failing).rejects.toMatchObject({ code: 'FAILED' });
    expect(existsSync(file.replace('.mp4', '.heb.mkv'))).toBe(false);
  });

  it('says so when ffmpeg is missing', async () => {
    await expect(
      muxSubtitle({ ffmpeg: undefined, video: video(), srt: 'x', language: 'he' }),
    ).rejects.toMatchObject({ code: 'NO_FFMPEG' });
  });
});
