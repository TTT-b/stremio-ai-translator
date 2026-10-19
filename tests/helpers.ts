import { deflateRawSync } from 'node:zlib';
import pino from 'pino';
import { AppError } from '../src/errors';
import type { Logger } from '../src/logging/logger';
import type {
  ConnectionTestResult,
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from '../src/translation/provider';

export const silentLogger = (): Logger => pino({ level: 'silent' });

export type ChunkHandler = (
  req: TranslateChunkRequest,
  callNumber: number,
) => TranslateChunkResult | Promise<TranslateChunkResult>;

/** Provider that "translates" by prefixing text; handler can override per call. */
export class FakeProvider implements TranslationProvider {
  calls = 0;
  constructor(private readonly handler?: ChunkHandler) {}

  async testConnection(): Promise<ConnectionTestResult> {
    return { ok: true, provider: 'fake', model: 'fake-1', message: 'ok' };
  }
  async translateChunk(req: TranslateChunkRequest): Promise<TranslateChunkResult> {
    this.calls++;
    if (this.handler) return this.handler(req, this.calls);
    return { translations: req.cues.map((c) => ({ id: c.id, text: `T:${c.text}` })) };
  }
  getProviderName() {
    return 'fake';
  }
  getModelInformation() {
    return { provider: 'fake', model: 'fake-1' };
  }
  normalizeError(err: unknown): AppError {
    return err instanceof AppError ? err : new AppError('PROVIDER_RESPONSE_INVALID');
  }
}

/** A small zip file with the given entries (deflate), for tests of the zip reader and downloads. */
export function makeZip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text);
    const body = deflateRawSync(data);
    const nameBuf = Buffer.from(name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(8, 10);
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
