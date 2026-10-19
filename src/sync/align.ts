import type { Cue } from '../subtitles/types';

/**
 * Put a subtitle's cues at the moments the words are really spoken. The speech recogniser gives
 * the words with their times; the subtitle gives the right text with unreliable times. The words
 * of both are matched in order, and each cue takes the time of its own words. Only the times of
 * the cues change: their text, order and count stay exactly as they were.
 */
export interface SpokenWord {
  /** Normalised (see normalizeWord). */
  w: string;
  /** Seconds. */
  start: number;
  end: number;
}

export interface AlignOptions {
  /**
   * Seconds a subtitle appears before its first word is spoken. Recognisers place a word a little
   * after a person would put the cue, so the start is moved earlier by this much.
   */
  leadSec: number;
  /** Share of the subtitle's words that must be found in the speech, else it is not this video's text. */
  minMatch?: number;
}

export interface AlignResult {
  cues: Cue[];
  /** Share of the subtitle's words found in the speech, 0..1. */
  matchedRatio: number;
  /** Cues that got their time from their own words (the rest were placed between their neighbours). */
  matchedCues: number;
}

/** Lower case letters and digits only, so "It's" and "its," compare equal. */
export function normalizeWord(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/** The spoken words of a cue: no tags, sound-effect notes, music marks or "NAME:" speaker labels. */
export function cueWords(text: string): string[] {
  return text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{[^}]*\}/g, ' ')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .replace(/[♪♫♬#]/g, ' ')
    .replace(/(^|\n)\s*-?\s*[A-Z][A-Z .'\d]{1,25}:/g, '$1 ')
    .split(/\s+/)
    .map(normalizeWord)
    .filter(Boolean);
}

/** Same word, or one a speech recogniser could plausibly write for the other ("katara" / "kitara"). */
export function similarWords(x: string, y: string): boolean {
  if (x === y) return true;
  const n = Math.min(x.length, y.length);
  if (n < 4 || Math.abs(x.length - y.length) > 1) return false;
  if (x.startsWith(y) || y.startsWith(x)) return true;
  // at most one different, added or missing letter
  let i = 0;
  while (i < n && x[i] === y[i]) i++;
  if (x.length === y.length) return x.slice(i + 1) === y.slice(i + 1);
  const [longer, shorter] = x.length > y.length ? [x, y] : [y, x];
  return longer.slice(i + 1) === shorter.slice(i);
}

const WORD_SEC = 0.28; // typical spoken word length, to place a cue whose first word was not heard
const MAX_GAP_CELLS = 4_000_000;

interface Pair {
  i: number; // index in the subtitle's words
  j: number; // index in the spoken words
}

/** Longest increasing subsequence of pairs by j (pairs are already sorted by i). */
function increasing(pairs: Pair[]): Pair[] {
  const tails: number[] = []; // index into pairs of the smallest tail of each length
  const prev: number[] = new Array<number>(pairs.length).fill(-1);
  for (let p = 0; p < pairs.length; p++) {
    const j = (pairs[p] as Pair).j;
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((pairs[tails[mid] as number] as Pair).j < j) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) prev[p] = tails[lo - 1] as number;
    tails[lo] = p;
  }
  const out: Pair[] = [];
  for (
    let p = tails.length ? (tails[tails.length - 1] as number) : -1;
    p >= 0;
    p = prev[p] as number
  ) {
    out.push(pairs[p] as Pair);
  }
  return out.reverse();
}

/** Anchors: runs of `n` words that occur exactly once in both texts, kept in a consistent order. */
function anchors(a: string[], b: string[], n: number): Pair[] {
  const grams = (s: string[]) => {
    const map = new Map<string, number[]>();
    for (let i = 0; i + n <= s.length; i++) {
      const key = s.slice(i, i + n).join(' ');
      const list = map.get(key);
      if (list) list.push(i);
      else map.set(key, [i]);
    }
    return map;
  };
  const ga = grams(a);
  const gb = grams(b);
  const pairs: Pair[] = [];
  for (const [key, ia] of ga) {
    const ib = gb.get(key);
    if (ia.length === 1 && ib && ib.length === 1)
      pairs.push({ i: ia[0] as number, j: ib[0] as number });
  }
  pairs.sort((x, y) => x.i - y.i);
  return increasing(pairs);
}

/** Exact longest-common-subsequence matching of a[a0..a1) with b[b0..b1), added to `matched` (i -> j). */
function matchGap(
  a: string[],
  b: string[],
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  matched: Map<number, number>,
): void {
  const n = a1 - a0;
  const m = b1 - b0;
  if (n <= 0 || m <= 0 || n * m > MAX_GAP_CELLS) return;
  const dp = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let x = 1; x <= n; x++) {
    for (let y = 1; y <= m; y++) {
      dp[x]![y] = similarWords(a[a0 + x - 1] as string, b[b0 + y - 1] as string)
        ? (dp[x - 1]![y - 1] as number) + 1
        : Math.max(dp[x - 1]![y] as number, dp[x]![y - 1] as number);
    }
  }
  for (let x = n, y = m; x > 0 && y > 0;) {
    if (similarWords(a[a0 + x - 1] as string, b[b0 + y - 1] as string)) {
      matched.set(a0 + x - 1, b0 + y - 1);
      x--;
      y--;
    } else if ((dp[x - 1]![y] as number) >= (dp[x]![y - 1] as number)) x--;
    else y--;
  }
}

/** For every subtitle word, the index of the spoken word it matches (when there is one). */
export function matchWords(a: string[], b: string[]): Map<number, number> {
  const matched = new Map<number, number>();
  let n = 3;
  let found = anchors(a, b, n);
  if (found.length < 5) {
    n = 2;
    found = anchors(a, b, n);
  }
  let ai = 0;
  let bj = 0;
  for (const p of found) {
    matchGap(a, b, ai, p.i, bj, p.j, matched);
    // the anchor itself: its words are equal by construction
    let k = 0;
    while (p.i + k < a.length && p.j + k < b.length && a[p.i + k] === b[p.j + k] && k < n) {
      matched.set(p.i + k, p.j + k);
      k++;
    }
    ai = p.i + Math.max(k, 1);
    bj = p.j + Math.max(k, 1);
  }
  matchGap(a, b, ai, a.length, bj, b.length, matched);
  return matched;
}

/** The shortest a line stays on screen (the videos' own subtitles are almost never shorter). */
const MIN_SHOWN_MS = 1000;

export function alignCues(
  cues: Cue[],
  spoken: SpokenWord[],
  opts: AlignOptions,
): AlignResult | undefined {
  const a: string[] = [];
  const owner: number[] = []; // cue index of each subtitle word
  cues.forEach((c, ci) => {
    for (const w of cueWords(c.text)) {
      a.push(w);
      owner.push(ci);
    }
  });
  if (a.length < 20 || spoken.length < 20) return undefined;
  const b = spoken.map((s) => s.w);
  const matched = matchWords(a, b);
  const matchedRatio = matched.size / a.length;
  if (matchedRatio < (opts.minMatch ?? 0.35)) return undefined;

  // Per cue: the first and last of its words that were heard.
  const first = new Map<number, { k: number; j: number }>();
  const last = new Map<number, { k: number; j: number; after: number }>();
  const counts = new Map<number, number>();
  const seen = new Map<number, number>();
  for (const ci of owner) counts.set(ci, (counts.get(ci) ?? 0) + 1);
  for (let i = 0; i < a.length; i++) {
    const ci = owner[i] as number;
    const k = seen.get(ci) ?? 0;
    seen.set(ci, k + 1);
    const j = matched.get(i);
    if (j === undefined) continue;
    if (!first.has(ci)) first.set(ci, { k, j });
    last.set(ci, { k, j, after: (counts.get(ci) as number) - k - 1 });
  }

  const starts: (number | undefined)[] = new Array<number | undefined>(cues.length).fill(undefined);
  const ends: (number | undefined)[] = new Array<number | undefined>(cues.length).fill(undefined);
  let matchedCues = 0;
  cues.forEach((_c, ci) => {
    const f = first.get(ci);
    const l = last.get(ci);
    if (!f || !l) return;
    matchedCues++;
    const word = spoken[f.j] as SpokenWord;
    starts[ci] = word.start - Math.min(f.k, 6) * WORD_SEC - opts.leadSec;
    ends[ci] = (spoken[l.j] as SpokenWord).end + Math.min(l.after, 6) * WORD_SEC;
  });

  // The error of a subtitle is the same for a stretch of cues. A cue whose shift disagrees with the
  // cues around it was matched on a common word by chance: treat it as not heard.
  const rawShifts: (number | undefined)[] = cues.map((c, ci) =>
    starts[ci] === undefined ? undefined : (starts[ci] as number) * 1000 - c.startMs,
  );
  const order = rawShifts.map((v, i) => (v === undefined ? -1 : i)).filter((i) => i >= 0);
  const median = (v: number[]) => [...v].sort((p, q) => p - q)[Math.floor(v.length / 2)] as number;
  order.forEach((ci, pos) => {
    const around = order
      .slice(Math.max(0, pos - 3), pos + 4)
      .filter((k) => k !== ci)
      .map((k) => rawShifts[k] as number);
    if (around.length >= 3 && Math.abs((rawShifts[ci] as number) - median(around)) > 800) {
      starts[ci] = undefined;
      ends[ci] = undefined;
      matchedCues--;
    }
  });
  // Cues with no word heard keep their own length and move with the shift of the closest cue that was heard.
  const shifts: (number | undefined)[] = cues.map((c, ci) =>
    starts[ci] === undefined ? undefined : (starts[ci] as number) * 1000 - c.startMs,
  );
  const known = shifts.map((s, i) => (s === undefined ? -1 : i)).filter((i) => i >= 0);
  const out: Cue[] = cues.map((c, ci) => {
    let startMs: number;
    let endMs: number;
    if (starts[ci] !== undefined) {
      startMs = Math.round((starts[ci] as number) * 1000);
      endMs = Math.round((ends[ci] as number) * 1000);
      // A word said in half a second must still stay on screen long enough to be read.
      const shown = Math.max(MIN_SHOWN_MS, Math.min(c.endMs - c.startMs, 2500));
      if (endMs < startMs + shown) endMs = startMs + shown;
    } else {
      const before = [...known].reverse().find((k) => k < ci);
      const after = known.find((k) => k > ci);
      let shift = 0;
      if (before !== undefined && after !== undefined) {
        const closer =
          c.startMs - cues[before]!.startMs <= cues[after]!.startMs - c.startMs ? before : after;
        shift = shifts[closer] as number;
      } else if (before !== undefined) shift = shifts[before] as number;
      else if (after !== undefined) shift = shifts[after] as number;
      startMs = Math.round(c.startMs + shift);
      endMs = Math.round(c.endMs + shift);
    }
    return { ...c, startMs: Math.max(0, startMs), endMs: Math.max(startMs + 1, endMs) };
  });

  // Keep the order: a cue never starts before the previous one, and never overlaps the next.
  for (let i = 1; i < out.length; i++) {
    const prev = out[i - 1] as Cue;
    const cur = out[i] as Cue;
    if (cur.startMs < prev.startMs) {
      const len = cur.endMs - cur.startMs;
      cur.startMs = prev.startMs;
      cur.endMs = cur.startMs + len;
    }
  }
  for (let i = 0; i + 1 < out.length; i++) {
    const cur = out[i] as Cue;
    const next = out[i + 1] as Cue;
    if (cur.endMs > next.startMs - 20) cur.endMs = Math.max(cur.startMs + 300, next.startMs - 20);
    if (cur.endMs <= cur.startMs) cur.endMs = cur.startMs + 300;
  }
  return { cues: out, matchedRatio, matchedCues };
}
