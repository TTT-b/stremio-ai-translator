import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { extractZipEntry, readZipEntries } from '../src/sources/zip';
import {
  downloadVerified,
  installTools,
  isAllowedDownloadHost,
  isInstalled,
  isNeededZipFile,
  MODELS,
  WHISPER_ZIP,
  type WhisperModel,
} from '../src/sync/tools';

const sha = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');

/** A zip file with the given entries (deflated, or stored when `store` is set). */
function makeZip(files: Record<string, string>, store = false): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const body = store ? data : deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(store ? 0 : 8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(store ? 0 : 8, 10);
    c.writeUInt32LE(body.length, 20);
    c.writeUInt32LE(data.length, 24);
    c.writeUInt16LE(nameBuf.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

const streamOf = (bytes: Uint8Array): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(c) {
      c.enqueue(bytes.slice(0, Math.ceil(bytes.length / 2)));
      c.enqueue(bytes.slice(Math.ceil(bytes.length / 2)));
      c.close();
    },
  });

const respond = (bytes: Uint8Array, finalUrl?: string, status = 200): Response => {
  const res = new Response(streamOf(bytes), { status });
  if (finalUrl) Object.defineProperty(res, 'url', { value: finalUrl });
  return res;
};

describe('zip reader', () => {
  it('lists and extracts deflated and stored entries', () => {
    for (const store of [false, true]) {
      const zip = makeZip({ 'bin/Release/a.dll': 'AAAA'.repeat(50), 'b.txt': 'hello' }, store);
      const entries = readZipEntries(zip);
      expect(entries.map((e) => e.name)).toEqual(['bin/Release/a.dll', 'b.txt']);
      expect(extractZipEntry(zip, entries[1]!, 100).toString()).toBe('hello');
      expect(extractZipEntry(zip, entries[0]!, 1000).toString()).toBe('AAAA'.repeat(50));
    }
  });

  it('refuses garbage and entries that are bigger than allowed', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all, just text'))).toThrow();
    const zip = makeZip({ 'a.bin': 'x'.repeat(500) });
    expect(() => extractZipEntry(zip, readZipEntries(zip)[0]!, 100)).toThrow();
  });
});

describe('what is taken from the tool zip, and from where', () => {
  it('takes only the programs needed to listen to the speech', () => {
    for (const ok of [
      'whisper-cli.exe',
      'whisper.dll',
      'ggml.dll',
      'ggml-base.dll',
      'ggml-cpu-haswell.dll',
      'ggml-cpu-x64.dll',
    ]) {
      expect(isNeededZipFile(ok), ok).toBe(true);
    }
    for (const no of [
      'whisper-server.exe',
      'SDL2.dll',
      'main.exe',
      'llama.dll',
      '../whisper-cli.exe',
      'ggml-cpu-evil.dll.exe',
    ]) {
      expect(isNeededZipFile(no), no).toBe(false);
    }
  });

  it('only allows https downloads from GitHub and Hugging Face', () => {
    expect(isAllowedDownloadHost(WHISPER_ZIP.url)).toBe(true);
    expect(isAllowedDownloadHost(MODELS['tiny.en'].url)).toBe(true);
    expect(isAllowedDownloadHost('https://release-assets.githubusercontent.com/x')).toBe(true);
    expect(isAllowedDownloadHost('https://cdn-lfs.hf.co/x')).toBe(true);
    expect(isAllowedDownloadHost('http://github.com/x')).toBe(false);
    expect(isAllowedDownloadHost('https://evil.example/github.com')).toBe(false);
    expect(isAllowedDownloadHost('https://github.com.evil.example/x')).toBe(false);
    expect(isAllowedDownloadHost('not a url')).toBe(false);
  });

  it('pins checksums for the tool and both models', () => {
    for (const h of [WHISPER_ZIP.sha256, MODELS['tiny.en'].sha256, MODELS['base.en'].sha256]) {
      expect(h).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe('downloadVerified', () => {
  const dir = () => mkdtempSync(join(tmpdir(), 'dl-'));
  const body = Buffer.from('model bytes '.repeat(100));
  const base = (d: string, over = {}) => ({
    url: 'https://huggingface.co/x/model.bin',
    dest: join(d, 'model.bin'),
    bytes: body.length,
    sha256: sha(body),
    fetchImpl: (async () => respond(body)) as typeof fetch,
    ...over,
  });

  it('saves a download whose size and checksum match, and reports progress', async () => {
    const d = dir();
    const seen: number[] = [];
    await downloadVerified({ ...base(d), onProgress: (n) => seen.push(n) });
    expect(readFileSync(join(d, 'model.bin'))).toEqual(body);
    expect(seen.at(-1)).toBe(body.length);
    expect(readdirSync(d)).toEqual(['model.bin']); // no .part file left
  });

  it('refuses a wrong checksum, wrong size, wrong host and failed request, leaving nothing behind', async () => {
    for (const over of [
      { sha256: sha('other') },
      { bytes: body.length + 5 },
      { url: 'https://evil.example/model.bin' },
      { fetchImpl: (async () => respond(body, 'https://evil.example/redirected')) as typeof fetch },
      { fetchImpl: (async () => respond(body, undefined, 404)) as typeof fetch },
      { bytes: 10 }, // the server sends much more than promised
    ]) {
      const d = dir();
      await expect(downloadVerified(base(d, over))).rejects.toThrow();
      expect(readdirSync(d)).toEqual([]);
    }
  });
});

describe('installTools', () => {
  const dll = (n: string) => `binary ${n}`;
  const zip = makeZip({
    'bin/Release/whisper-cli.exe': dll('cli'),
    'bin/Release/whisper.dll': dll('w'),
    'bin/Release/ggml.dll': dll('g'),
    'bin/Release/ggml-base.dll': dll('gb'),
    'bin/Release/ggml-cpu-x64.dll': dll('cpu'),
    'bin/Release/whisper-server.exe': 'not needed',
    'bin/Release/main.exe': 'not needed',
  });
  const modelBytes = Buffer.from('tiny model '.repeat(50));
  const model: WhisperModel = {
    name: 'tiny.en',
    file: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/m.bin',
    sha256: sha(modelBytes),
    bytes: modelBytes.length,
    leadSec: 0.3,
  };
  const zipSpec = { url: 'https://github.com/t.zip', sha256: sha(zip), bytes: zip.length };
  const fetchImpl = (async (url: string | URL | Request) =>
    String(url).endsWith('.zip') ? respond(zip) : respond(modelBytes)) as typeof fetch;

  it('puts the needed files in place and nothing else, and remembers what was installed', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'inst-'));
    const percents: number[] = [];
    await installTools({
      dataDir,
      model,
      zip: zipSpec,
      fetchImpl,
      onProgress: (p) => percents.push(p),
    });
    const dir = join(dataDir, 'tools', 'whisper');
    expect(readdirSync(dir).sort()).toEqual(
      [
        'ggml-base.dll',
        'ggml-cpu-x64.dll',
        'ggml-tiny.en.bin',
        'ggml.dll',
        'installed.json',
        'whisper-cli.exe',
        'whisper.dll',
      ].sort(),
    );
    expect(readFileSync(join(dir, 'whisper-cli.exe'), 'utf8')).toBe('binary cli');
    expect(percents.at(-1)).toBe(100);
    expect(percents).toEqual([...percents].sort((a, b) => a - b));
    expect(isInstalled(dataDir, model, zipSpec.sha256)).toBe(true);
    expect(isInstalled(dataDir, MODELS['base.en'], zipSpec.sha256)).toBe(false); // another model
    expect(isInstalled(dataDir, model)).toBe(false); // not the pinned tool
  });

  it('installs nothing when a download is wrong', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'inst-'));
    const tampered = (async (url: string | URL | Request) =>
      String(url).endsWith('.zip')
        ? respond(zip)
        : respond(Buffer.from('x'.repeat(modelBytes.length)))) as typeof fetch;
    await expect(
      installTools({ dataDir, model, zip: zipSpec, fetchImpl: tampered }),
    ).rejects.toThrow(/checksum/);
    expect(existsSync(join(dataDir, 'tools', 'whisper'))).toBe(false);
    expect(existsSync(join(dataDir, 'tools', 'whisper.new'))).toBe(false);
  });
});
