/**
 * When a translation failed for a reason that passes by itself, the app starts it again on its own,
 * so the user only waits. A daily AI limit is waited out until the limit resets (Google resets the
 * free tier at midnight Pacific time); a busy or rate-limited AI is tried again after a growing pause.
 */

/** Pauses before the 1st, 2nd and 3rd automatic try after a busy / rate-limited AI. */
export const TRANSIENT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000] as const;

/** A little after the reset, so the first request does not land just before it. */
export const RESET_MARGIN_MS = 2 * 60_000;

const PACIFIC = 'America/Los_Angeles';

/** The next midnight in Pacific time (when Gemini's daily free quota starts again), as epoch ms. */
export function nextPacificMidnight(nowMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: PACIFIC,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(nowMs));
  const num = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Some engines print midnight as "24".
  const sinceMidnight = ((num('hour') % 24) * 3600 + num('minute') * 60 + num('second')) * 1000;
  return nowMs + 24 * 3600_000 - sinceMidnight;
}

/**
 * How long to wait before trying again, or null when trying again cannot help (a wrong key, a
 * missing model...) or the tries are used up.
 * `tries` is how many automatic tries this request already had.
 */
export function autoRetryDelayMs(
  code: string,
  scope: unknown,
  tries: number,
  nowMs: number,
): number | null {
  if (code === 'PROVIDER_QUOTA_EXCEEDED') {
    // Only a daily limit passes by itself (a depleted prepaid balance does not).
    if (scope !== 'day') return null;
    return nextPacificMidnight(nowMs) + RESET_MARGIN_MS - nowMs;
  }
  if (code === 'PROVIDER_RATE_LIMITED' || code === 'PROVIDER_TIMEOUT') {
    return TRANSIENT_BACKOFF_MS[tries] ?? null;
  }
  return null;
}
