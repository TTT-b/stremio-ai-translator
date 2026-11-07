/**
 * A progress number for the sound/track check that moves steadily and does not lie about the end.
 *
 * The check reads a few pieces of the video, and a piece gives no sign of life until it is done
 * (it is a download through Stremio, 8 to 40 seconds each). Counting only finished pieces made the
 * bar stand at 3, jump to 20 and then to 100. Here a piece that is being read counts as partly done,
 * by how long it has been running compared with how long pieces took so far, and the number never
 * goes back.
 */

/** Where the bar stands once the track was found, before any piece is read. */
const START_PERCENT = 3;
/** Where the bar stands when the planned pieces are done; the answer itself brings it to 100. */
const PLANNED_PERCENT = 90;
/** The most the bar shows when more pieces than planned were needed. */
const EXTENDED_PERCENT = 97;
/** Two pieces are what most checks need; more are added when the answer is not clear. */
const FIRST_PLANNED_PIECES = 2;
/** A piece that has been running longer than usual is at most this much done in the bar. */
const MAX_PARTIAL = 0.9;
/** Before any piece has finished, a piece is guessed to take this long (real checks: 8 to 40 s). */
const GUESS_PIECE_MS = 25_000;
const MIN_PIECE_MS = 3_000;
const MAX_PIECE_MS = 40_000;

export interface SyncProgress {
  /** A piece starts being read. */
  begin(): void;
  /** The piece that was being read is over (answer or not). */
  finish(): void;
  /** The check needs this many more pieces than it planned; the bar slows down, never goes back. */
  needMore(n: number): void;
  /** Time passed: the running piece counts a little more. Call about once a second. */
  tick(): void;
  /** The current number, 0..100. */
  percent(): number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/**
 * `report(percent, estimated)` is called when the number changes; `estimated` is true when it moved
 * only because time passed (nothing arrived from the video), so the caller must not take it as a
 * sign that data is coming.
 */
export function createSyncProgress(
  report: (percent: number, estimated: boolean) => void,
  now: () => number = Date.now,
): SyncProgress {
  let planned = FIRST_PLANNED_PIECES;
  let extended = false;
  let done = 0;
  let startedAt: number | undefined;
  const took: number[] = [];
  let shown = START_PERCENT;

  const typicalMs = (): number =>
    took.length === 0
      ? GUESS_PIECE_MS
      : Math.min(MAX_PIECE_MS, Math.max(MIN_PIECE_MS, median(took)));

  const compute = (): number => {
    const partial =
      startedAt === undefined
        ? 0
        : Math.min(MAX_PARTIAL, 1 - Math.exp(-(now() - startedAt) / typicalMs()));
    const share = Math.min(1, (done + partial) / Math.max(planned, done));
    const cap = extended ? EXTENDED_PERCENT : PLANNED_PERCENT;
    return Math.round(START_PERCENT + (cap - START_PERCENT) * share);
  };

  const emit = (estimated: boolean): void => {
    const next = Math.max(shown, compute());
    // A finished piece is always reported (it is a sign of life), time passing only when it moves the bar.
    if (next === shown && estimated) return;
    shown = next;
    report(next, estimated);
  };

  return {
    begin(): void {
      startedAt = now();
    },
    finish(): void {
      if (startedAt !== undefined) took.push(now() - startedAt);
      startedAt = undefined;
      done++;
      emit(false);
    },
    needMore(n: number): void {
      planned = Math.max(planned, done + n);
      extended = true;
    },
    tick(): void {
      emit(true);
    },
    percent(): number {
      return shown;
    },
  };
}
