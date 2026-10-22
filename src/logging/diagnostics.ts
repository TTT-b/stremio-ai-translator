import { closeSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { join } from 'node:path';

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
] as const;

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
    if (line.upgrade === 'done') row.upgraded = true;
    if (line.msg === 'job done') {
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
  const timing = r.failed ? '-' : exact ? 'exact' : r.sync === 'fitted' ? 'speech' : 'estimated';
  const sound = r.failed
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
  return [
    r.videoId,
    source,
    timing,
    sound,
    r.durationMs === undefined ? '-' : `${Math.round(r.durationMs / 1000)} s`,
    r.cues === undefined ? '-' : String(r.cues),
    r.parts ?? '-',
  ];
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

/** The ids of the latest videos, in the order of the table (for the creator-only titles). */
export function recentVideoIds(logDir: string, count = 5): string[] {
  return videoRows(readLogLines(logDir))
    .slice(-count)
    .map((r) => r.videoId);
}
