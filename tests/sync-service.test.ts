import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { SyncService } from '../src/sync/service';
import { transcribeVideo, type SpeechRunner } from '../src/sync/transcribe';
import type { WhisperModel } from '../src/sync/tools';
import { parseWhisperJson } from '../src/sync/whisperJson';
import { silentLogger } from './helpers';

const tok = (text: string, fromMs: number, toMs: number, dtwCs = fromMs / 10) => ({
  text,
  offsets: { from: fromMs, to: toMs },
  t_dtw: dtwCs,
});

const SAMPLE = {
  transcription: [
    {
      tokens: [
        tok('[_BEG_]', 0, 0, -1),
        tok(' [', 0, 100),
        tok('music', 100, 900),
        tok(' playing', 900, 1500),
        tok(']', 1500, 1600),
        tok(' Hel', 2000, 2200),
        tok('lo', 2200, 2500),
        tok(' there', 2500, 2900, 260),
        tok('.', 2900, 3000, -1),
        tok('<|endoftext|>', 3000, 3000, -1),
      ],
    },
    {
      tokens: [
        tok(' Kat', 5000, 5200, 505),
        tok('ara', 5200, 9000, 530),
        tok(' (growling)', 9000, 9500),
      ],
    },
  ],
};

describe('parseWhisperJson', () => {
  it('joins sub-word tokens, drops special tokens and sound-effect notes, and uses DTW times', () => {
    const words = parseWhisperJson(SAMPLE);
    expect(words.map((w) => w.w)).toEqual(['hello', 'there', 'katara']);
    expect(words[0]).toMatchObject({ start: 2, end: 2.5 }); // DTW time of " Hel", end of "lo"
    expect(words[1]!.start).toBeCloseTo(2.6, 5);
    expect(words[2]!.start).toBeCloseTo(5.05, 5);
    expect(words[2]!.end).toBeLessThanOrEqual(5.05 + 1.2); // a long rough end time is capped
  });

  it('falls back to the plain token time when there is no DTW time', () => {
    const w = parseWhisperJson({
      transcription: [{ tokens: [{ text: ' ok', offsets: { from: 1500, to: 1800 } }] }],
    });
    expect(w).toEqual([{ w: 'ok', start: 1.5, end: 1.8 }]);
  });

  it('copes with an empty or odd file', () => {
    expect(parseWhisperJson({})).toEqual([]);
    expect(parseWhisperJson({ transcription: [{}] })).toEqual([]);
  });
});

/** A runner that "listens": it writes a whisper JSON file where whisper-cli would. */
function fakeRunner(json: unknown, log: { extract: string[]; args: string[][] }): SpeechRunner {
  return {
    extractAudio: async (_ffmpeg, url) => {
      log.extract.push(url);
    },
    transcribe: async (_cli, args, _cwd, onLine) => {
      log.args.push(args);
      onLine('whisper_print_progress_callback: progress = 40%');
      onLine('whisper_print_progress_callback: progress = 100%');
      writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify(json));
    },
  };
}

const model: WhisperModel = {
  name: 'tiny.en',
  file: 'ggml-tiny.en.bin',
  url: 'https://huggingface.co/m.bin',
  sha256: '0'.repeat(64),
  bytes: 10,
  leadSec: 0.3,
};

describe('transcribeVideo', () => {
  it('extracts the audio, runs whisper with the accurate-timing options and reports progress', async () => {
    const log = { extract: [] as string[], args: [] as string[][] };
    const seen: number[] = [];
    const words = await transcribeVideo({
      dataDir: mkdtempSync(join(tmpdir(), 'tr-')),
      model,
      ffmpeg: 'ffmpeg.exe',
      streamUrl: 'http://127.0.0.1:11470/abc/1',
      threads: 2,
      onProgress: (p) => seen.push(p),
      runner: fakeRunner(SAMPLE, log),
    });
    expect(words.map((w) => w.w)).toEqual(['hello', 'there', 'katara']);
    expect(log.extract).toEqual(['http://127.0.0.1:11470/abc/1']);
    const args = log.args[0]!;
    expect(args).toEqual(
      expect.arrayContaining(['-dtw', 'tiny.en', '-nfa', '-ng', '-ojf', '-pp', '-t', '2']),
    );
    expect(args.join(' ')).toContain('-bs 1 -bo 1');
    expect(seen).toEqual([0, 40, 100]);
  });
});

describe('SyncService', () => {
  // A tiny fake "download" so the service can become ready.
  const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
  const mkZip = () => {
    const data = Buffer.from('cli');
    const body = deflateRawSync(data);
    const name = Buffer.from('whisper-cli.exe');
    const names = ['whisper.dll', 'ggml.dll', 'ggml-base.dll'];
    const files = [
      { n: name, d: data, b: body },
      ...names.map((n) => ({ n: Buffer.from(n), d: data, b: body })),
    ];
    const parts: Buffer[] = [];
    const central: Buffer[] = [];
    let off = 0;
    for (const f of files) {
      const l = Buffer.alloc(30);
      l.writeUInt32LE(0x04034b50, 0);
      l.writeUInt16LE(8, 8);
      l.writeUInt32LE(f.b.length, 18);
      l.writeUInt32LE(f.d.length, 22);
      l.writeUInt16LE(f.n.length, 26);
      parts.push(l, f.n, f.b);
      const c = Buffer.alloc(46);
      c.writeUInt32LE(0x02014b50, 0);
      c.writeUInt16LE(8, 10);
      c.writeUInt32LE(f.b.length, 20);
      c.writeUInt32LE(f.d.length, 24);
      c.writeUInt16LE(f.n.length, 28);
      c.writeUInt32LE(off, 42);
      central.push(c, f.n);
      off += 30 + f.n.length + f.b.length;
    }
    const cd = Buffer.concat(central);
    const e = Buffer.alloc(22);
    e.writeUInt32LE(0x06054b50, 0);
    e.writeUInt16LE(files.length, 10);
    e.writeUInt32LE(cd.length, 12);
    e.writeUInt32LE(off, 16);
    return Buffer.concat([...parts, cd, e]);
  };
  const zip = mkZip();
  const modelBytes = Buffer.from('m'.repeat(64));
  const spec: WhisperModel = { ...model, sha256: sha(modelBytes), bytes: modelBytes.length };
  const fetchImpl = (async (u: string | URL | Request) =>
    new Response(String(u).endsWith('.zip') ? zip : modelBytes)) as typeof fetch;
  const make = (runner?: SpeechRunner, supported = true) =>
    new SyncService({
      dataDir: mkdtempSync(join(tmpdir(), 'svc-')),
      logger: silentLogger(),
      supported,
      modelSpec: spec,
      zipSpec: { url: 'https://github.com/t.zip', sha256: sha(zip), bytes: zip.length },
      fetchImpl,
      ...(runner ? { runner } : {}),
    });
  const stream = (n: number) => ({
    infoHash: 'a'.repeat(40),
    fileIdx: n,
    url: `http://127.0.0.1:11470/x/${n}`,
  });

  it('reports missing, installs on request, then reports ready', async () => {
    const svc = make();
    expect(svc.status()).toMatchObject({ supported: true, state: 'missing', model: 'tiny.en' });
    expect(svc.ready()).toBe(false);
    await svc.install();
    expect(svc.status()).toMatchObject({ state: 'ready', percent: 100 });
    expect(svc.ready()).toBe(true);
    await svc.install(); // already there: nothing to do
    svc.remove();
    expect(svc.status().state).toBe('missing');
  });

  it('is not available on other systems', async () => {
    const svc = make(undefined, false);
    expect(svc.status()).toMatchObject({ supported: false, state: 'unsupported' });
    await expect(svc.install()).rejects.toThrow();
    expect(await svc.words(stream(1), { ffmpeg: 'f' })).toBeUndefined();
  });

  it('shares one install between callers and reports a failed one', async () => {
    const bad = new SyncService({
      dataDir: mkdtempSync(join(tmpdir(), 'svc-')),
      logger: silentLogger(),
      supported: true,
      modelSpec: spec,
      zipSpec: { url: 'https://github.com/t.zip', sha256: sha(zip), bytes: zip.length },
      fetchImpl: (async () => new Response('x'.repeat(3))) as typeof fetch,
    });
    const [a, b] = await Promise.allSettled([bad.install(), bad.install()]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    expect(bad.status().state).toBe('error');
    expect(bad.status().error).toBeTruthy();
  });

  it('listens to a video once, saves the words and shares a running job', async () => {
    const log = { extract: [] as string[], args: [] as string[][] };
    const svc = make(fakeRunner(SAMPLE, log));
    expect(await svc.words(stream(1), { ffmpeg: 'f' })).toBeUndefined(); // tool not installed yet
    await svc.install();
    const [a, b] = await Promise.all([
      svc.words(stream(1), { ffmpeg: 'f' }),
      svc.words(stream(1), { ffmpeg: 'f' }),
    ]);
    expect(a!.map((w) => w.w)).toEqual(['hello', 'there', 'katara']);
    expect(b).toEqual(a);
    expect(log.extract).toHaveLength(1); // one listening for both callers
    const again = await svc.words(stream(1), { ffmpeg: 'f' });
    expect(again).toEqual(a);
    expect(log.extract).toHaveLength(1); // read from the saved copy
    await svc.words(stream(2), { ffmpeg: 'f' }); // another video
    expect(log.extract).toHaveLength(2);
  });

  it('listens to one video at a time', async () => {
    let active = 0;
    let most = 0;
    const runner: SpeechRunner = {
      extractAudio: async () => undefined,
      transcribe: async (_c, args) => {
        active++;
        most = Math.max(most, active);
        await new Promise((r) => setTimeout(r, 20));
        writeFileSync(`${args[args.indexOf('-of') + 1]}.json`, JSON.stringify(SAMPLE));
        active--;
      },
    };
    const svc = make(runner);
    await svc.install();
    await Promise.all([1, 2, 3].map((n) => svc.words(stream(n), { ffmpeg: 'f' })));
    expect(most).toBe(1);
  });

  it('gives up on a video whose stream stalls, so the single speech lane is freed', async () => {
    const hang = (_a: unknown, _b: unknown, _c: unknown, signal: AbortSignal) =>
      new Promise<void>((_, reject) =>
        signal.addEventListener('abort', () => reject(new Error('stalled'))),
      );
    const stalledRead = transcribeVideo({
      dataDir: mkdtempSync(join(tmpdir(), 'tr-')),
      model,
      ffmpeg: 'ffmpeg.exe',
      streamUrl: 'http://127.0.0.1:11470/abc/1',
      threads: 1,
      extractTimeoutMs: 40,
      runner: { extractAudio: hang, transcribe: async () => undefined },
    });
    await expect(stalledRead).rejects.toThrow('stalled');
    const stalledTool = transcribeVideo({
      dataDir: mkdtempSync(join(tmpdir(), 'tr-')),
      model,
      ffmpeg: 'ffmpeg.exe',
      streamUrl: 'http://127.0.0.1:11470/abc/1',
      threads: 1,
      stallMs: 40,
      runner: {
        extractAudio: async () => undefined,
        transcribe: (_c, _a, _d, _l, signal) => hang(0, 0, 0, signal),
      },
    });
    await expect(stalledTool).rejects.toThrow('stalled');
  });

  it('gives undefined, not an error, when the tool fails', async () => {
    const runner: SpeechRunner = {
      extractAudio: async () => {
        throw new Error('no audio');
      },
      transcribe: async () => undefined,
    };
    const svc = make(runner);
    await svc.install();
    expect(await svc.words(stream(1), { ffmpeg: 'f' })).toBeUndefined();
  });
});
