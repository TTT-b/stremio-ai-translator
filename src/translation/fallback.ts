import { isAppError, type AppError } from '../errors';
import type {
  ConnectionTestResult,
  ModelInformation,
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from './provider';

/**
 * Errors another model of the same provider may not have: overload, empty quota, no such model.
 * A per-minute rate limit is not here on purpose: it clears within a minute, the chosen model
 * is the one worth waiting for, and trying every other model on it only spends more requests.
 */
const SWITCHABLE = new Set([
  'PROVIDER_TIMEOUT',
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

  /** The last model of the list (the strongest one), unless it is the only model. */
  rescueProvider(): TranslationProvider | undefined {
    return this.providers.length > 1 ? this.providers[this.providers.length - 1] : undefined;
  }

  async translateChunk(
    request: TranslateChunkRequest,
    signal?: AbortSignal,
  ): Promise<TranslateChunkResult> {
    // A busy model is worth waiting for; a missing one is not. Keep the busy error to report.
    let busy: AppError | undefined;
    for (;;) {
      const used = this.active;
      const provider = this.providers[used] as TranslationProvider;
      try {
        return await provider.translateChunk(request, signal);
      } catch (err) {
        const e = isAppError(err) ? err : provider.normalizeError(err);
        const next = used + 1;
        if (!SWITCHABLE.has(e.code)) throw e;
        if (e.code !== 'PROVIDER_MODEL_UNAVAILABLE') busy = e;
        if (next >= this.providers.length) {
          if (this.active === used) this.active = 0;
          throw busy ?? e;
        }
        if (this.active === used) {
          this.active = next;
          this.onSwitch?.(this.models[used] ?? '', this.models[next] ?? '');
        }
      }
    }
  }
}
