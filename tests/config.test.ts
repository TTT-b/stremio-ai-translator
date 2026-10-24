import { describe, expect, it } from 'vitest';
import { loadConfig, secretValues } from '../src/config/env';
import { effectiveConfig, parseSettingsUpdate } from '../src/config/settings';
import { AppError } from '../src/errors';

describe('loadConfig', () => {
  it('applies defaults with an empty environment', () => {
    const c = loadConfig({});
    expect(c.port).toBe(7000);
    expect(c.host).toBe('127.0.0.1');
    expect(c.targetLanguage).toBe('he');
    expect(c.rtlFix).toBe(true);
    expect(loadConfig({ RTL_FIX: 'false' }).rtlFix).toBe(false);
    expect(c.aiApiKey).toBe('');
    expect(c.dualSubtitles).toBe(false);
    expect(c.partialSubtitles).toBe(true);
    expect(loadConfig({ PARTIAL_SUBTITLES: 'false' }).partialSubtitles).toBe(false);
  });

  it('has the recommended developer settings by default, and reads the Jimaku key', () => {
    const c = loadConfig({ JIMAKU_API_KEY: 'jk-abcdef-123456' });
    expect(c).toMatchObject({
      seasonPacks: true,
      prefetchNext: false,
      soundCheck: 'background',
      embeddedWaitSec: 15,
      embeddedMaxEtaSec: 180,
      jimakuApiKey: 'jk-abcdef-123456',
    });
    expect(loadConfig({}).jimakuApiKey).toBe('');
    expect(secretValues(c)).toContain('jk-abcdef-123456');
  });

  it('developer settings from settings.json replace the defaults, and bad ones are refused', () => {
    const c = effectiveConfig(loadConfig({}), {
      soundCheck: 'off',
      seasonPacks: false,
      prefetchNext: false,
      embeddedWaitSec: 30,
      embeddedMaxEtaSec: 0,
    });
    expect(c).toMatchObject({
      soundCheck: 'off',
      seasonPacks: false,
      prefetchNext: false,
      embeddedWaitSec: 30,
      embeddedMaxEtaSec: 0,
    });
    for (const bad of [
      { soundCheck: 'loud' },
      { embeddedWaitSec: -1 },
      { embeddedWaitSec: 1000 },
      { embeddedMaxEtaSec: 1.5 },
      { sourceOrder: ['subdl', 'nowhere'] },
      { sourceOrder: ['subdl', 'opensubtitles', 'jimaku', 'subdl'] },
    ]) {
      expect(() => parseSettingsUpdate(bad)).toThrow();
    }
    expect(parseSettingsUpdate({ sourceOrder: [] })).toEqual({ sourceOrder: [] });
  });

  it('reads provided values', () => {
    const c = loadConfig({
      PORT: '7100',
      TARGET_LANGUAGE: 'FR',
      RTL_FIX: 'true',
      CHUNK_SIZE: '30',
    });
    expect(c.port).toBe(7100);
    expect(c.targetLanguage).toBe('fr');
    expect(c.rtlFix).toBe(true);
    expect(c.chunkSize).toBe(30);
    expect(c.maxConcurrentJobs).toBe(4); // Stremio asks twice per episode, so 2 slots left no room for a third request
  });

  it('names the bad variable but never its value', () => {
    const secret = 'not-a-number-SECRETVALUE';
    try {
      loadConfig({ PORT: secret, LOG_LEVEL: 'loud' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      const msg = (err as AppError).message;
      expect(msg).toContain('PORT');
      expect(msg).toContain('LOG_LEVEL');
      expect(msg).not.toContain(secret);
      expect((err as AppError).code).toBe('CONFIGURATION_INVALID');
    }
  });

  it('rejects unsupported target language', () => {
    expect(() => loadConfig({ TARGET_LANGUAGE: 'xx' })).toThrow(/TARGET_LANGUAGE/);
  });
});
