import { describe, expect, it } from 'vitest';
import { alignCues, cueWords, matchWords, normalizeWord, type SpokenWord } from '../src/sync/align';
import type { Cue } from '../src/subtitles/types';

/** Deterministic pseudo-random numbers. */
const rng = (seed: number) => () =>
  (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;

// Random letter strings: unlike numbered words they are not "almost equal" to each other.
const VOCAB = (() => {
  const r = rng(2024);
  return Array.from({ length: 600 }, () =>
    Array.from({ length: 5 + Math.floor(r() * 4) }, () =>
      String.fromCharCode(97 + Math.floor(r() * 26)),
    ).join(''),
  );
})();

interface Scene {
  spoken: SpokenWord[];
  /** Cues with the true timing, and the words each cue says. */
  truth: Cue[];
}

/** A made-up film: cues of 4-9 words, each word 0.3 s, pauses between cues. */
function scene(seed: number, cues = 120): Scene {
  const r = rng(seed);
  const spoken: SpokenWord[] = [];
  const truth: Cue[] = [];
  let t = 3;
  for (let c = 0; c < cues; c++) {
    const n = 4 + Math.floor(r() * 6);
    const words: string[] = [];
    const startSec = t;
    for (let k = 0; k < n; k++) {
      const w = VOCAB[Math.floor(r() * VOCAB.length)] as string;
      words.push(w);
      spoken.push({ w, start: t, end: t + 0.3 });
      t += 0.3;
    }
    truth.push({
      index: c + 1,
      startMs: Math.round(startSec * 1000),
      endMs: Math.round(t * 1000),
      text: words.join(' '),
    });
    t += 0.4 + r() * 3;
  }
  return { spoken, truth };
}

const shiftCues = (cues: Cue[], f: (c: Cue, i: number) => number): Cue[] =>
  cues.map((c, i) => ({ ...c, startMs: c.startMs + f(c, i), endMs: c.endMs + f(c, i) }));

const worst = (a: Cue[], b: Cue[], pct = 0.95) => {
  const d = a.map((c, i) => Math.abs(c.startMs - (b[i] as Cue).startMs)).sort((x, y) => x - y);
  return d[Math.min(d.length - 1, Math.floor(d.length * pct))] as number;
};

describe('word helpers', () => {
  it('normalises words and extracts only the spoken ones from a cue', () => {
    expect(normalizeWord("It's, OK!")).toBe('itsok');
    expect(
      cueWords('KATARA: Hello, there.\n<i>Sokka!</i> [grunting] \u266a la la \u266a (laughs)'),
    ).toEqual(['hello', 'there', 'sokka', 'la', 'la']);
  });

  it('matches words in order even when some are missing or different', () => {
    const a = 'the quick brown fox jumps over the lazy dog again and again'.split(' ');
    const b = 'the quick fox jumps over a lazy dog again again'.split(' ');
    const m = matchWords(a, b);
    expect(m.get(0)).toBe(0);
    expect(m.get(3)).toBe(2);
    expect(m.get(7)).toBe(6);
    expect(
      [...m.keys()].every(
        (k, i, all) => i === 0 || (m.get(all[i - 1] as number) as number) < (m.get(k) as number),
      ),
    ).toBe(true);
  });
});

describe('alignCues', () => {
  it('keeps a line said in half a second on screen for at least one second', () => {
    const s = scene(31, 60);
    // The first cue becomes one word that is spoken in 0.45 s (like "Water." in a narration).
    const word = s.spoken[0] as SpokenWord;
    word.end = word.start + 0.45;
    const cues = s.truth.map((c) => ({ ...c }));
    const first = cues[0] as Cue;
    first.text = word.w;
    first.endMs = first.startMs + 450;
    s.spoken.splice(1, 3); // the cue's other words are gone, only the one word is left
    const out = alignCues(cues, s.spoken, { leadSec: 0 })!;
    const len = out.cues[0]!.endMs - out.cues[0]!.startMs;
    expect(len).toBeGreaterThanOrEqual(1000);
    // and it still never runs into the next line
    expect(out.cues[0]!.endMs).toBeLessThanOrEqual(out.cues[1]!.startMs - 20);
  });

  it('moves a subtitle that is a constant 2.3 s late back onto the speech', () => {
    const s = scene(1);
    const wrong = shiftCues(s.truth, () => 2300);
    const r = alignCues(wrong, s.spoken, { leadSec: 0 });
    expect(r).toBeDefined();
    expect(r!.matchedRatio).toBeGreaterThan(0.95);
    expect(worst(r!.cues, s.truth, 1)).toBeLessThanOrEqual(1);
  });

  it('fixes a subtitle whose error changes during the film (2 s, then 1 s, then 2 s, then 0)', () => {
    const s = scene(2, 200);
    const n = s.truth.length;
    const wrong = shiftCues(s.truth, (_c, i) =>
      i < n * 0.25 ? 2000 : i < n * 0.5 ? 1000 : i < n * 0.75 ? 2000 : 0,
    );
    const r = alignCues(wrong, s.spoken, { leadSec: 0 });
    expect(r!.matchedRatio).toBeGreaterThan(0.95);
    expect(worst(r!.cues, s.truth)).toBeLessThanOrEqual(1);
  });

  it('copes with a recogniser that misses 20% of the words and gets 5% wrong', () => {
    const s = scene(3, 200);
    const r = rng(99);
    const noisy = s.spoken
      .filter(() => r() > 0.2)
      .map((w) => (r() < 0.05 ? { ...w, w: 'zzz' + Math.floor(r() * 1000) } : w));
    const wrong = shiftCues(s.truth, (_c, i) => 3000 - (i % 7) * 100);
    const out = alignCues(wrong, noisy, { leadSec: 0 });
    expect(out).toBeDefined();
    expect(out!.matchedRatio).toBeGreaterThan(0.6);
    expect(worst(out!.cues, s.truth, 0.9)).toBeLessThanOrEqual(900);
  });

  it('applies the lead and keeps text, order and count', () => {
    const s = scene(4, 60);
    const out = alignCues(s.truth, s.spoken, { leadSec: 0.25 })!;
    expect(out.cues).toHaveLength(s.truth.length);
    out.cues.forEach((c, i) => {
      expect(c.text).toBe(s.truth[i]!.text);
      expect(c.index).toBe(s.truth[i]!.index);
      expect(c.startMs).toBeGreaterThanOrEqual(0);
      expect(c.endMs).toBeGreaterThan(c.startMs);
      if (i > 0) expect(c.startMs).toBeGreaterThanOrEqual(out.cues[i - 1]!.startMs);
    });
    // every cue starts 0.25 s before its first word
    expect(Math.abs(out.cues[10]!.startMs - (s.truth[10]!.startMs - 250))).toBeLessThanOrEqual(5);
  });

  it('places a cue with no recognised word between its neighbours', () => {
    const s = scene(5, 80);
    const wrong = shiftCues(s.truth, () => 1500);
    wrong[40] = { ...wrong[40]!, text: 'qqq www eee rrr ttt' }; // text the speech never says
    const out = alignCues(wrong, s.spoken, { leadSec: 0 })!;
    expect(Math.abs(out.cues[40]!.startMs - s.truth[40]!.startMs)).toBeLessThanOrEqual(1500);
    expect(out.cues[40]!.startMs).toBeGreaterThan(out.cues[39]!.startMs);
    expect(out.cues[40]!.startMs).toBeLessThan(out.cues[41]!.startMs);
  });

  it('refuses a subtitle that is not the text of this video', () => {
    const s = scene(6);
    const other = scene(7); // different words
    expect(alignCues(other.truth, s.spoken, { leadSec: 0 })).toBeUndefined();
    expect(alignCues(s.truth.slice(0, 2), s.spoken, { leadSec: 0 })).toBeUndefined(); // too little text
  });
});
