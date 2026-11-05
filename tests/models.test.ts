import { describe, expect, it } from 'vitest';
import { listModels } from '../src/translation/models';

type Call = { url: string; headers: Record<string, string> };

function fakeFetch(pages: unknown[], status = 200): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
    const body = pages[Math.min(i++, pages.length - 1)];
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('listModels', () => {
  it('gemini: keeps only generateContent text models, follows pages, key only in a header', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        models: [
          {
            name: 'models/gemini-3.5-flash-lite',
            displayName: 'Gemini 3.5 Flash-Lite',
            supportedGenerationMethods: ['generateContent'],
          },
          {
            name: 'models/text-embedding-004',
            displayName: 'Embedding',
            supportedGenerationMethods: ['embedContent'],
          },
          {
            name: 'models/gemini-3.5-flash-image',
            displayName: 'Image',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
        nextPageToken: 'p2',
      },
      {
        models: [
          {
            name: 'models/gemini-3.5-flash',
            displayName: 'Gemini 3.5 Flash',
            supportedGenerationMethods: ['generateContent'],
          },
        ],
      },
    ]);
    const out = await listModels('gemini', 'AIzaSECRET', fetchImpl);
    expect(out.map((m) => m.id)).toEqual(['gemini-3.5-flash-lite', 'gemini-3.5-flash']);
    expect(out[0]?.label).toBe('Gemini 3.5 Flash-Lite');
    expect(calls).toHaveLength(2);
    expect(calls[1]?.url).toContain('pageToken=p2');
    for (const c of calls) {
      expect(c.url).not.toContain('AIzaSECRET');
      expect(c.headers['x-goog-api-key']).toBe('AIzaSECRET');
    }
  });

  it('gemini: shows only stable models, newest first, without previews, aliases and variants', async () => {
    const ids = [
      'gemini-2.5-flash',
      'gemini-2.5-pro',
      'gemini-flash-latest',
      'gemini-3.1-pro-preview-customtools',
      'gemini-3.1-flash-lite-preview',
      'gemini-nano-banana-2.1',
      'gemini-omni-1.1-flash',
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
    ];
    const { fetchImpl } = fakeFetch([
      {
        models: ids.map((id) => ({
          name: `models/${id}`,
          displayName: id,
          supportedGenerationMethods: ['generateContent'],
        })),
      },
    ]);
    const out = await listModels('gemini', 'AIzaSECRET', fetchImpl);
    expect(out.map((m) => m.id)).toEqual([
      'gemini-3.5-flash-lite',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-2.5-pro',
    ]);
  });

  it('anthropic: lists ids with display names and follows has_more', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', type: 'model' }],
        has_more: true,
        last_id: 'claude-haiku-5-5',
      },
      { data: [{ id: 'claude-sonnet-5-5', display_name: 'Claude Sonnet 5.5' }], has_more: false },
    ]);
    const out = await listModels('anthropic', 'sk-ant-SECRET', fetchImpl);
    expect(out.map((m) => m.id)).toEqual(['claude-haiku-5-5', 'claude-sonnet-5-5']);
    expect(calls[1]?.url).toContain('after_id=claude-haiku-5-5');
    expect(calls[0]?.headers['x-api-key']).toBe('sk-ant-SECRET');
    expect(calls[0]?.headers['anthropic-version']).toBe('2023-06-01');
    expect(calls[0]?.url).not.toContain('SECRET');
  });

  it('anthropic: hides deprecated and retired models', async () => {
    const { fetchImpl } = fakeFetch([
      {
        data: [
          { id: 'claude-haiku-5-5', lifecycle: 'active' },
          { id: 'claude-old-1', lifecycle: 'deprecated' },
          { id: 'claude-gone-1', lifecycle: 'retired' },
        ],
        has_more: false,
      },
    ]);
    const out = await listModels('anthropic', 'sk-ant-x', fetchImpl);
    expect(out.map((m) => m.id)).toEqual(['claude-haiku-5-5']);
  });

  it('openai: keeps chat models only (heuristic) and sorts them', async () => {
    const { fetchImpl, calls } = fakeFetch([
      {
        data: [
          { id: 'whisper-1' },
          { id: 'gpt-4o-mini' },
          { id: 'text-embedding-3-small' },
          { id: 'gpt-4o-mini-tts' },
          { id: 'gpt-4.1' },
          { id: 'o3-mini' },
          { id: 'dall-e-3' },
          { id: 'gpt-4o-realtime-preview' },
        ],
      },
    ]);
    const out = await listModels('openai', 'sk-SECRET', fetchImpl);
    expect(out.map((m) => m.id)).toEqual(['gpt-4.1', 'gpt-4o-mini', 'o3-mini']);
    expect(calls[0]?.headers.Authorization).toBe('Bearer sk-SECRET');
    expect(calls[0]?.url).not.toContain('SECRET');
  });

  it('turns an HTTP failure into an AppError without leaking the key', async () => {
    const { fetchImpl } = fakeFetch([{ error: { message: 'bad key sk-SECRET' } }], 401);
    await expect(listModels('openai', 'sk-SECRET', fetchImpl)).rejects.toMatchObject({
      code: 'INVALID_API_KEY',
    });
  });

  it('fails with a clear error when the list comes back empty', async () => {
    const { fetchImpl } = fakeFetch([{ data: [] }]);
    await expect(listModels('anthropic', 'sk-ant-x', fetchImpl)).rejects.toMatchObject({
      code: 'PROVIDER_RESPONSE_INVALID',
    });
  });
});
