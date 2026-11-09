import { describe, expect, it } from 'vitest';
import {
  candidateKey,
  offerTryAnother,
  withoutTried,
  OFFER_MIN_OFFSET_MS,
} from '../src/jobs/tryAnother';

const c = (provider: string, fileId: string) => ({ provider, fileId });

describe('candidateKey', () => {
  it('names a file by its source and id, OpenSubtitles when the source is not set', () => {
    expect(candidateKey({ fileId: '12' })).toBe('opensubtitles:12');
    expect(candidateKey(c('subdl', 'a9'))).toBe('subdl:a9');
  });
});

describe('withoutTried', () => {
  const all = [c('subdl', '1'), c('opensubtitles', '2'), c('jimaku', '3')];

  it('drops the files that were already tried', () => {
    expect(withoutTried(all, ['subdl:1', 'jimaku:3'])).toEqual([c('opensubtitles', '2')]);
  });

  it('keeps everything when nothing was tried', () => {
    expect(withoutTried(all, undefined)).toEqual(all);
  });

  it('keeps everything when every file was tried, so the user never ends with nothing', () => {
    expect(withoutTried(all, all.map(candidateKey))).toEqual(all);
  });
});

describe('offerTryAnother', () => {
  const base = { outcome: 'moved' as const };

  it('offers it when the timing moved by more than two seconds, either way', () => {
    expect(offerTryAnother({ ...base, offsetMs: OFFER_MIN_OFFSET_MS + 1 })).toBe(true);
    expect(offerTryAnother({ ...base, offsetMs: -(OFFER_MIN_OFFSET_MS + 1) })).toBe(true);
  });

  it('does not offer it for a small move or a subtitle that fits', () => {
    expect(offerTryAnother({ ...base, offsetMs: 800 })).toBe(false);
    expect(offerTryAnother({ outcome: 'inSync' })).toBe(false);
  });

  it('offers it when the check could not run, and not when nothing was checked yet', () => {
    expect(offerTryAnother({ outcome: 'unavailable' })).toBe(true);
    expect(offerTryAnother({ outcome: 'kept' })).toBe(true);
    expect(offerTryAnother(null)).toBe(false);
  });
});
