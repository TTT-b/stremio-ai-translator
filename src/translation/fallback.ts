import { isAppError, type AppError } from '../errors';
import type {
  ConnectionTestResult,
  ModelInformation,
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from './provider';

/** Errors another model of the same provider may not have: overload, empty quota, no such model. */
const SWITCHABLE = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_RATE_LIMITED',
  // Free-tier daily limits are per model, so a sibling model may still have quota.
  'PROVIDER_QUOTA_EXCEEDED',
  'PROVIDER_MODEL_UNAVAILABLE',
]);

/**
 * Tries the chosen model first and, while it is overloaded or out of quota, moves to the next
 * model in the list for the rest of the job. When every model fails the error is thrown (the
 * pipeline then waits and tries again) and the next attempt starts from the chosen model.
 * The cache identity stays the chosen model.
 */
export class ModelFallbackProvider implements TranslationProvider {
  private readonly providers: TranslationProvider[];
  private active = 0;

  constructor(
    private readonly models: readonly string[],
    make: (model: string) => TranslationProvider,
    private readonly onSwitch?: (from: string, to: string) => void,
  ) {
    this.providers = models.map(make);
  }

  activeModel(): string {
    return this.models[this.active] ?? '';
  }

  private first(): TranslationProvider {
    return this.providers[0] as TranslationProvider;
  }

  testConnection(): Promise<ConnectionTestResult> {
    return this.first().testConnection();
  }

  getProviderName(): string {
    return this.first().getProviderName();
  }

  getModelInformation(): ModelInformation {
    return this.first().getModelInformation();
  }

  normalizeError(err: unknown): AppError {
    return this.first().normalizeError(err);
  }

  async translateChunk(
    request: TranslateChunkRequest,
    signal?: AbortSignal,
  ): Promise<TranslateChunkResult> {
    for (;;) {
      const used = this.active;
      const provider = this.providers[used] as TranslationProvider;
      try {
        return await provider.translateChunk(request, signal);
      } catch (err) {
        const e = isAppError(err) ? err : provider.normalizeError(err);
        const next = used + 1;
        if (!SWITCHABLE.has(e.code)) throw e;
        if (next >= this.providers.length) {
          if (this.active === used) this.active = 0;
          throw e;
        }
        if (this.active === used) {
          this.active = next;
          this.onSwitch?.(this.models[used] ?? '', this.models[next] ?? '');
        }
      }
    }
  }
}
