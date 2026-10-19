import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config/env';
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
