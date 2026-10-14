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
