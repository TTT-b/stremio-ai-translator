import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { JobStats } from '../jobs/jobStatus';

/** Only these fields of a log line are copied into the diagnostics: numbers and short codes, no text. */
const SAFE_FIELDS = [
  'jobId',
  'videoId',
  'season',
  'episode',
  'embedded',
  'via',
  'language',
  'cues',
  'durationMs',
  'errorCode',
  'reason',
  'strategy',
  'decision',
  'results',
  'compared',
  'state',
  'tracks',
  'files',
  'ffmpeg',
  'triedFiles',
  'triedTracks',
  'waitedMs',
  'httpStatus',
  'hit',
  'removed',
  'sync',
  'offsetMs',
  'scale',
  'upgrade',
  'timing',
  'provider',
  'parts',
  'score',
  'method',
  'cue',
  'ms',
  'lines',
  'fromSec',
  'usable',
  'matched',
  'unsure',
  'attempt',
  'problemCount',
  'from',
  'to',
] as const;

/** The only validation problems that may be shown, each with an optional line number. */
const PROBLEM_KIND =
  /^(missing id|unknown id|duplicate id|empty translation id|markdown fence in id|malformed translation entry)(?: (\d{1,6}))?$/;

/**
 * What failed validation, as kinds and line numbers only. A problem the model made up (for example
 * an unknown id that is really dialogue) is reduced to its kind, so no text reaches the report.
 */
function problemSummary(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const shown = value.slice(0, 5).flatMap((p) => {
    if (typeof p !== 'string') return [];
    const exact = PROBLEM_KIND.exec(p);
    if (exact) return [exact[2] ? `${exact[1]} ${exact[2]}` : String(exact[1])];
    const kind =
      /^(missing id|unknown id|duplicate id|empty translation id|markdown fence in id)/.exec(p);
    return [kind ? String(kind[1]) : 'other'];
  });
  return shown.length > 0 ? `problems=${shown.join('; ')}` : undefined;
}

const STAGES = new Set([
  'SOURCE',
  'DOWNLOAD',
  'PARSER',
  'ASSEMBLY',
  'DELIVERY',
  'CACHE',
  'API',
  'STREMIO',
]);
const TAIL_BYTES = 400 * 1024;

type LogLine = Record<string, unknown>;

/** The parsed lines at the end of the newest log file (a half line at the start is skipped). */
function readLogLines(logDir: string): LogLine[] {
  let file: string | undefined;
  try {
    file = readdirSync(logDir)
      .filter((n) => /^app-.*\.log$/.test(n))
      .map((n) => join(logDir, n))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  } catch {
    return [];
  }
  if (!file) return [];
  let text = '';
  try {
    const size = statSync(file).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    const fd = openSync(file, 'r');
    try {
      readSync(fd, buf, 0, buf.length, start);
    } finally {
      closeSync(fd);
    }
    text = buf.toString('utf8');
  } catch {
    return [];
  }
  const lines: LogLine[] = [];
  for (const raw of text.split('\n')) {
    try {
      lines.push(JSON.parse(raw) as LogLine);
    } catch {
      continue; // a half line at the start of the tail, or noise
    }
  }
  return lines;
}

/**
 * The latest lines of today's log as short text (time, stage, message and a few safe numbers),
 * for the user to send when something does not work. Never contains subtitle text or keys.
 */
export function recentLogLines(
  logDir: string,
  limit = 60,
  scope: 'latest' | 'all' = 'latest',
): string[] {
  const out: { text: string; videoId: string; problem: boolean }[] = [];
  for (const line of readLogLines(logDir)) {
    const stage = typeof line.stage === 'string' ? line.stage : '';
    const level = typeof line.level === 'number' ? line.level : 30;
    if (!STAGES.has(stage) && level < 40) continue;
    const time =
      typeof line.time === 'number' ? new Date(line.time).toISOString().slice(11, 19) : '--:--:--';
    const msg = typeof line.msg === 'string' ? line.msg.slice(0, 80) : '';
    const fields = SAFE_FIELDS.flatMap((k) => {
      const v = line[k];
      return typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
        ? [`${k}=${String(v).slice(0, 40)}`]
        : [];
    });
    const problems = problemSummary(line.problems);
    if (problems) fields.push(problems);
    out.push({
      text: `${time} ${stage || 'LOG'} ${msg} ${fields.join(' ')}`.trimEnd(),
      videoId: typeof line.videoId === 'string' ? line.videoId : '',
      problem: level >= 40,
    });
  }
  // Only the latest video's lines and the warnings, so what is sent is what is being looked at.
  const latest = scope === 'latest' ? out.findLast((o) => o.videoId !== '')?.videoId : undefined;
  const kept = latest === undefined ? out : out.filter((o) => o.videoId === latest || o.problem);
  return kept.slice(-limit).map((o) => o.text);
}

interface VideoRow {
  videoId: string;
  embedded: boolean;
  provider: string;
  hashMatch: boolean;
  translated: boolean;
  sync?: string;
  offsetMs?: number;
  scale?: number;
  parts?: string;
  score?: number;
  method?: string;
  upgraded: boolean;
  /** The late upgrade came from the video's own subtitle (not from the sound check). */
  upgradedByTrack: boolean;
  /** Clock time (UTC, hh:mm:ss) of that upgrade. */
  upgradedAt?: string;
  /** Lines of the first subtitle, when a later one replaced it with another count. */
  firstCues?: number;
  durationMs?: number;
  cues?: number;
  failed?: string;
}

const text = (v: unknown, max = 24): string => (typeof v === 'string' ? v.slice(0, max) : '');
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : undefined);

/** One row per video, from the log lines that carry its id (codes and numbers only). */
function videoRows(lines: LogLine[]): VideoRow[] {
  const rows = new Map<string, VideoRow>();
  for (const line of lines) {
    const base = text(line.videoId);
    if (base === '') continue;
    const season = num(line.season);
    const episode = num(line.episode);
    const id =
      season !== undefined && episode !== undefined ? `${base} S${season}E${episode}` : base;
    const row = rows.get(id) ?? {
      videoId: id,
      embedded: false,
      provider: 'opensubtitles',
      hashMatch: false,
      translated: false,
      upgraded: false,
      upgradedByTrack: false,
    };
    rows.delete(id); // re-inserted below, so the Map stays in "last seen" order
    if (line.embedded === 'used') row.embedded = true;
    if (line.msg === 'subtitle selected') {
      row.provider = text(line.provider) || 'opensubtitles';
      row.hashMatch = line.hashMatch === true;
      row.translated = line.decision === 'translate';
    }
    if (typeof line.sync === 'string' && line.sync !== 'continues-in-background') {
      row.sync = line.sync;
      const offset = num(line.offsetMs);
      const scale = num(line.scale);
      if (offset !== undefined) row.offsetMs = offset;
      if (scale !== undefined) row.scale = scale;
      if (typeof line.method === 'string') row.method = text(line.method, 8);
      if (num(line.score) !== undefined) row.score = num(line.score);
      if (typeof line.parts === 'string') row.parts = text(line.parts, 60);
    }
    if (line.upgrade === 'done') {
      row.upgraded = true;
      const via = text(line.via);
      // "sound" / "sound-now" moved the same lines; anything else is the video's own subtitle.
      if (via !== 'sound' && via !== 'sound-now') {
        row.upgradedByTrack = true;
        if (typeof line.time === 'number') {
          row.upgradedAt = new Date(line.time).toISOString().slice(11, 19);
        }
        const cues = num(line.cues);
        if (cues !== undefined && cues !== row.cues) {
          if (row.cues !== undefined) row.firstCues = row.cues;
          row.cues = cues;
        }
      }
    }
    if (line.msg === 'job done' && !row.upgradedByTrack) {
      const cues = num(line.cues);
      const duration = num(line.durationMs);
      if (cues !== undefined) row.cues = cues;
      if (duration !== undefined) row.durationMs = duration;
    }
    if (line.msg === 'job failed') row.failed = text(line.errorCode, 40) || 'UNKNOWN';
    rows.set(id, row);
  }
  return [...rows.values()];
}

function rowCells(r: VideoRow): string[] {
  const exact = r.embedded || r.hashMatch || r.upgraded;
  const source = r.failed
    ? `failed: ${r.failed}`
    : `${r.embedded ? 'embedded' : r.provider}${r.hashMatch ? ', hash match' : ''}${r.translated ? ' (translated)' : ''}`;
  // A late upgrade from the video's own subtitle: the first version had a guessed timing, the final
  // one is exact. Both are shown, so "exact" next to "unsure" is not a contradiction.
  const timing = r.failed
    ? '-'
    : r.upgradedByTrack && !r.embedded && !r.hashMatch
      ? `estimated -> exact (video subtitle${r.upgradedAt ? ` at ${r.upgradedAt} UTC` : ''})`
      : exact
        ? 'exact'
        : r.sync === 'fitted'
          ? 'speech'
          : 'estimated';
  const soundResult = r.failed
    ? '-'
    : r.sync === 'fitted' && r.offsetMs !== undefined && r.scale !== undefined
      ? `${r.method === 'cues' ? 'cue-match: ' : ''}moved ${(r.offsetMs / 1000).toFixed(1)} s, x${r.scale}${r.score === undefined ? '' : `, score ${r.score}`}`
      : r.sync === 'fit-unsure'
        ? 'unsure'
        : r.sync === 'no-data'
          ? 'no data from video'
          : exact
            ? 'not needed'
            : '-';
  const sound =
    r.upgradedByTrack && r.sync !== undefined && !r.failed
      ? `${soundResult} (first version only)`
      : soundResult;
  const lines =
    r.cues === undefined
      ? '-'
      : r.firstCues === undefined
        ? String(r.cues)
        : `${r.firstCues} -> ${r.cues}`;
  return [
    r.videoId,
    source,
    timing,
    sound,
    r.durationMs === undefined ? '-' : `${Math.round(r.durationMs / 1000)} s`,
    lines,
    r.parts ?? '-',
  ];
}

const ageText = (ms: number): string =>
  ms < 60_000 ? `${Math.round(ms / 1000)} s ago` : `${Math.round(ms / 60_000)} min ago`;

const episodeText = (season?: number, episode?: number): string =>
  season !== undefined && episode !== undefined ? ` S${season}E${episode}` : '';

/**
 * The live state of the app as short readable lines (instead of one JSON line). No titles of what
 * the user watches, only numbers and codes.
 */
export function describeStats(s: JobStats, now: number): string[] {
  const out = [
    `state: ${s.state}${s.paused ? ' (paused)' : ''}, running: ${s.running}, waiting in queue: ${s.queue.length}${s.stage ? `, stage: ${s.stage}` : ''}`,
    `this session: ${s.linesTranslated} lines (${s.bytesTranslated} bytes) translated, SubDL downloads: ${s.subdlDownloads}`,
    `OpenSubtitles downloads left today: ${s.quota ? `${s.quota.left} of ${s.quota.limit}` : 'not known'}`,
  ];
  if (s.progress) {
    out.push(`progress: ${s.progress.done}/${s.progress.total} lines (${s.progress.percent}%)`);
  }
  if (s.lastError) out.push(`last error: ${s.lastError}`);
  if (s.modelSwitch) out.push(`AI model switched: ${s.modelSwitch.from} -> ${s.modelSwitch.to}`);
  const d = s.lastDelivered;
  out.push(
    d
      ? `last subtitle Stremio took:${episodeText(d.season, d.episode)}, ${ageText(now - d.at)}, ${d.via}${d.source ? ` from ${d.source}` : ''}, timing ${d.timing ?? 'unknown'}`
      : 'last subtitle Stremio took: none (in the last half hour)',
  );
  const u = s.upgrade;
  out.push(
    u
      ? `better subtitle ready since ${ageText(now - u.at)}:${episodeText(u.season, u.episode)} (Stremio shows it only after the subtitle is selected again)`
      : 'better subtitle waiting for a new selection: no',
  );
  const l = s.lastSync;
  out.push(
    l
      ? `last background sound check:${episodeText(l.season, l.episode)}, ${l.outcome}${l.offsetMs !== undefined ? ` ${(l.offsetMs / 1000).toFixed(1)} s` : ''}, ${ageText(now - l.at)} (it checks the subtitle that was delivered then, not a later upgrade)`
      : 'last background sound check: none (in the last half hour)',
  );
  if (s.backgroundSync) out.push(`sound check running: ${s.backgroundSync.percent}%`);
  if (s.exactComing) out.push('the video’s own subtitle is still being read');
  if (s.autoRetryInSec !== null) out.push(`automatic retry in ${s.autoRetryInSec} s`);
  return out;
}

/**
 * A table of the latest videos (newest last): where each subtitle came from, how sure its timing is
 * and what the sound check did. Only codes and numbers from the log; the numbers in the first column
 * are for the user to refer to ("#3 is 2 seconds early").
 */
export function videoTable(logDir: string, count = 5): string[] {
  const rows = videoRows(readLogLines(logDir)).slice(-count);
  if (rows.length === 0) return ['videos: none yet'];
  const header = ['video', 'source', 'timing', 'sound check', 'time', 'lines', 'left off by part'];
  const body = rows.map(rowCells);
  const widths = header.map((h, i) => Math.max(h.length, ...body.map((b) => (b[i] ?? '').length)));
  const format = (n: string, cells: string[]) =>
    `${n.padStart(2)}  ${cells.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  ')}`.trimEnd();
  return [
    `videos (last ${count}, newest last):`,
    format('#', header),
    ...body.map((cells, i) => format(String(i + 1), cells)),
  ];
}
