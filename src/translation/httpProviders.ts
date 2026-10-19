import { AppError, isAppError } from '../errors';
import { parseModelJson, parseRetryAfterMs } from './gemini';
import { buildSystemInstruction } from './prompts/v1';
import type {
  ConnectionTestResult,
  ModelInformation,
  TranslateChunkRequest,
  TranslateChunkResult,
  TranslationProvider,
} from './provider';

export interface HttpProviderOptions {
  apiKey: string;
  model: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}

interface Reply {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

/** Map an HTTP failure to an AppError. The response body is read only for quota wording. */
export function classifyHttp(status: number, body: string, model: string): AppError {
  const lower = body.toLowerCase();
  if (status === 401 || status === 403) return new AppError('INVALID_API_KEY');
  if (status === 402) return new AppError('PROVIDER_QUOTA_EXCEEDED', 'credits depleted');
  if (status === 404) return new AppError('PROVIDER_MODEL_UNAVAILABLE', model);
  if (status === 429) {
    if (/insufficient_quota|billing|credit balance|exceeded your current quota/.test(lower)) {
      return new AppError('PROVIDER_QUOTA_EXCEEDED');
    }
    const e = new AppError('PROVIDER_RATE_LIMITED');
    const ms = parseRetryAfterMs(body);
    if (ms !== undefined) e.retryAfterMs = ms;
    return e;
  }
  if (status >= 500) return new AppError('PROVIDER_TIMEOUT', `HTTP ${status}`);
  return new AppError('PROVIDER_RESPONSE_INVALID', `HTTP ${status}`);
}

/** Shared plumbing for providers reached over plain HTTPS (OpenAI, Anthropic). */
abstract class HttpProvider implements TranslationProvider {
  protected readonly fetchImpl: typeof fetch;

  constructor(
    protected readonly opts: HttpProviderOptions,
    private readonly name: string,
    private readonly label: string,
  ) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  /** Send one prompt and return the model's text. Must not put the key anywhere but headers. */
  protected abstract send(system: string, user: string, jsonMode: boolean): Promise<Reply>;

  getProviderName(): string {
    return this.name;
  }

  getModelInformation(): ModelInformation {
    return { provider: this.name, model: this.opts.model };
  }

  async testConnection(): Promise<ConnectionTestResult> {
    const base = { provider: this.name, model: this.opts.model };
    if (!this.opts.apiKey) {
      return {
        ...base,
        ok: false,
        code: 'CONFIGURATION_INVALID',
        message: 'The AI provider API key is not set. Add it in the API keys card.',
      };
    }
    try {
      await this.send('Reply with the single word: ok', 'ok', false);
      return {
        ...base,
        ok: true,
        message: `Connected to ${this.label}. Model ${this.opts.model} responded.`,
      };
    } catch (err) {
      const e = this.normalizeError(err);
      return { ...base, ok: false, code: e.code, message: e.message, details: e.details };
    }
  }

  async translateChunk(req: TranslateChunkRequest): Promise<TranslateChunkResult> {
    if (!this.opts.apiKey) {
      throw new AppError('CONFIGURATION_INVALID', 'AI provider API key is not set');
    }
    const payload = {
      targetLanguage: req.targetLanguage,
      context: req.context,
      upcoming: req.upcoming ?? [],
      cues: req.cues,
    };
    let reply: Reply;
    try {
      reply = await this.send(
        buildSystemInstruction(req.targetLanguage, req.targetLanguageCode),
        JSON.stringify(payload),
        true,
      );
    } catch (err) {
      throw this.normalizeError(err);
    }
    const parsed = parseModelJson(reply.text);
    return {
      translations: parsed.translations.map((t) => ({ id: String(t.id), text: t.text })),
      usage: { inputTokens: reply.inputTokens, outputTokens: reply.outputTokens },
    };
  }

  normalizeError(err: unknown): AppError {
    if (isAppError(err)) return err;
    const message = err instanceof Error ? err.message : String(err);
    let norm: AppError;
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'TimeoutError')) {
      norm = new AppError('PROVIDER_TIMEOUT');
    } else if (
      /timeout|timed out|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)
    ) {
      norm = new AppError('PROVIDER_TIMEOUT', 'network error');
    } else {
      norm = new AppError('PROVIDER_RESPONSE_INVALID', 'unexpected provider error');
    }
    Object.assign(norm.details, { errorName: err instanceof Error ? err.name : typeof err });
    return norm;
  }

  /** POST JSON and return the parsed body; HTTP errors become AppErrors. */
  protected async postJson(
    url: string,
    headers: Record<string, string>,
    body: unknown,
  ): Promise<unknown> {
    const res = await this.fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.opts.timeoutMs),
    });
    const text = await res.text();
    if (!res.ok) {
      const e = classifyHttp(res.status, text, this.opts.model);
      const header = Number(res.headers.get('retry-after'));
      if (e.code === 'PROVIDER_RATE_LIMITED' && Number.isFinite(header) && header > 0) {
        e.retryAfterMs = Math.ceil(header * 1000);
      }
      Object.assign(e.details, { status: res.status });
      throw e;
    }
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new AppError('PROVIDER_RESPONSE_INVALID', 'response was not JSON');
    }
  }
}

interface OpenAiResponse {
  choices?: { message?: { content?: string } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiProvider extends HttpProvider {
  constructor(opts: HttpProviderOptions) {
    super(opts, 'openai', 'OpenAI');
  }

  protected async send(system: string, user: string, jsonMode: boolean): Promise<Reply> {
    const data = (await this.postJson(
      'https://api.openai.com/v1/chat/completions',
      { Authorization: `Bearer ${this.opts.apiKey}` },
      {
        model: this.opts.model,
        temperature: 0.3,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      },
    )) as OpenAiResponse;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}

interface AnthropicResponse {
  content?: { type?: string; text?: string }[];
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicProvider extends HttpProvider {
  constructor(opts: HttpProviderOptions) {
    super(opts, 'anthropic', 'Anthropic Claude');
  }

  protected async send(system: string, user: string): Promise<Reply> {
    const data = (await this.postJson(
      'https://api.anthropic.com/v1/messages',
      { 'x-api-key': this.opts.apiKey, 'anthropic-version': '2023-06-01' },
      {
        model: this.opts.model,
        max_tokens: 8192,
        temperature: 0.3,
        system,
        messages: [{ role: 'user', content: user }],
      },
    )) as AnthropicResponse;
    return {
      text: (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text ?? '')
        .join(''),
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
}
