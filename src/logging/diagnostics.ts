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

/**
 * The latest lines of today's log as short text (time, stage, message and a few safe numbers),
 * for the user to send when something does not work. Never contains subtitle text or keys.
 */
export function recentLogLines(logDir: string, limit = 60): string[] {
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
  const out: string[] = [];
  for (const raw of text.split('\n')) {
    let line: Record<string, unknown>;
    try {
      line = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue; // a half line at the start of the tail, or noise
    }
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
    out.push(`${time} ${stage || 'LOG'} ${msg} ${fields.join(' ')}`.trimEnd());
  }
  return out.slice(-limit);
}
