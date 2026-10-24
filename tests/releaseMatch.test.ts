import { describe, expect, it } from 'vitest';
import { rankSameLanguage, releaseSimilarity, selectSubtitle } from '../src/sources/select';
import type { SubtitleCandidate } from '../src/sources/types';

const cand = (over: Partial<SubtitleCandidate>): SubtitleCandidate => ({
  fileId: 1,
  language: 'en',
  fileName: '',
  downloadCount: 10,
  rating: 5,
  hashMatch: false,
  hearingImpaired: false,
  machineTranslated: false,
  ...over,
});

const VIDEO = '[Group] Sword Art Online - 07 [BD 1080p x265].mkv';

describe('releaseSimilarity', () => {
  it('is higher for the same release than for another one', () => {
    const same = releaseSimilarity('Sword.Art.Online.07.BD.1080p.x265.Group.srt', VIDEO);
    const other = releaseSimilarity('Sword.Art.Online.07.DVDRip.480p.xvid.Other.srt', VIDEO);
    expect(same).toBeGreaterThan(other);
    expect(same).toBeGreaterThan(0.5);
  });

  it('is 0 without a video file name or without words', () => {
    expect(releaseSimilarity('a.srt', undefined)).toBe(0);
    expect(releaseSimilarity('.srt', VIDEO)).toBe(0);
  });
});

describe('choosing a subtitle for the playing file', () => {
  const first = cand({
    fileId: 1,
    providerRank: 0,
    provider: 'subdl',
    fileName: 'Sword.Art.Online.07.DVDRip.480p.xvid.Other.srt',
  });
  const matching = cand({
    fileId: 2,
    providerRank: 1,
    provider: 'opensubtitles',
    fileName: 'Sword.Art.Online.07.BD.1080p.x265.Group.srt',
  });

  it('prefers the release that matches the file over the first source', () => {
    const picked = selectSubtitle([first, matching], 'he', 'en', VIDEO);
    expect(picked.kind === 'translate' && picked.candidate.fileId).toBe(2);
  });

  it('keeps the source order when no file name is known', () => {
    const picked = selectSubtitle([first, matching], 'he', 'en');
    expect(picked.kind === 'translate' && picked.candidate.fileId).toBe(1);
  });

  it('still puts a hash match first', () => {
    const exact = cand({ fileId: 3, hashMatch: true, fileName: 'x.srt', providerRank: 2 });
    expect(rankSameLanguage([first, matching, exact], 'en', VIDEO)[0]?.fileId).toBe(3);
  });
});
