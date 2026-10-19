/** Which AI provider a pasted key belongs to. One source of truth for server and page. */
export type ProviderId = 'gemini' | 'anthropic' | 'openai';

export interface ProviderInfo {
  id: ProviderId;
  label: string;
  model: string;
  /** Key prefix. Rules are checked in order, so "sk-ant" must come before "sk-". */
  prefix: string;
}

export const PROVIDERS: readonly ProviderInfo[] = [
  { id: 'gemini', label: 'Google Gemini', model: 'gemini-3.5-flash-lite', prefix: 'AIza' },
  { id: 'anthropic', label: 'Anthropic Claude', model: 'claude-haiku-5-5', prefix: 'sk-ant' },
  { id: 'openai', label: 'OpenAI', model: 'gpt-4o-mini', prefix: 'sk-' },
];

export function detectProvider(key: string): ProviderInfo | undefined {
  const k = key.trim();
  return PROVIDERS.find((p) => k.startsWith(p.prefix));
}
