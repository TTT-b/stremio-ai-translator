import { describe, expect, it } from 'vitest';
import { MAX_ZOOM, MIN_ZOOM, zoomFor } from '../src/electron/zoom';

describe('zoomFor', () => {
  it.each([
    ['the default window', 1000, 800],
    ['a small laptop', 1366, 768],
    ['a laptop at 150%', 1280, 720],
    ['a laptop at 125%', 1536, 864],
  ])('%s is hardly changed', (_name, w, h) => {
    const z = zoomFor(w, h);
    expect(z).toBeGreaterThanOrEqual(MIN_ZOOM);
    expect(z).toBeLessThan(1.1);
  });

  it.each([
    ['a 24 inch monitor', 1920, 1080, 1.2],
    ['a 27 inch monitor', 2560, 1440, 1.6],
    ['a 32 inch 4K monitor at 100%', 3840, 2160, 2],
  ])('%s is magnified to about the same layout size', (_name, w, h, expected) => {
    expect(zoomFor(w, h)).toBeCloseTo(expected, 5);
    // The page sees the window divided by the zoom: about the same layout size on every monitor.
    const pageWidth = w / zoomFor(w, h);
    const pageHeight = h / zoomFor(w, h);
    expect(pageWidth).toBeGreaterThanOrEqual(1280);
    expect(pageWidth).toBeLessThanOrEqual(2000);
    expect(pageHeight).toBeGreaterThanOrEqual(850);
    expect(pageHeight).toBeLessThanOrEqual(1100);
  });

  it('a rotated (portrait) monitor uses the tall layout', () => {
    expect(zoomFor(1440, 2560)).toBe(1.85);
    expect(zoomFor(1080, 1920)).toBe(1.35);
  });

  it('never goes outside its limits and ignores nonsense sizes', () => {
    expect(zoomFor(300, 200)).toBe(MIN_ZOOM);
    expect(zoomFor(10_000, 6000)).toBe(MAX_ZOOM);
    expect(zoomFor(0, 0)).toBe(1);
    expect(zoomFor(Number.NaN, 500)).toBe(1);
  });

  it('moves in steps of 5 percent', () => {
    for (const w of [1100, 1333, 1777, 2222]) {
      const z = zoomFor(w, Math.round(w * 0.5625));
      expect(Math.round(z * 20)).toBeCloseTo(z * 20, 9);
    }
  });
});
