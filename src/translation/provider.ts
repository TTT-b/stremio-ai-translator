import type { AppError } from '../errors';
import type { ChunkCue } from '../subtitles/chunk';

export interface TranslateChunkRequest {
  /** Human-readable language name, e.g. "Hebrew". */
  targetLanguage: string;
  /** Language code, e.g. "he" (selects per-language prompt instructions). */
  targetLanguageCode: string;
  cues: ChunkCue[];
  context: ChunkCue[];
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface TranslateChunkResult {
  translations: ChunkCue[];
  usage?: TokenUsage;
}

export interface ModelInformation {
  provider: string;
  model: string;
}

export interface ConnectionTestResult {
  ok: boolean;
  provider: string;
  model: string;
  message: string;
  /** Error code when ok is false. */
  code?: string;
  /** Secret-free diagnostics for the log file only; never sent to the browser. */
  details?: Record<string, unknown>;
}

export interface TranslationProvider {
  testConnection(): Promise<ConnectionTestResult>;
  translateChunk(
    request: TranslateChunkRequest,
    signal?: AbortSignal,
  ): Promise<TranslateChunkResult>;
  getProviderName(): string;
  getModelInformation(): ModelInformation;
  normalizeError(err: unknown): AppError;
}
