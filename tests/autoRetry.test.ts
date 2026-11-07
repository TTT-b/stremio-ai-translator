import { describe, expect, it } from 'vitest';
import {
  autoRetryDelayMs,
  nextPacificMidnight,
  RESET_MARGIN_MS,
  TRANSIENT_BACKOFF_MS,
} from '../src/jobs/autoRetry';

const HOUR = 3600_000;

describe('nextPacificMidnight', () => {
  it('is the coming midnight in Los Angeles (winter: 08:00 UTC)', () => {
    const now = Date.UTC(2026, 0, 15, 10, 0, 0); // 02:00 in Los Angeles
    expect(nextPacificMidnight(now)).toBe(Date.UTC(2026, 0, 16, 8, 0, 0));
  });

  it('is the coming midnight in Los Angeles (summer: 07:00 UTC)', () => {
    const now = Date.UTC(2026, 6, 15, 20, 30, 0); // 13:30 in Los Angeles
    expect(nextPacificMidnight(now)).toBe(Date.UTC(2026, 6, 16, 7, 0, 0));
  });

  it('is always within a day ahead', () => {
    const now = Date.UTC(2026, 5, 1, 7, 0, 0); // exactly midnight in Los Angeles
    const next = nextPacificMidnight(now);
    expect(next - now).toBe(24 * HOUR);
  });
});

describe('autoRetryDelayMs', () => {
  const now = Date.UTC(2026, 0, 15, 10, 0, 0);

  it('waits for the reset after a daily limit', () => {
    expect(autoRetryDelayMs('PROVIDER_QUOTA_EXCEEDED', 'day', 0, now)).toBe(
      Date.UTC(2026, 0, 16, 8, 0, 0) + RESET_MARGIN_MS - now,
    );
  });

  it('does not retry a quota that is not a daily one (empty credits)', () => {
    expect(autoRetryDelayMs('PROVIDER_QUOTA_EXCEEDED', undefined, 0, now)).toBeNull();
  });

  it('backs off for a busy AI and gives up after the last try', () => {
    expect(autoRetryDelayMs('PROVIDER_RATE_LIMITED', undefined, 0, now)).toBe(
      TRANSIENT_BACKOFF_MS[0],
    );
    expect(autoRetryDelayMs('PROVIDER_TIMEOUT', undefined, 2, now)).toBe(TRANSIENT_BACKOFF_MS[2]);
    expect(autoRetryDelayMs('PROVIDER_TIMEOUT', undefined, 3, now)).toBeNull();
  });

  it('never retries errors that waiting cannot fix', () => {
    expect(autoRetryDelayMs('INVALID_API_KEY', undefined, 0, now)).toBeNull();
    expect(autoRetryDelayMs('PROVIDER_MODEL_UNAVAILABLE', undefined, 0, now)).toBeNull();
  });
});
