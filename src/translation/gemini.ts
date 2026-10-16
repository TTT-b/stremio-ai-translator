import { ApiError, GoogleGenAI } from '@google/genai';
import { z } from 'zod';
import { AppError, isAppError } from '../errors';
import { buildSystemInstruction } from './prompts/v1';
import type {
  ConnectionTestResult,
  ModelInformation,
  TokenUsage,
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from './provider';

/** The small part of the SDK client we use; lets tests inject a fake. */
export interface GeminiClientLike {
  models: {
    generateContent(params: {
      model: string;
      contents: string;
      config?: Record<string, unknown>;
    }): Promise<{
      text?: string;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    }>;
  };
}

const responseSchema = z.object({
  translations: z.array(z.object({ id: z.union([z.string(), z.number()]), text: z.string() })),
});

const RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    translations: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: { type: 'string' }, text: { type: 'string' } },
        required: ['id', 'text'],
      },
    },
  },
  required: ['translations'],
};

export interface GeminiOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  client?: GeminiClientLike;
}

/** Best-effort parse of "retry in 12.3s" / "retryDelay":"12s" hints in an error message. */
export function parseRetryAfterMs(message: string): number | undefined {
  const m = /retry(?:Delay"?:\s*"|\s+in\s+)(\d+(?:\.\d+)?)s/i.exec(message);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

export class GeminiProvider implements TranslationProvider {
  private readonly client: GeminiClientLike;
  private readonly model: string;

  constructor(private readonly opts: GeminiOptions) {
    this.model = opts.model;
    // Without a key the SDK client is never used (calls fail earlier with CONFIGURATION_INVALID).
    this.client =
      opts.client ??
      (new GoogleGenAI({
        apiKey: opts.apiKey || 'not-configured',
        httpOptions: { timeout: opts.timeoutMs },
      }) as unknown as GeminiClientLike);
  }

  getProviderName(): string {
    return 'gemini';
  }

  getModelInformation(): ModelInformation {
    return { provider: 'gemini', model: this.model };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const base = { provider: this.getProviderName(), model: this.model };
    if (!this.opts.apiKey) {
      return {
        ...base,
        ok: false,
        code: 'CONFIGURATION_INVALID',
        message: 'Gemini API key is not set. Add it in the API keys card.',
      };
    }
    try {
      await this.client.models.generateContent({
        model: this.model,
        contents: 'Reply with the single word: ok',
      });
      return { ...base, ok: true, message: `Connected. Model ${this.model} responded.` };
    } catch (err) {
      const e = this.normalizeError(err);
      return {
        ...base,
        ok: false,
        code: e.code,
        message: e.message,
        details: e.details,
      };
    }
  }

  async translateChunk(req: TranslateChunkRequest): Promise<TranslateChunkResult> {
    if (!this.opts.apiKey) throw new AppError('CONFIGURATION_INVALID', 'GEMINI_API_KEY is not set');
    const payload = {
      targetLanguage: req.targetLanguage,
      context: req.context,
      cues: req.cues,
    };
    let response;
    try {
      response = await this.client.models.generateContent({
        model: this.model,
        contents: JSON.stringify(payload),
        config: {
          systemInstruction: buildSystemInstruction(req.targetLanguage, req.targetLanguageCode),
          responseMimeType: 'application/json',
          responseJsonSchema: RESPONSE_JSON_SCHEMA,
          temperature: 0.3,
        },
      });
    } catch (err) {
      throw this.normalizeError(err);
    }

    const parsed = parseModelJson(response.text ?? '');
    const usage: TokenUsage | undefined = response.usageMetadata
      ? {
          inputTokens: response.usageMetadata.promptTokenCount ?? 0,
          outputTokens: response.usageMetadata.candidatesTokenCount ?? 0,
        }
      : undefined;
    return {
      translations: parsed.translations.map((t) => ({ id: String(t.id), text: t.text })),
      ...(usage ? { usage } : {}),
    };
  }

  normalizeError(err: unknown): AppError {
    if (isAppError(err)) return err;
    const message = err instanceof Error ? err.message : String(err);
    const norm = this.classify(err, message);
    // Secret-free diagnostics for logs (the logger also scrubs the provider message).
    Object.assign(norm.details, {
      errorName: err instanceof Error ? err.name : typeof err,
      status: (err as { status?: unknown } | null)?.status,
      providerMessage: message.slice(0, 300),
    });
    return norm;
  }

  private classify(err: unknown, message: string): AppError {
    if (
      err instanceof ApiError ||
      (typeof (err as ApiError)?.status === 'number' && err instanceof Error)
    ) {
      const status = (err as ApiError).status;
      const lower = message.toLowerCase();
      if (status === 400 && /api key|api_key/.test(lower)) return new AppError('INVALID_API_KEY');
      if (status === 401 || status === 403) return new AppError('INVALID_API_KEY');
      if (status === 402)
        return new AppError('PROVIDER_QUOTA_EXCEEDED', 'prepaid credits depleted');
      if (status === 404 && /no longer available|new users/.test(lower)) {
        return new AppError(
          'PROVIDER_MODEL_UNAVAILABLE',
          `${this.model} is not available to this key`,
        );
      }
      if (status === 404) return new AppError('PROVIDER_MODEL_UNAVAILABLE', this.model);
      if (status === 429) {
        const daily = /per day|daily|billing|exceeded your current quota/.test(lower);
        if (daily && !/per minute/.test(lower)) return new AppError('PROVIDER_QUOTA_EXCEEDED');
        const e = new AppError('PROVIDER_RATE_LIMITED');
        const ms = parseRetryAfterMs(message);
        if (ms !== undefined) e.retryAfterMs = ms;
        return e;
      }
      if (status >= 500) return new AppError('PROVIDER_TIMEOUT', `HTTP ${status}`);
      return new AppError('PROVIDER_RESPONSE_INVALID', `HTTP ${status}`);
    }
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      return new AppError('PROVIDER_TIMEOUT');
    }
    if (
      /timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed|network/i.test(
        message,
      )
    ) {
      return new AppError('PROVIDER_TIMEOUT', 'network error');
    }
    return new AppError('PROVIDER_RESPONSE_INVALID', 'unexpected provider error');
  }
}

/** Parse the model's JSON text. Tolerates a stray Markdown fence, rejects anything else. */
export function parseModelJson(text: string): z.infer<typeof responseSchema> {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    const result = responseSchema.safeParse(JSON.parse(trimmed));
    if (result.success) return result.data;
  } catch {
    /* fall through */
  }
  throw new AppError('PROVIDER_RESPONSE_INVALID', 'response was not the expected JSON');
}
