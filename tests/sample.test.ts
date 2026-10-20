import { describe, expect, it } from 'vitest';
import { parseSubtitle } from '../src/subtitles/parse';
import { pickSample, readableLines, SAMPLE_COUNT } from '../src/web/sample';

describe('sample subtitles', () => {
  it('there are several, and every one is a valid subtitle of three cues', () => {
    expect(SAMPLE_COUNT).toBeGreaterThanOrEqual(4);
    for (let i = 0; i < SAMPLE_COUNT; i++) {
      const sample = pickSample(() => i / SAMPLE_COUNT);
      expect(parseSubtitle(sample).cues).toHaveLength(3);
    }
  });

  it('the pick changes with the dice', () => {
    expect(pickSample(() => 0)).not.toBe(pickSample(() => 0.99));
    expect(pickSample(() => 0)).toBe(pickSample(() => 0));
  });

  it('readableLines drops tags and keeps lines apart', () => {
    expect(readableLines(['<i>Hi</i>', '- a\n- b'])).toBe('Hi\n\n- a\n- b');
  });
});
