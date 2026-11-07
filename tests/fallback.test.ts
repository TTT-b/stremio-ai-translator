import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { ModelFallbackProvider } from '../src/translation/fallback';
import type { TranslateChunkRequest } from '../src/translation/provider';
import { FakeProvider } from './helpers';

const REQ: TranslateChunkRequest = {
  targetLanguage: 'Hebrew',
  targetLanguageCode: 'he',
  cues: [{ id: '1', text: 'hi' }],
  context: [],
};

function build(behaviour: Record<string, () => void>, switches: string[] = []) {
  const made: Record<string, FakeProvider> = {};
  const provider = new ModelFallbackProvider(
    ['m-a', 'm-b', 'm-c'],
    (model) =>
      (made[model] = new FakeProvider(async (req) => {
        behaviour[model]?.();
        return { translations: req.cues.map((c) => ({ id: c.id, text: `${model}:${c.text}` })) };
      })),
    (from, to) => switches.push(`${from}>${to}`),
  );
  return { provider, made, switches };
}

describe('ModelFallbackProvider', () => {
  it('uses the chosen model while it works and reports it as the model for the cache', async () => {
    const { provider, switches, made } = build({});
    const out = await provider.translateChunk(REQ);
    expect(out.translations[0]?.text).toBe('m-a:hi');
    expect(switches).toEqual([]);
    expect(provider.getModelInformation()).toEqual(made['m-a']?.getModelInformation());
    expect(provider.activeModel()).toBe('m-a');
  });

  it('moves to the next model when the chosen one is overloaded, and stays there', async () => {
    const overload = (): void => {
      throw new AppError('PROVIDER_TIMEOUT', 'HTTP 503');
    };
    const { provider, made, switches } = build({ 'm-a': overload });
    const first = await provider.translateChunk(REQ);
    const second = await provider.translateChunk(REQ);
    expect(first.translations[0]?.text).toBe('m-b:hi');
    expect(second.translations[0]?.text).toBe('m-b:hi');
    expect(switches).toEqual(['m-a>m-b']);
    expect(made['m-a']?.calls).toBe(1);
    expect(provider.activeModel()).toBe('m-b');
  });

  it('skips a model that does not exist and a model that is out of quota', async () => {
    const { provider, switches } = build({
      'm-a': () => {
        throw new AppError('PROVIDER_MODEL_UNAVAILABLE', 'm-a');
      },
      'm-b': () => {
        throw new AppError('PROVIDER_QUOTA_EXCEEDED');
      },
    });
    const out = await provider.translateChunk(REQ);
    expect(out.translations[0]?.text).toBe('m-c:hi');
    expect(switches).toEqual(['m-a>m-b', 'm-b>m-c']);
  });

  it('does not switch on a per-minute rate limit: it is waited out on the chosen model', async () => {
    const { provider, made, switches } = build({
      'm-a': () => {
        throw new AppError('PROVIDER_RATE_LIMITED');
      },
    });
    await expect(provider.translateChunk(REQ)).rejects.toMatchObject({
      code: 'PROVIDER_RATE_LIMITED',
    });
    expect(made['m-b']?.calls).toBe(0);
    expect(switches).toEqual([]);
    expect(provider.activeModel()).toBe('m-a');
  });

  it('does not switch for errors that another model cannot fix', async () => {
    const { provider, made } = build({
      'm-a': () => {
        throw new AppError('INVALID_API_KEY');
      },
    });
    await expect(provider.translateChunk(REQ)).rejects.toMatchObject({ code: 'INVALID_API_KEY' });
    expect(made['m-b']?.calls).toBe(0);
  });

  it('when every model fails it throws, and starts again from the chosen model next time', async () => {
    let down = true;
    const overload = (): void => {
      if (down) throw new AppError('PROVIDER_TIMEOUT', 'HTTP 503');
    };
    const { provider } = build({ 'm-a': overload, 'm-b': overload, 'm-c': overload });
    await expect(provider.translateChunk(REQ)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
    expect(provider.activeModel()).toBe('m-a');
    down = false;
    const out = await provider.translateChunk(REQ);
    expect(out.translations[0]?.text).toBe('m-a:hi');
  });

  it('reports the busy error, not a missing model, when the last model does not exist', async () => {
    const busy = (): void => {
      throw new AppError('PROVIDER_TIMEOUT', 'HTTP 503');
    };
    const { provider } = build({
      'm-a': busy,
      'm-b': busy,
      'm-c': () => {
        throw new AppError('PROVIDER_MODEL_UNAVAILABLE', 'm-c');
      },
    });
    // The pipeline waits out a busy error; a missing-model error would fail the job at once.
    await expect(provider.translateChunk(REQ)).rejects.toMatchObject({ code: 'PROVIDER_TIMEOUT' });
  });
});
