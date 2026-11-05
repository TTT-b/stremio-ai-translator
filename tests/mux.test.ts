import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  checkLocalUrl,
  checkOutputPath,
  checkVideoPath,
  languageCode3,
  MuxError,
  muxArgs,
  mp4Args,
  muxSubtitle,
  outputPathFor,
  parseCodecs,
  parseDurationSec,
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
    expect(readFileSync(out.replace(/\.mkv$/, '.srt'), 'utf8')).toContain('שלום'); // the SRT is saved too
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

describe('saving from Stremio’s own server', () => {
  it('accepts only a loopback address and an .mkv place that exists', () => {
    expect(checkLocalUrl('http://127.0.0.1:11470/abc/0')).toContain('127.0.0.1');
    expect(() => checkLocalUrl('http://example.com:11470/abc/0')).toThrow(MuxError);
    expect(() => checkLocalUrl('file:///C:/x.mkv')).toThrow(MuxError);
    const dir = tmp();
    expect(checkOutputPath(join(dir, 'a.mkv'))).toBe(join(dir, 'a.mkv'));
    expect(() => checkOutputPath(join(dir, 'a.exe'))).toThrow(MuxError);
    expect(() => checkOutputPath(join(dir, 'missing', 'a.mkv'))).toThrow(MuxError);
    expect(() => checkOutputPath('relative.mkv')).toThrow(MuxError);
  });

  it('reads the video from the address and writes where the user chose', async () => {
    const out = join(tmp(), 'Episode.heb.mkv');
    let input = '';
    const saved = await muxSubtitle({
      ffmpeg: 'ffmpeg',
      url: 'http://127.0.0.1:11470/abc/0',
      output: out,
      srt: '1\n00:00:01,000 --> 00:00:02,000\nשלום\n',
      language: 'he',
      run: async (_f, args) => {
        input = args[args.indexOf('-i') + 1] as string;
        writeFileSync(args.at(-1) as string, 'muxed');
      },
    });
    expect(saved).toBe(out);
    expect(input).toBe('http://127.0.0.1:11470/abc/0');
    expect(existsSync(out.replace(/\.mkv$/, '.srt'))).toBe(true);
  });

  it('needs a place to save when the video comes from an address', async () => {
    await expect(
      muxSubtitle({
        ffmpeg: 'ffmpeg',
        url: 'http://127.0.0.1:11470/abc/0',
        srt: 'x',
        language: 'he',
      }),
    ).rejects.toMatchObject({ code: 'BAD_PATH' });
  });
});

describe('MP4 copy (for iPad, iPhone and phones)', () => {
  const stderr = [
    "Input #0, matroska,webm, from 'in.mkv':",
    '  Stream #0:0: Video: hevc (Main 10), yuv420p10le, 3840x2160',
    '  Stream #0:1(eng): Audio: aac (LC), 48000 Hz, 5.1, fltp',
    '  Stream #0:2(eng): Subtitle: subrip',
    '  Stream #0:3(fre): Audio: ac3, 48000 Hz, 5.1',
  ].join('\n');
  const after = (args: string[], flag: string) => args[args.indexOf(flag) + 1];

  it('reads the first video and audio codec from what ffmpeg prints', () => {
    expect(parseCodecs(stderr)).toEqual({ video: 'hevc', audio: 'aac' });
    expect(parseCodecs('nothing useful')).toEqual({});
  });

  it('puts the subtitle first as mov_text, drops other subtitle tracks, tags HEVC as hvc1', () => {
    const args = mp4Args('in.mkv', 'sub.srt', 'out.mp4', 'he', { video: 'hevc', audio: 'aac' });
    expect(after(args, '-c:s')).toBe('mov_text');
    expect(after(args, '-c:v')).toBe('copy');
    expect(after(args, '-movflags')).toBe('+faststart');
    expect(args.indexOf('1:0')).toBeLessThan(args.indexOf('0:v:0'));
    expect(args).not.toContain('0:s?');
    expect(after(args, '-tag:v')).toBe('hvc1');
    expect(args).toContain('language=heb');
    expect(args.at(-1)).toBe('out.mp4');
  });

  it('does not tag H.264 and copies audio only when an Apple device can play it', () => {
    const h264 = mp4Args('i', 's', 'o.mp4', 'he', { video: 'h264', audio: 'ac3' });
    expect(h264).not.toContain('-tag:v');
    expect(after(h264, '-c:a')).toBe('copy');
    expect(after(mp4Args('i', 's', 'o.mp4', 'he', { video: 'h264', audio: 'dts' }), '-c:a')).toBe(
      'aac',
    );
    expect(after(mp4Args('i', 's', 'o.mp4', 'he', {}), '-c:a')).toBe('aac');
  });

  it('names the file .mp4 and accepts an .mp4 place', () => {
    const dir = tmp();
    const none = () => false;
    expect(outputPathFor(join(dir, 'Movie.mkv'), 'he', none, 'mp4')).toBe(
      join(dir, 'Movie.heb.mp4'),
    );
    expect(outputPathFor(join(dir, 'Movie.mkv'), 'he', none)).toBe(join(dir, 'Movie.heb.mkv'));
    expect(checkOutputPath(join(dir, 'a.mp4'))).toBe(join(dir, 'a.mp4'));
  });

  it('writes the MP4 and the SRT next to it, and the original is untouched', async () => {
    const file = join(tmp(), 'Movie.mkv');
    writeFileSync(file, 'video');
    let ran: string[] = [];
    const out = await muxSubtitle({
      ffmpeg: 'ffmpeg',
      video: file,
      srt: '1\n00:00:01,000 --> 00:00:02,000\nשלום\n',
      language: 'he',
      format: 'mp4',
      probe: async () => ({ video: 'hevc', audio: 'aac' }),
      run: async (_f, args) => {
        ran = args;
        writeFileSync(args.at(-1) as string, 'muxed');
      },
    });
    expect(out.endsWith('Movie.heb.mp4')).toBe(true);
    expect(ran).toContain('mov_text');
    expect(readFileSync(out.replace(/\.mp4$/, '.srt'), 'utf8')).toContain('שלום');
    expect(readFileSync(file, 'utf8')).toBe('video');
  });

  it('removes a half-written MP4 when ffmpeg breaks', async () => {
    const file = join(tmp(), 'Movie.mkv');
    writeFileSync(file, 'video');
    const failing = muxSubtitle({
      ffmpeg: 'ffmpeg',
      video: file,
      srt: 'x',
      language: 'he',
      format: 'mp4',
      probe: async () => ({}),
      run: async (_f, args) => {
        writeFileSync(args.at(-1) as string, 'half');
        throw new Error('boom');
      },
    });
    await expect(failing).rejects.toMatchObject({ code: 'FAILED' });
    expect(existsSync(file.replace('.mkv', '.heb.mp4'))).toBe(false);
  });
});

describe('progress reading', () => {
  it('reads the video length from the ffmpeg header', () => {
    expect(
      parseDurationSec('  Duration: 00:23:40.12, start: 0.000000, bitrate: 5000 kb/s'),
    ).toBeCloseTo(1420.12);
    expect(parseDurationSec('Duration: 01:00:00.00')).toBe(3600);
    expect(parseDurationSec('no length here')).toBeUndefined();
  });

  it('passes the progress callback to the runner', async () => {
    const file = join(tmpdir(), 'ai-sub-test-progress.mkv');
    writeFileSync(file, 'x');
    dirs.push(file);
    const seen: number[] = [];
    await muxSubtitle({
      ffmpeg: 'ffmpeg',
      video: file,
      srt: '1\n00:00:01,000 --> 00:00:02,000\nHi\n',
      language: 'he',
      onProgress: (p) => seen.push(p.doneSec),
      run: async (_f, _a, _s, onProgress) => {
        onProgress?.({ doneSec: 5, totalSec: 10, bytes: 100 });
      },
    });
    expect(seen).toEqual([5]);
    rmSync(file.replace('.mkv', '.heb.mkv'), { force: true });
    rmSync(file.replace('.mkv', '.heb.srt'), { force: true });
  });
});
