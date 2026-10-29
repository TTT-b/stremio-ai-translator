import { describe, expect, it } from 'vitest';
import { etaValue, formatEta, TRAY_LABELS } from '../src/electron/trayMenu';

describe('time left in the tray menu', () => {
  it('says seconds under a minute and minutes:seconds above it', () => {
    expect(formatEta(40, 'he')).toBe('כ-40 שנ׳');
    expect(formatEta(130, 'he')).toBe('כ-2:10 דק׳');
    expect(formatEta(40, 'en')).toBe('about 40 s');
    expect(formatEta(65, 'en')).toBe('about 1:05 min');
  });

  it('shows nothing when there is no status or nothing is running', () => {
    expect(etaValue(null, 'he')).toBeNull();
    expect(etaValue({ running: 0, paused: false, totalEtaSec: 90 }, 'he')).toBeNull();
  });

  it('says it is estimating while the time is not known yet', () => {
    expect(etaValue({ running: 1, paused: false, totalEtaSec: null }, 'en')).toBe(
      TRAY_LABELS.en.estimating,
    );
  });

  it('says paused instead of a time while paused', () => {
    expect(etaValue({ running: 1, paused: true, totalEtaSec: 90 }, 'he')).toBe(
      TRAY_LABELS.he.paused,
    );
  });

  it('shows the time while translating', () => {
    expect(etaValue({ running: 1, paused: false, totalEtaSec: 130 }, 'he')).toBe('כ-2:10 דק׳');
  });
});
