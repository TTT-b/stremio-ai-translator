import { describe, expect, it } from 'vitest';
import { createSyncProgress } from '../src/sync/progress';

describe('createSyncProgress', () => {
  it('moves steadily while a piece is read and never goes back', () => {
    let clock = 0;
    const seen: number[] = [];
    const progress = createSyncProgress(
      (p) => seen.push(p),
      () => clock,
    );
    progress.begin();
    for (let s = 1; s <= 30; s++) {
      clock = s * 1000;
      progress.tick();
    }
    expect(seen.length).toBeGreaterThan(5);
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(Math.max(...seen)).toBeLessThan(50);
  });

  it('stands at 90 when the two planned pieces are done and never shows 100', () => {
    let clock = 0;
    const progress = createSyncProgress(
      () => undefined,
      () => clock,
    );
    for (let piece = 0; piece < 2; piece++) {
      progress.begin();
      clock += 20_000;
      progress.finish();
    }
    expect(progress.percent()).toBe(90);
  });

  it('slows down but does not go back when more pieces are needed', () => {
    let clock = 0;
    const progress = createSyncProgress(
      () => undefined,
      () => clock,
    );
    for (let piece = 0; piece < 2; piece++) {
      progress.begin();
      clock += 20_000;
      progress.finish();
    }
    const before = progress.percent();
    progress.needMore(2);
    progress.begin();
    clock += 10_000;
    progress.tick();
    expect(progress.percent()).toBeGreaterThanOrEqual(before);
    expect(progress.percent()).toBeLessThanOrEqual(97);
  });

  it('marks a move caused only by time as estimated, and a finished piece as real', () => {
    let clock = 0;
    const calls: boolean[] = [];
    const progress = createSyncProgress(
      (_p, estimated) => calls.push(estimated),
      () => clock,
    );
    progress.begin();
    clock = 5000;
    progress.tick();
    clock = 9000;
    progress.finish();
    expect(calls[0]).toBe(true);
    expect(calls[calls.length - 1]).toBe(false);
  });
});
