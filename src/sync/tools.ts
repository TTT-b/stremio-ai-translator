import { createHash } from 'node:crypto';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, join } from 'node:path';
import { extractZipEntry, readZipEntries } from '../sources/zip';

/**
 * The speech tool for precise subtitle sync: whisper.cpp (MIT licence, runs on the user's own
 * computer, free) and its small English model. Both are downloaded once, after the user asks for
 * it, from their official homes. Every file is checked against a checksum pinned in this source
 * file before anything is used, so a changed or damaged download is refused.
 */
/**
 * Windows can refuse a rename for a moment (EPERM/EBUSY/EACCES) while a virus scanner or the search
 * indexer still holds a file that was just written. Trying again a few times fixes it.
 */
function renameWithRetry(from: string, to: string): void {
  for (let attempt = 1; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (attempt >= 6 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 150 * attempt);
    }
  }
}

export interface WhisperModel {
  name: 'tiny.en' | 'base.en';
  file: string;
  url: string;
  sha256: string;
  bytes: number;
  /** Seconds a cue starts before its first word (measured against human-timed subtitles). */
  leadSec: number;
}

export const WHISPER_ZIP = {
  url: 'https://github.com/ggml-org/whisper.cpp/releases/download/b5454/whisper-bin-x64.zip',
  sha256: '6ba69e3482d7826214f90a6a9c84ca07782aec1e1d0c6a7c30c994fd5d816ccb',
  bytes: 8_928_640,
} as const;

export const MODELS: Record<WhisperModel['name'], WhisperModel> = {
  'tiny.en': {
    name: 'tiny.en',
    file: 'ggml-tiny.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    sha256: '921e4cf8686fdd993dcd081a5da5b6c365bfde1162e72b08d75ac75289920b1f',
    bytes: 77_704_715,
    leadSec: 0.35,
  },
  'base.en': {
    name: 'base.en',
    file: 'ggml-base.en.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
    sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002',
    bytes: 147_964_211,
    leadSec: 0.2,
  },
};

/** Files taken from the zip. Everything else in it (many test programs) is ignored. */
export const isNeededZipFile = (name: string): boolean =>
  /^(whisper-cli\.exe|whisper\.dll|ggml\.dll|ggml-base\.dll|ggml-cpu-[a-z0-9]+\.dll)$/.test(name);

/** Hosts a download may come from, including the ones the official links redirect to. */
const ALLOWED_HOSTS = [
  /(^|\.)github\.com$/,
  /(^|\.)githubusercontent\.com$/,
  /(^|\.)huggingface\.co$/,
  /(^|\.)hf\.co$/,
];
export const isAllowedDownloadHost = (url: string): boolean => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && ALLOWED_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
};

/** Only 64-bit Windows has a tested build of the tool. */
export const syncSupported = (): boolean => process.platform === 'win32' && process.arch === 'x64';

export const toolsDir = (dataDir: string): string => join(dataDir, 'tools', 'whisper');

interface Marker {
  zip: string;
  model: string;
  modelName: string;
}

export const cliPath = (dataDir: string): string => join(toolsDir(dataDir), 'whisper-cli.exe');
export const modelPath = (dataDir: string, model: WhisperModel): string =>
  join(toolsDir(dataDir), model.file);

/** Quick check (no hashing): the files are there and were installed from the pinned downloads. */
export function isInstalled(
  dataDir: string,
  model: WhisperModel,
  zipSha256: string = WHISPER_ZIP.sha256,
): boolean {
  try {
    const marker = JSON.parse(
      readFileSync(join(toolsDir(dataDir), 'installed.json'), 'utf8'),
    ) as Marker;
    return (
      marker.zip === zipSha256 &&
      marker.model === model.sha256 &&
      marker.modelName === model.name &&
      existsSync(cliPath(dataDir)) &&
      statSync(modelPath(dataDir, model)).size === model.bytes
    );
  } catch {
    return false;
  }
}

export interface DownloadOptions {
  url: string;
  dest: string;
  bytes: number;
  sha256: string;
  fetchImpl?: typeof fetch;
  onProgress?: (done: number) => void;
  /** Give up when nothing arrives for this long. */
  stallMs?: number;
}

/** Download to `dest` (via a .part file), refusing wrong hosts, wrong sizes and wrong checksums. */
export async function downloadVerified(opts: DownloadOptions): Promise<void> {
  const f = opts.fetchImpl ?? fetch;
  const part = `${opts.dest}.part`;
  const abort = new AbortController();
  let stall: NodeJS.Timeout | undefined;
  const armStall = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(), opts.stallMs ?? 60_000);
  };
  armStall();
  const out = createWriteStream(part);
  const hash = createHash('sha256');
  try {
    if (!isAllowedDownloadHost(opts.url)) throw new Error('download host not allowed');
    const res = await f(opts.url, { redirect: 'follow', signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(`download failed (HTTP ${res.status})`);
    if (res.url && !isAllowedDownloadHost(res.url))
      throw new Error('redirected to a host that is not allowed');
    let done = 0;
    const limit = opts.bytes + 1024 * 1024;
    const reader = res.body.getReader();
    for (;;) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      armStall();
      done += value.length;
      if (done > limit) throw new Error('download is larger than expected');
      hash.update(value);
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()));
      opts.onProgress?.(done);
    }
    await new Promise<void>((resolve, reject) => {
      out.once('error', reject);
      out.end(() => resolve());
    });
    if (done !== opts.bytes) throw new Error('download has the wrong size');
    if (hash.digest('hex') !== opts.sha256) throw new Error('checksum does not match');
    renameSync(part, opts.dest);
  } catch (err) {
    out.destroy();
    rmSync(part, { force: true });
    throw err;
  } finally {
    clearTimeout(stall);
  }
}

export interface ZipSpec {
  url: string;
  sha256: string;
  bytes: number;
}

export interface InstallOptions {
  dataDir: string;
  model: WhisperModel;
  /** The tool download. Defaults to the pinned one; tests use another. */
  zip?: ZipSpec;
  fetchImpl?: typeof fetch;
  /** 0..100 over the whole install. */
  onProgress?: (percent: number) => void;
}

/** Download the tool and the model, verify both, and put the needed files in place. */
export async function installTools(opts: InstallOptions): Promise<void> {
  const dir = toolsDir(opts.dataDir);
  const staging = `${dir}.new`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  const zipSpec: ZipSpec = opts.zip ?? WHISPER_ZIP;
  const total = zipSpec.bytes + opts.model.bytes;
  const progress = (done: number) =>
    opts.onProgress?.(Math.min(99, Math.floor((done / total) * 100)));
  try {
    const zipFile = join(staging, 'tool.zip');
    await downloadVerified({
      url: zipSpec.url,
      dest: zipFile,
      bytes: zipSpec.bytes,
      sha256: zipSpec.sha256,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      onProgress: progress,
    });
    const zip = readFileSync(zipFile);
    let taken = 0;
    for (const entry of readZipEntries(zip)) {
      const name = basename(entry.name.replace(/\\/g, '/'));
      if (!isNeededZipFile(name) || entry.name.endsWith('/')) continue;
      writeFileSync(join(staging, name), extractZipEntry(zip, entry, 8 * 1024 * 1024));
      taken++;
    }
    if (!existsSync(join(staging, 'whisper-cli.exe')) || taken < 4)
      throw new Error('the tool is incomplete');
    rmSync(zipFile, { force: true });
    await downloadVerified({
      url: opts.model.url,
      dest: join(staging, opts.model.file),
      bytes: opts.model.bytes,
      sha256: opts.model.sha256,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      onProgress: (done) => progress(zipSpec.bytes + done),
    });
    const marker: Marker = {
      zip: zipSpec.sha256,
      model: opts.model.sha256,
      modelName: opts.model.name,
    };
    writeFileSync(join(staging, 'installed.json'), JSON.stringify(marker), 'utf8');
    rmSync(dir, { recursive: true, force: true });
    renameWithRetry(staging, dir);
    opts.onProgress?.(100);
  } catch (err) {
    rmSync(staging, { recursive: true, force: true });
    throw err;
  }
}

export function removeTools(dataDir: string): void {
  rmSync(toolsDir(dataDir), { recursive: true, force: true });
}
