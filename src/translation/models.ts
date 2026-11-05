import { AppError } from '../errors';
import { classifyHttp } from './httpProviders';
import type { ProviderId } from './providers';

/** One model the user can pick for translating. */
export interface ModelOption {
  id: string;
  label: string;
}

const LIST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 5;

/** Models that are not text-to-text translators (images, speech, embeddings, live audio...). */
const NOT_TEXT_MODEL =
  /image|imagen|veo|tts|audio|live|realtime|transcribe|embed|aqa|moderation|whisper|dall-e|search|instruct|codex|vision/i;

async function getJson(
  url: string,
  headers: Record<string, string>,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
  } catch {
    throw new AppError('PROVIDER_TIMEOUT', 'network error');
  }
  const text = await res.text();
  if (!res.ok) {
    const e = classifyHttp(res.status, text, '');
    Object.assign(e.details, { status: res.status });
    throw e;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new AppError('PROVIDER_RESPONSE_INVALID', 'response was not JSON');
  }
}

interface GeminiList {
  models?: { name?: string; displayName?: string; supportedGenerationMethods?: string[] }[];
  nextPageToken?: string;
}

async function listGemini(key: string, fetchImpl: typeof fetch): Promise<ModelOption[]> {
  const out: ModelOption[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`;
    const data = (await getJson(
      `https://generativelanguage.googleapis.com/v1beta/models?${q}`,
      { 'x-goog-api-key': key },
      fetchImpl,
    )) as GeminiList;
    for (const m of data.models ?? []) {
      const id = (m.name ?? '').replace(/^models\//, '');
      if (!id.startsWith('gemini') || NOT_TEXT_MODEL.test(id)) continue;
      if (!(m.supportedGenerationMethods ?? []).includes('generateContent')) continue;
      out.push({ id, label: m.displayName || id });
    }
    token = data.nextPageToken;
    if (!token) break;
  }
  return out;
}

interface AnthropicList {
  data?: { id?: string; display_name?: string }[];
  has_more?: boolean;
  last_id?: string;
}

async function listAnthropic(key: string, fetchImpl: typeof fetch): Promise<ModelOption[]> {
  const out: ModelOption[] = [];
  let after: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = `limit=1000${after ? `&after_id=${encodeURIComponent(after)}` : ''}`;
    const data = (await getJson(
      `https://api.anthropic.com/v1/models?${q}`,
      { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      fetchImpl,
    )) as AnthropicList;
    for (const m of data.data ?? []) {
      if (m.id) out.push({ id: m.id, label: m.display_name || m.id });
    }
    after = data.has_more ? data.last_id : undefined;
    if (!after) break;
  }
  return out;
}

interface OpenAiList {
  data?: { id?: string }[];
}

/** OpenAI's list has no "can chat" flag, so chat models are picked by name (a heuristic). */
async function listOpenAi(key: string, fetchImpl: typeof fetch): Promise<ModelOption[]> {
  const data = (await getJson(
    'https://api.openai.com/v1/models',
    { Authorization: `Bearer ${key}` },
    fetchImpl,
  )) as OpenAiList;
  return (data.data ?? [])
    .map((m) => m.id ?? '')
    .filter((id) => /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_TEXT_MODEL.test(id))
    .sort()
    .map((id) => ({ id, label: id }));
}

/**
 * Ask the provider which models this key can use. The key goes only in a request header.
 * Throws an AppError when the provider refuses or returns nothing usable.
 */
export async function listModels(
  provider: ProviderId,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<ModelOption[]> {
  const list =
    provider === 'gemini'
      ? await listGemini(apiKey, fetchImpl)
      : provider === 'anthropic'
        ? await listAnthropic(apiKey, fetchImpl)
        : await listOpenAi(apiKey, fetchImpl);
  if (list.length === 0) {
    throw new AppError('PROVIDER_RESPONSE_INVALID', 'the provider returned no usable models');
  }
  return list;
}
