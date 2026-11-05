import { describe, expect, it } from 'vitest';
import { combineEta, estimateTranslateSec } from '../src/jobs/eta';

describe('translation time estimate', () => {
  it('waits for some time and some progress before saying anything', () => {
    expect(estimateTranslateSec(2_000, 10, 100)).toBeNull();
    expect(estimateTranslateSec(20_000, 0, 100)).toBeNull();
  });

  it('has nothing left to estimate when it is done', () => {
    expect(estimateTranslateSec(20_000, 100, 100)).toBeNull();
  });

  it('projects the speed so far onto what is left, to 5 seconds', () => {
    // 10 s for 25 of 100 lines: 30 s left.
    expect(estimateTranslateSec(10_000, 25, 100)).toBe(30);
    // 7 s for 50 of 100: 7 s left, rounded to 5.
    expect(estimateTranslateSec(7_000, 50, 100)).toBe(5);
  });

  it('never goes below 5 seconds while something is left', () => {
    expect(estimateTranslateSec(60_000, 99, 100)).toBe(5);
  });
});

describe('total time until the full subtitle', () => {
  it('adds the translation and the sound check', () => {
    expect(combineEta(40, 90)).toBe(130);
  });

  it('counts a part that is not running as zero', () => {
    expect(combineEta(40, 0)).toBe(40);
    expect(combineEta(0, 90)).toBe(90);
  });

  it('gives no number when a running part cannot be estimated yet', () => {
    expect(combineEta(null, 90)).toBeNull();
    expect(combineEta(40, null)).toBeNull();
  });

  it('gives no number when nothing is running', () => {
    expect(combineEta(0, 0)).toBeNull();
  });
});
