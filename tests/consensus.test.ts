import { describe, expect, it } from 'vitest';
import { pickByConsensus, startAgreement } from '../src/subtitles/consensus';
import type { Cue } from '../src/subtitles/types';

/** Cues starting at the given seconds. */
const cues = (...seconds: number[]): Cue[] =>
  seconds.map((s, i) => ({ index: i + 1, startMs: s * 1000, endMs: s * 1000 + 1500, text: 'x' }));

const base = [10, 20, 30, 40, 50, 60, 70, 80];
const shifted = (by: number) => base.map((s) => s + by);

describe('startAgreement', () => {
  it('is 1 for identical timing and 0 for far-apart timing', () => {
    expect(startAgreement(cues(...base), cues(...base))).toBe(1);
    expect(startAgreement(cues(...base), cues(...shifted(3)))).toBe(0);
  });

  it('tolerates small differences', () => {
    expect(startAgreement(cues(...base), cues(...base.map((s) => s + 0.3)))).toBe(1);
  });

  it('is 0 for empty input', () => {
    expect(startAgreement([], cues(1))).toBe(0);
    expect(startAgreement(cues(1), [])).toBe(0);
  });
});

describe('pickByConsensus', () => {
  it('needs at least three files', () => {
    expect(
      pickByConsensus([
        { item: 'a', cues: cues(...base) },
        { item: 'b', cues: cues(...base) },
      ]),
    ).toBeUndefined();
  });

  it('skips an off-sync file that came first and takes one from the majority', () => {
    const r = pickByConsensus([
      { item: 'odd', cues: cues(...shifted(2)) },
      { item: 'a', cues: cues(...base) },
      { item: 'b', cues: cues(...base) },
      { item: 'c', cues: cues(...base) },
    ]);
    expect(r?.winner).toBe('a');
  });

  it('keeps the best-ranked file when the majority agrees equally', () => {
    const r = pickByConsensus([
      { item: 'first', cues: cues(...base) },
      { item: 'second', cues: cues(...base) },
      { item: 'third', cues: cues(...base) },
    ]);
    expect(r?.winner).toBe('first');
  });

  it('ignores language: only timing is compared', () => {
    const r = pickByConsensus([
      { item: 'odd', cues: cues(...shifted(3)) },
      { item: 'x', cues: cues(...base).map((c) => ({ ...c, text: 'שלום' })) },
      { item: 'y', cues: cues(...base) },
    ]);
    expect(r?.winner).not.toBe('odd');
  });
});
