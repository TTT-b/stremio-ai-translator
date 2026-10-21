import { describe, expect, it } from 'vitest';
import { RECOMMENDED_ORDER, sourceOrderFrom } from '../src/sources/order';
import { rankSameLanguage, score, selectSubtitle } from '../src/sources/select';
import type { SubtitleCandidate } from '../src/sources/types';

const cand = (over: Partial<SubtitleCandidate> = {}): SubtitleCandidate => ({
  fileId: 1,
  language: 'en',
  fileName: 'a',
  downloadCount: 100,
  rating: 5,
  hashMatch: false,
  hearingImpaired: false,
  machineTranslated: false,
  ...over,
});

describe('source order', () => {
  it('uses the saved order, then the older "first source" choice, then the recommended order', () => {
    expect(sourceOrderFrom({ sourceOrder: ['jimaku', 'subdl'] })).toEqual(['jimaku', 'subdl']);
    expect(sourceOrderFrom({ sourceOrder: ['subdl', 'subdl', 'opensubtitles'] })).toEqual([
      'subdl',
      'opensubtitles',
    ]);
    expect(sourceOrderFrom({ sourceOrder: [], subtitleSource: 'opensubtitles' })).toEqual([
      'opensubtitles',
      'subdl',
      'jimaku',
    ]);
    expect(sourceOrderFrom({})).toEqual(RECOMMENDED_ORDER);
    expect(RECOMMENDED_ORDER).toEqual(['subdl', 'opensubtitles', 'jimaku']);
  });

  it('prefers the earlier source among otherwise equal subtitles', () => {
    const os = cand({ fileId: 1, providerRank: 1 });
    const sd = cand({ fileId: 2, provider: 'subdl', providerRank: 0 });
    expect(rankSameLanguage([os, sd], 'en')[0]!.fileId).toBe(2);
    const osFirst = cand({ fileId: 1, providerRank: 0 });
    expect(rankSameLanguage([osFirst, { ...sd, providerRank: 1 }], 'en')[0]!.fileId).toBe(1);
  });

  it('an exact file match (hash) beats the order, and a single episode beats a season pack', () => {
    const hash = cand({ fileId: 1, hashMatch: true, providerRank: 2 });
    const first = cand({ fileId: 2, provider: 'subdl', providerRank: 0 });
    expect(selectSubtitle([first, hash], 'he')).toMatchObject({ candidate: { fileId: 1 } });
    const pack = cand({ fileId: 3, provider: 'subdl', pack: true, providerRank: 0 });
    const single = cand({ fileId: 4, provider: 'subdl', providerRank: 0 });
    expect(score(single)).toBeGreaterThan(score(pack));
  });

  it('English still wins over Japanese, whatever the order says', () => {
    const ja = cand({ fileId: 1, language: 'ja', provider: 'jimaku', providerRank: 0 });
    const en = cand({ fileId: 2, providerRank: 2 });
    expect(selectSubtitle([ja, en], 'he')).toMatchObject({
      kind: 'translate',
      candidate: { fileId: 2 },
    });
    expect(selectSubtitle([ja], 'he')).toMatchObject({
      kind: 'translate',
      candidate: { fileId: 1 },
    });
  });
});
