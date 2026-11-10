/**
 * Research: measures how exactly the timing code lines a subtitle up with the video.
 * Real subtitle files are read from data/research/ (see fetch notes in docs/research/sync-accuracy.md).
 *
 *   npx tsx scripts/research/sync-bench.ts            (table)
 *   npx tsx scripts/research/sync-bench.ts --json     (one JSON line per case)
 *
 * Two paths of the app are measured:
 *  - "cue":   the subtitle is compared with the subtitle track inside the video (cueFit.ts).
 *  - "sound": the subtitle is compared with when people talk (videoFit.ts). There is no video
 *             here, so the sound is MADE from the reference subtitle plus noise (a simulation).
 * Truth: for a made-up change of a real file, every line's right time is known. For two real
 * releases of the same film, lines with the same unique text are the anchors.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseSubtitle } from '../../src/subtitles/parse';
import type { Cue } from '../../src/subtitles/types';
import { fitSubtitleToEmbeddedCues, type ReadPiece } from '../../src/sync/cueFit';
import { FRAME_MS, applyFit, type TimingFit } from '../../src/sync/fit';
import { fitSubtitleToVideo } from '../../src/sync/videoFit';

const DIR = join('data', 'research');
const asJson = process.argv.includes('--json');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);
/** --path=cue leaves the (slow) sound simulation out. */
const withSound = !process.argv.includes('--path=cue');
/** --case=text runs only the made-up cases whose name holds the text; --log prints each step of the cue check. */
const onlyCase = process.argv.find((a) => a.startsWith('--case='))?.slice(7);
const showLog = process.argv.includes('--log');

function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const load = (name: string): Cue[] =>
  parseSubtitle(readFileSync(join(DIR, name), 'utf8')).cues.filter(
    (c) => !/https?:|www\.|subtitle|synced|release/i.test(c.text),
  );

/** One line of a test subtitle with the time it should end up at. */
interface Truth {
  cue: Cue;
  wantMs: number;
}

const stamp = (ms: number): string => {
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
};
const toSrt = (cues: Cue[]): string =>
  cues.map((c, i) => `${i + 1}\n${stamp(c.startMs)} --> ${stamp(c.endMs)}\n${c.text}\n`).join('\n');

const trackList = Buffer.from(
  JSON.stringify({ streams: [{ index: 3, codec_name: 'subrip', tags: { language: 'eng' } }] }),
);

interface Stats {
  lines: number;
  fit: string;
  pieces: number;
  w100: number;
  w250: number;
  w500: number;
  medianMs: number;
  p95Ms: number;
  maxMs: number;
  /** Share of lines within 0.25 s when the subtitle is left as it is. */
  untouched250?: number;
}

function stats(truth: Truth[], fit: TimingFit | undefined, pieces: number): Stats {
  const moved = fit
    ? applyFit(
        truth.map((t) => t.cue),
        fit,
      )
    : truth.map((t) => t.cue);
  const err = truth
    .map((t, i) => Math.abs((moved[i] as Cue).startMs - t.wantMs))
    .sort((a, b) => a - b);
  const share = (ms: number): number =>
    Math.round((err.filter((e) => e <= ms).length / err.length) * 1000) / 10;
  const q = (p: number): number => err[Math.min(err.length - 1, Math.floor(err.length * p))] ?? 0;
  return {
    lines: err.length,
    fit: !fit
      ? 'none'
      : fit.knots
        ? `knots:${fit.knots.length}`
        : `${fit.scale === 1 ? '' : `x${fit.scale.toFixed(4)} `}${fit.offsetMs}ms`,
    pieces,
    w100: share(100),
    w250: share(250),
    w500: share(500),
    medianMs: q(0.5),
    p95Ms: q(0.95),
    maxMs: err[err.length - 1] ?? 0,
  };
}

async function cuePath(sub: Cue[], ref: Cue[]): Promise<{ fit?: TimingFit; pieces: number }> {
  let pieces = 0;
  const readPiece: ReadPiece = async ({ fromSec, toSec }) => {
    pieces++;
    return toSrt(ref.filter((c) => c.startMs >= fromSec * 1000 && c.startMs < toSec * 1000));
  };
  const fit = await fitSubtitleToEmbeddedCues({
    ffmpeg: 'ffmpeg',
    ffprobe: 'ffprobe',
    url: 'http://127.0.0.1/none',
    language: 'en',
    cues: sub,
    signal: new AbortController().signal,
    exec: async () => trackList,
    readPiece,
    ...(showLog
      ? {
          log: (info: Record<string, unknown>) =>
            process.stdout.write(`      ${JSON.stringify(info)}
`),
        }
      : {}),
  });
  return { ...(fit ? { fit } : {}), pieces };
}

/**
 * A made-up soundtrack for the reference lines: speech starts a little after a line appears and
 * ends before it goes, some lines are never spoken (signs), and music is loud where nobody talks.
 */
function fakeLoudness(ref: Cue[], seed: number): number[] {
  const rand = rng(seed);
  const lengthMs = Math.max(...ref.map((c) => c.endMs)) + 200_000;
  const frames = Math.ceil(lengthMs / FRAME_MS);
  const db = Array.from({ length: frames }, () => -52 + rand() * 8);
  for (let at = 0; at < frames;) {
    const quiet = Math.floor((20 + rand() * 160) * (1000 / FRAME_MS));
    const loud = Math.floor((3 + rand() * 25) * (1000 / FRAME_MS));
    at += quiet;
    for (let i = at; i < Math.min(frames, at + loud); i++) db[i] = -30 + rand() * 10;
    at += loud;
  }
  for (const c of ref) {
    if (rand() < 0.08) continue;
    const from = Math.floor((c.startMs + rand() * 150) / FRAME_MS);
    const to = Math.floor((c.endMs - 150 - rand() * 400) / FRAME_MS);
    for (let i = from; i < Math.min(frames, to); i++) db[i] = -24 + rand() * 10;
  }
  return db;
}

async function soundPath(sub: Cue[], ref: Cue[], seed: number): Promise<{ fit?: TimingFit }> {
  const db = fakeLoudness(ref, seed);
  const fit = await fitSubtitleToVideo({
    ffmpeg: 'ffmpeg',
    url: 'http://127.0.0.1/none',
    cues: sub,
    signal: new AbortController().signal,
    detect: async (_f, _u, _s, _p, window) => {
      const from = Math.round(((window?.startSec ?? 0) * 1000) / FRAME_MS);
      const count = Math.round(((window?.durationSec ?? 0) * 1000) / FRAME_MS);
      const loudness = db.slice(from, from + count);
      return { loudness, speech: new Uint8Array(loudness.length), seconds: count / 20 };
    },
  });
  return fit ? { fit } : {};
}

type Change = (ref: Cue[], rand: () => number) => Truth[];

/** sub time = scale * real time + offset(real time); the truth is the real time. */
const warp =
  (scale: number, offsetOf: (share: number) => number): Change =>
  (ref) => {
    const end = Math.max(...ref.map((c) => c.endMs));
    return ref.map((c) => {
      const off = offsetOf(c.startMs / end);
      return {
        cue: {
          ...c,
          startMs: Math.max(0, Math.round(c.startMs * scale + off)),
          endMs: Math.max(1, Math.round(c.endMs * scale + off)),
        },
        wantMs: c.startMs,
      };
    });
  };

const then =
  (first: Change, next: (t: Truth[], rand: () => number) => Truth[]): Change =>
  (ref, rand) =>
    next(first(ref, rand), rand);

const drop = (share: number) => (t: Truth[], rand: () => number) => t.filter(() => rand() >= share);
const jitter = (ms: number) => (t: Truth[], rand: () => number) =>
  t.map((x) => {
    const d = Math.round((rand() * 2 - 1) * ms);
    return { ...x, cue: { ...x.cue, startMs: x.cue.startMs + d, endMs: x.cue.endMs + d } };
  });
const otherWords = (t: Truth[], rand: () => number): Truth[] =>
  t.map((x) => ({
    ...x,
    cue: {
      ...x.cue,
      text: x.cue.text.replace(/\p{L}/gu, () =>
        String.fromCharCode(0x5d0 + Math.floor(rand() * 22)),
      ),
    },
  }));

const CHANGES: [string, Change][] = [
  ['same file, no change', warp(1, () => 0)],
  ['shift -45 s', warp(1, () => -45_000)],
  ['shift -7.3 s', warp(1, () => -7300)],
  ['shift -1.2 s', warp(1, () => -1200)],
  ['shift -0.4 s', warp(1, () => -400)],
  ['shift +0.4 s', warp(1, () => 400)],
  ['shift +2.5 s', warp(1, () => 2500)],
  ['shift +30 s', warp(1, () => 30_000)],
  ['shift +95 s', warp(1, () => 95_000)],
  ['25 fps subtitle on 23.976 video', warp(23.976 / 25, () => 1500)],
  ['23.976 fps subtitle on 25 video', warp(25 / 23.976, () => 1500)],
  ['24 fps subtitle on 23.976 video', warp(23.976 / 24, () => -800)],
  ['one jump +6 s at 8% (a recap at the start)', warp(1, (s) => (s < 0.08 ? 0 : 6000))],
  ['one jump +6 s at 15%', warp(1, (s) => (s < 0.15 ? 0 : 6000))],
  ['one jump -9 s at 90%', warp(1, (s) => (s < 0.9 ? 500 : -8500))],
  ['a speed no frame rate explains (x1.02)', warp(1.02, () => 1000)],
  ['one jump +8 s at 40%', warp(1, (s) => (s < 0.4 ? 1000 : 9000))],
  ['one jump -20 s at 62%', warp(1, (s) => (s < 0.62 ? 0 : -20_000))],
  [
    'two jumps (+5 s at 30%, +12 s at 70%)',
    warp(1, (s) => (s < 0.3 ? 0 : s < 0.7 ? 5000 : 17_000)),
  ],
  [
    'shift +3 s, 25% of lines missing',
    then(
      warp(1, () => 3000),
      drop(0.25),
    ),
  ],
  [
    'shift +3 s, other language',
    then(
      warp(1, () => 3000),
      otherWords,
    ),
  ],
  [
    'shift +3 s, starts off by up to 0.2 s',
    then(
      warp(1, () => 3000),
      jitter(200),
    ),
  ],
  [
    '25 fps, 25% missing, other language, 0.2 s noise',
    then(
      then(
        then(
          warp(23.976 / 25, () => 2000),
          drop(0.25),
        ),
        otherWords,
      ),
      jitter(200),
    ),
  ],
];

const norm = (s: string): string =>
  s
    .replace(/<[^>]*>|\{[^}]*\}|\[[^\]]*\]|\([^)]*\)/g, ' ')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** Lines of `sub` whose text appears exactly once in both files: the same spoken line. */
function anchors(sub: Cue[], ref: Cue[]): Truth[] {
  const count = (cues: Cue[]): Map<string, Cue[]> => {
    const m = new Map<string, Cue[]>();
    for (const c of cues) {
      const k = norm(c.text);
      if (k.length >= 12) m.set(k, [...(m.get(k) ?? []), c]);
    }
    return m;
  };
  const a = count(sub);
  const b = count(ref);
  const out: Truth[] = [];
  for (const [k, list] of a) {
    const other = b.get(k);
    if (list.length === 1 && other?.length === 1) {
      out.push({ cue: list[0] as Cue, wantMs: (other[0] as Cue).startMs });
    }
  }
  return out.sort((p, q) => p.cue.startMs - q.cue.startMs);
}

/** The best any fit could do on real anchors: each anchor against the middle of its 21 neighbours. */
function floorOf(truth: Truth[]): Stats {
  const diff = truth.map((t) => t.wantMs - t.cue.startMs);
  const local = diff.map((_, i) => {
    const near = diff.slice(Math.max(0, i - 10), i + 11).sort((p, q) => p - q);
    return near[Math.floor(near.length / 2)] as number;
  });
  return stats(
    truth.map((t, i) => ({
      cue: { ...t.cue, startMs: t.cue.startMs + (local[i] as number) },
      wantMs: t.wantMs,
    })),
    undefined,
    0,
  );
}

const rows: Record<string, unknown>[] = [];
function report(group: string, name: string, path: string, s: Stats): void {
  rows.push({ group, name, path, ...s });
  if (asJson) {
    process.stdout.write(`${JSON.stringify(rows[rows.length - 1])}\n`);
    return;
  }
  process.stdout.write(
    `${path.padEnd(6)}${`${group} | ${name}`.padEnd(64)}${String(s.lines).padStart(5)} ${s.fit.padEnd(16)} p${s.pieces} ` +
      `${String(s.w100).padStart(5)} ${String(s.w250).padStart(5)} ${String(s.w500).padStart(5)} ` +
      `med ${String(s.medianMs).padStart(5)} p95 ${String(s.p95Ms).padStart(6)} max ${String(s.maxMs).padStart(6)}\n`,
  );
}

async function main(): Promise<void> {
  const files = readdirSync(DIR).filter((f) => f.endsWith('.srt'));
  const bases = ['bb-reward.srt', 'inc-chd.srt', 'mx-silu.srt'].filter((f) => files.includes(f));
  if (!asJson) {
    process.stdout.write(
      'path  case                                                            lines fit              pcs  <=0.1 <=0.25 <=0.5 (share of lines, %), error in ms\n',
    );
  }
  if (!only || only === 'made') {
    for (const base of bases) {
      const ref = load(base);
      for (const [i, [name, change]] of CHANGES.entries()) {
        if (onlyCase && !name.includes(onlyCase)) continue;
        const truth = change(ref, rng(100 + i));
        const sub = truth.map((t) => t.cue);
        const cue = await cuePath(sub, ref);
        const untouched250 = stats(truth, undefined, 0).w250;
        report(base, name, 'cue', { ...stats(truth, cue.fit, cue.pieces), untouched250 });
        if (!withSound) continue;
        const sound = await soundPath(sub, ref, 7 + i);
        report(base, name, 'sound', stats(truth, sound.fit, 0));
      }
    }
  }
  if (!only || only === 'wrong') {
    const names = bases.length >= 2 ? bases : [];
    for (const subName of names) {
      for (const refName of names) {
        if (subName === refName) continue;
        const sub = load(subName);
        const cue = await cuePath(sub, load(refName));
        // Nothing is right here: any fit at all is a wrong move.
        const truth = sub.map((c) => ({ cue: c, wantMs: c.startMs }));
        report('wrong film', `${subName} on video of ${refName}`, 'cue', {
          ...stats(truth, cue.fit, cue.pieces),
          untouched250: 100,
        });
      }
    }
  }
  if (!only || only === 'real') {
    const groups = new Map<string, string[]>();
    for (const f of files) {
      const g = f.split('-')[0] as string;
      groups.set(g, [...(groups.get(g) ?? []), f]);
    }
    for (const [, list] of groups) {
      for (const refName of list) {
        for (const subName of list) {
          if (refName === subName) continue;
          const ref = load(refName);
          const sub = load(subName);
          const truth = anchors(sub, ref);
          if (truth.length < 100) continue;
          const name = `${subName} on video of ${refName}`;
          report('real', name, 'before', stats(truth, undefined, 0));
          report('real', name, 'floor', floorOf(truth));
          const cue = await cuePath(sub, ref);
          report('real', name, 'cue', {
            ...stats(truth, cue.fit, cue.pieces),
            untouched250: stats(truth, undefined, 0).w250,
          });
          if (!withSound) continue;
          const sound = await soundPath(sub, ref, 3);
          report('real', name, 'sound', stats(truth, sound.fit, 0));
        }
      }
    }
  }
  if (!asJson) {
    for (const path of ['cue', 'sound']) {
      const mine = rows.filter((r) => r['path'] === path) as unknown as Stats[];
      const lines = mine.reduce((n, r) => n + r.lines, 0);
      const avg = (k: 'w100' | 'w250' | 'w500'): string =>
        (mine.reduce((n, r) => n + r[k] * r.lines, 0) / lines).toFixed(1);
      const exact = mine.filter((r) => r.w250 >= 99).length;
      const worse = (
        rows as unknown as (Stats & { group: string; name: string; path: string })[]
      ).filter(
        (r) => r.path === path && r.untouched250 !== undefined && r.w250 < r.untouched250 - 0.5,
      );
      for (const r of worse) {
        process.stdout.write(
          `WORSE than untouched: ${r.group} | ${r.name}: ${r.w250}% after, ${r.untouched250}% untouched\n`,
        );
      }
      process.stdout.write(
        `\n${path}: ${mine.length} cases, ${lines} lines; within 0.1 s ${avg('w100')}%, 0.25 s ${avg('w250')}%, 0.5 s ${avg('w500')}%; cases with >=99% of lines within 0.25 s: ${exact}/${mine.length}\n`,
      );
    }
  }
}

main().catch((err: unknown) => {
  process.stderr.write(
    `failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
  );
  process.exitCode = 1;
});
