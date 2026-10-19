import { describe, expect, it } from 'vitest';
import { frameDb, speechFromLoudness } from '../src/sync/speech';

/** Loudness track: quiet hiss with talking bursts at the given frame ranges. */
function track(frames: number, bursts: [number, number][], quiet = -55, loud = -22): number[] {
  const db = Array.from({ length: frames }, (_, i) => quiet + ((i * 7) % 5)); // small ripple
  for (const [a, b] of bursts) for (let i = a; i < b; i++) db[i] = loud + ((i * 3) % 6);
  return db;
}

describe('speechFromLoudness', () => {
  it('marks the loud bursts and nothing else', () => {
    const out = speechFromLoudness(
      track(2000, [
        [200, 260],
        [800, 900],
      ]),
    );
    expect(out.slice(200, 260).every((v) => v === 1)).toBe(true);
    expect(out.slice(800, 900).every((v) => v === 1)).toBe(true);
    expect(out.slice(0, 190).some((v) => v === 1)).toBe(false);
    expect(out.slice(300, 790).some((v) => v === 1)).toBe(false);
  });

  it('joins a short pause inside a sentence', () => {
    const out = speechFromLoudness(
      track(2000, [
        [200, 240],
        [243, 280],
        [1000, 1100],
      ]),
    );
    expect(out.slice(200, 280).every((v) => v === 1)).toBe(true);
  });

  it('drops a very short click', () => {
    const out = speechFromLoudness(
      track(2000, [
        [500, 502],
        [1000, 1100],
      ]),
    );
    expect(out.slice(495, 510).some((v) => v === 1)).toBe(false);
  });

  it('works for a quiet film too', () => {
    const out = speechFromLoudness(track(2000, [[300, 400]], -75, -45));
    expect(out.slice(300, 400).every((v) => v === 1)).toBe(true);
    expect(out.slice(0, 290).some((v) => v === 1)).toBe(false);
  });

  it('finds nothing in flat sound or too little sound', () => {
    expect(speechFromLoudness(Array(2000).fill(-40)).some((v) => v === 1)).toBe(false);
    expect(speechFromLoudness(track(100, [[10, 50]])).some((v) => v === 1)).toBe(false);
  });
});

describe('frameDb', () => {
  it('is 0 dB at full scale and very low at silence', () => {
    const full = new Int16Array(400).fill(32767);
    expect(frameDb(full, 0, 400)).toBeGreaterThan(-0.1);
    expect(frameDb(new Int16Array(400), 0, 400)).toBeLessThan(-100);
  });
});
