import { inflateRawSync } from 'node:zlib';

/**
 * A small zip reader (stored and deflate entries only), used for downloaded subtitle archives and for the speech tool, without
 * any extra dependency. Every size is checked and nothing is written here: the caller decides
 * which entries to take and where they go.
 */
export interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

const MAX_ENTRIES = 5000;

export function readZipEntries(zip: Buffer): ZipEntry[] {
  // End of central directory record: signature 0x06054b50, within the last 64 KB.
  const minPos = Math.max(0, zip.length - 65_557);
  let eocd = -1;
  for (let i = zip.length - 22; i >= minPos; i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const count = zip.readUInt16LE(eocd + 10);
  let pos = zip.readUInt32LE(eocd + 16);
  if (count > MAX_ENTRIES) throw new Error('too many entries');
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (pos + 46 > zip.length || zip.readUInt32LE(pos) !== 0x02014b50) throw new Error('bad zip');
    const method = zip.readUInt16LE(pos + 10);
    const compressedSize = zip.readUInt32LE(pos + 20);
    const size = zip.readUInt32LE(pos + 24);
    const nameLen = zip.readUInt16LE(pos + 28);
    const extraLen = zip.readUInt16LE(pos + 30);
    const commentLen = zip.readUInt16LE(pos + 32);
    const headerOffset = zip.readUInt32LE(pos + 42);
    const name = zip.toString('utf8', pos + 46, pos + 46 + nameLen);
    entries.push({ name, method, compressedSize, size, headerOffset });
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** The bytes of one entry. `maxBytes` guards against a zip that claims to be small and is not. */
export function extractZipEntry(zip: Buffer, entry: ZipEntry, maxBytes: number): Buffer {
  if (entry.size > maxBytes) throw new Error('entry too large');
  const h = entry.headerOffset;
  if (h + 30 > zip.length || zip.readUInt32LE(h) !== 0x04034b50) throw new Error('bad zip');
  const nameLen = zip.readUInt16LE(h + 26);
  const extraLen = zip.readUInt16LE(h + 28);
  const start = h + 30 + nameLen + extraLen;
  const raw = zip.subarray(start, start + entry.compressedSize);
  let out: Buffer;
  if (entry.method === 0) out = Buffer.from(raw);
  else if (entry.method === 8) out = inflateRawSync(raw, { maxOutputLength: maxBytes });
  else throw new Error('unsupported compression');
  if (out.length !== entry.size) throw new Error('size mismatch');
  return out;
}
