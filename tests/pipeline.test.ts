import { describe, expect, it } from 'vitest';
import { assembleCues, runPool, stripHebrewPoints } from '../src/translation/pipeline';

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 1));

describe('runPool with a throttled lane', () => {
  it('ends when the parts are gone even if a lane never gets its turn', async () => {
    // Lane 1 is held back (slow-down mode lets only lane 0 start); lane 0 takes every part.
    const gate = async (lane: number, stopped: () => boolean): Promise<void> => {
      while (lane === 1 && !stopped()) await tick();
    };
    const results = await runPool(
      [1, 2, 3],
      2,
      async (n) => {
        await tick();
        return n * 2;
      },
      gate,
    );
    expect(results).toEqual([2, 4, 6]);
  });

  it('does not hang when the last part was taken by the lane that was waiting', async () => {
    let lane1Open = false;
    const gate = async (lane: number, stopped: () => boolean): Promise<void> => {
      while (lane === 1 && !lane1Open && !stopped()) await tick();
    };
    const results = await runPool(
      [1, 2],
      2,
      async (n) => {
        if (n === 1) lane1Open = true;
        await tick();
        return n;
      },
      gate,
    );
    expect(results).toEqual([1, 2]);
  });
});

describe('Hebrew vowel marks', () => {
  it('removes niqqud but keeps the letters and punctuation', () => {
    expect(stripHebrewPoints('הַרְטוֹן יוֹצֵא עוֹד עֶשֶׂר דַּקּוֹת.')).toBe(
      'הרטון יוצא עוד עשר דקות.',
    );
    expect(stripHebrewPoints('מה-שלומך?')).toBe('מה-שלומך?');
  });

  it('never puts niqqud into the assembled cues', () => {
    const cue = { index: 1, startMs: 0, endMs: 1000, text: 'Hello' };
    const out = assembleCues([cue], new Map([['1', 'שָׁלוֹם']]), {
      dualSubtitles: false,
      rtlFix: false,
    });
    expect(out[0]?.text).toBe('שלום');
  });
});
