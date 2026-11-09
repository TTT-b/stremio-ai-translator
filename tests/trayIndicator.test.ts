import { describe, expect, it } from 'vitest';
import { trayIndicator, READY_DOT_MS, type TrayStatus } from '../src/electron/trayMenu';
import { withDot, DOT_RGB } from '../src/electron/trayDot';

const idle: TrayStatus = {
  running: 0,
  paused: false,
  totalEtaSec: null,
  state: 'idle',
  percent: null,
  title: null,
  season: null,
  episode: null,
  readyAt: null,
  lastError: null,
};
const NOW = 1_000_000;

describe('trayIndicator', () => {
  it('is gray and calm when nothing happens or the app does not answer', () => {
    expect(trayIndicator(idle, 'he', NOW).dot).toBe('gray');
    expect(trayIndicator(null, 'he', NOW).dot).toBe('gray');
  });

  it('is yellow with the episode and percent while translating', () => {
    const s = { ...idle, state: 'translating', running: 1, percent: 62, season: 1, episode: 5 };
    const ind = trayIndicator(s, 'he', NOW);
    expect(ind.dot).toBe('yellow');
    expect(ind.tooltip).toContain('פרק 5');
    expect(ind.tooltip).toContain('62%');
    expect(ind.menuLine).toBe('מתרגם: פרק 5 (62%)');
  });

  it('is green for a minute after a subtitle is ready, then gray again', () => {
    const fresh = { ...idle, readyAt: NOW - 1000 };
    expect(trayIndicator(fresh, 'en', NOW).dot).toBe('green');
    const old = { ...idle, readyAt: NOW - READY_DOT_MS - 1 };
    expect(trayIndicator(old, 'en', NOW).dot).toBe('gray');
  });

  it('is red on an error or a usage limit', () => {
    expect(trayIndicator({ ...idle, state: 'error', lastError: 'X' }, 'en', NOW).dot).toBe('red');
    expect(trayIndicator({ ...idle, state: 'ratelimited' }, 'en', NOW).dot).toBe('red');
  });

  it('says paused while paused with work waiting', () => {
    const ind = trayIndicator(
      { ...idle, running: 1, paused: true, state: 'translating' },
      'en',
      NOW,
    );
    expect(ind.tooltip).toContain('paused');
  });
});

describe('withDot', () => {
  it('paints the bottom-right corner and leaves the top-left alone', () => {
    const size = 32;
    const src = new Uint8Array(size * size * 4).fill(7);
    const out = withDot(src, size, 'green');
    const corner = ((size - 6) * size + (size - 6)) * 4;
    const [r, g, b] = DOT_RGB.green;
    expect([out[corner], out[corner + 1], out[corner + 2], out[corner + 3]]).toEqual([
      b,
      g,
      r,
      255,
    ]);
    expect(out[0]).toBe(7);
    expect(src[corner]).toBe(7);
  });
});
