/** The translation time estimate needs some work done and some time passed to mean anything. */
const MIN_ELAPSED_MS = 5_000;
const STEP_SEC = 5;

/**
 * Rough seconds left of a translation, from how fast it went so far, rounded to 5 seconds.
 * Null while it is too early to tell or when there is nothing left to do.
 */
export function estimateTranslateSec(
  elapsedMs: number,
  done: number,
  total: number,
): number | null {
  if (done <= 0 || done >= total || elapsedMs < MIN_ELAPSED_MS) return null;
  const left = (elapsedMs * (total - done)) / done / 1000;
  return Math.max(STEP_SEC, Math.round(left / STEP_SEC) * STEP_SEC);
}

/**
 * Adds the time left of the parts that are running. A part that is not running counts 0; a part that
 * is running but cannot be estimated yet makes the whole answer null (better no number than a wrong one).
 */
export function combineEta(translateSec: number | null, syncSec: number | null): number | null {
  if (translateSec === null || syncSec === null) return null;
  const total = translateSec + syncSec;
  return total > 0 ? total : null;
}
