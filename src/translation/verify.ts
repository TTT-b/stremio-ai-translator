import { detectProvider, PROVIDERS, type ProviderInfo } from './providers';

export type VerifyResult =
  | { ok: true; provider: ProviderInfo }
  | {
      ok: false;
      /** `invalid`: every provider refused the key. `unreachable`: no clear answer (offline, 429, 5xx). */
      reason: 'invalid' | 'unreachable';
    };

/** Free "list models" requests. The key goes in a header, never in the URL. */
const PROBES: Record<ProviderInfo['id'], (key: string) => { url: string; headers: HeadersInit }> = {
  gemini: (key) => ({
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1',
    headers: { 'x-goog-api-key': key },
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
  }),
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=1',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
  }),
};

/**
 * Find out which provider a key really belongs to by asking them, one at a time. The prefix is
 * only a hint for which provider to ask first (so a key is rarely sent to the wrong company).
 * A provider counts only when it answers 2xx; 400/401/403 mean "not your key".
 */
export async function verifyAiKey(
  rawKey: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<VerifyResult> {
  const key = rawKey.trim();
  if (!key) return { ok: false, reason: 'invalid' };
  const hint = detectProvider(key);
  const order = hint ? [hint, ...PROVIDERS.filter((p) => p.id !== hint.id)] : [...PROVIDERS];
  let inconclusive = false;
  for (const provider of order) {
    const { url, headers } = PROBES[provider.id](key);
    try {
      const res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
      await res.arrayBuffer().catch(() => undefined);
      if (res.ok) return { ok: true, provider };
      if (![400, 401, 403].includes(res.status)) inconclusive = true;
    } catch {
      inconclusive = true;
    }
  }
  return { ok: false, reason: inconclusive ? 'unreachable' : 'invalid' };
}
