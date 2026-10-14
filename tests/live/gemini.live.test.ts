import 'dotenv/config';
import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/env';
import { OpenSubtitlesProvider } from '../../src/sources/opensubtitles/provider';
import { GeminiProvider } from '../../src/translation/gemini';
import { silentLogger } from '../helpers';

// Runs only with LIVE_TEST=1 (npm run test:live). One tiny request per provider.
describe.skipIf(process.env.LIVE_TEST !== '1')('live providers', () => {
  const config = loadConfig();

  it('Gemini translates one short cue', async () => {
    const p = new GeminiProvider({
      apiKey: config.geminiApiKey,
      model: config.geminiModel,
      timeoutMs: config.geminiTimeoutMs,
    });
    const r = await p.translateChunk({
      targetLanguage: 'Hebrew',
      targetLanguageCode: 'he',
      cues: [{ id: '1', text: 'Good morning.' }],
      context: [],
    });
    expect(r.translations).toHaveLength(1);
  });

  it('OpenSubtitles login and search work (no download quota used)', async () => {
    const p = new OpenSubtitlesProvider({
      credentials: {
        apiKey: config.openSubtitlesApiKey,
        username: config.openSubtitlesUsername,
        password: config.openSubtitlesPassword,
        userAgent: config.openSubtitlesUserAgent,
      },
      logger: silentLogger(),
    });
    expect((await p.testConnection()).ok).toBe(true);
    const found = await p.search({
      video: { type: 'movie', imdbId: 'tt0111161' },
      languages: ['en'],
    });
    expect(found.length).toBeGreaterThan(0);
  });
});
