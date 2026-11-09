import { describe, expect, it } from 'vitest';
import { isNoShift } from '../src/jobs/manager';

const base = { scale: 1, offsetMs: 0, score: 1, baseline: 1 };

describe('isNoShift', () => {
  it('is true when every listened piece is already on the speech', () => {
    const parts = [
      { atSec: 1714, offsetMs: 0 },
      { atSec: 7407, offsetMs: 20 },
    ];
    expect(isNoShift({ ...base, parts })).toBe(true);
  });

  it('is true when no piece could be measured', () => {
    expect(isNoShift({ ...base, parts: [{ atSec: 10, offsetMs: null }] })).toBe(true);
  });

  it('is false when one piece is still off', () => {
    const parts = [
      { atSec: 1714, offsetMs: 0 },
      { atSec: 7407, offsetMs: 900 },
    ];
    expect(isNoShift({ ...base, parts })).toBe(false);
  });

  it('is false for a real offset, a scale change, or moving knots', () => {
    expect(isNoShift({ ...base, offsetMs: 15300 })).toBe(false);
    expect(isNoShift({ ...base, scale: 1.001 })).toBe(false);
    expect(isNoShift({ ...base, knots: [{ atMs: 0, offsetMs: 500 }] })).toBe(false);
  });
});
