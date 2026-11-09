/** Helpers for the "try another subtitle" button. */

/** A move of the timing bigger than this (ms) means the file is from another version of the video. */
export const OFFER_MIN_OFFSET_MS = 2000;

interface Keyed {
  provider?: string | undefined;
  fileId: string | number;
}

/** A stable name for one subtitle file: its source and its id there. */
export function candidateKey(c: Keyed): string {
  return `${c.provider ?? 'opensubtitles'}:${c.fileId}`;
}

/**
 * The candidates minus the files the user already tried. When that would leave nothing, all of
 * them are kept: the same subtitle again is better than no subtitle.
 */
export function withoutTried<T extends Keyed>(
  candidates: readonly T[],
  tried: readonly string[] | undefined,
): T[] {
  if (!tried || tried.length === 0) return [...candidates];
  const skip = new Set(tried);
  const rest = candidates.filter((c) => !skip.has(candidateKey(c)));
  return rest.length > 0 ? rest : [...candidates];
}

/** Whether the main screen should show the button, from how the sound check of that video ended. */
export function offerTryAnother(
  sync: { outcome: 'moved' | 'kept' | 'inSync' | 'unavailable'; offsetMs?: number } | null,
): boolean {
  if (!sync) return false;
  if (sync.outcome === 'moved') return Math.abs(sync.offsetMs ?? 0) > OFFER_MIN_OFFSET_MS;
  return sync.outcome === 'kept' || sync.outcome === 'unavailable';
}
