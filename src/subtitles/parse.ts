import { AppError } from '../errors';
import type { Cue, SubtitleFile, SubtitleFormat } from './types';

const TIME = String.raw`(?:(\d{1,3}):)?(\d{1,2}):(\d{2})[,.](\d{1,3})`;
const TIME_LINE = new RegExp(`^\\s*${TIME}\\s*-->\\s*${TIME}(?:\\s+(.*))?$`);

function toMs(h: string | undefined, m: string, s: string, frac: string): number {
  const ms = Number(frac.padEnd(3, '0'));
  return (Number(h ?? 0) * 3600 + Number(m) * 60 + Number(s)) * 1000 + ms;
}

const BOM = String.fromCharCode(0xfeff);
export const stripBom = (s: string): string => (s.startsWith(BOM) ? s.slice(1) : s);

export function normalizeNewlines(input: string): string {
  return stripBom(input).replace(/\r\n?/g, '\n');
}

export function detectFormat(input: string): SubtitleFormat {
  return stripBom(input).trimStart().startsWith('WEBVTT') ? 'vtt' : 'srt';
}

/**
 * Position and style blocks from the ASS format ("{\an8}", "{\i1}") that some SRT files carry.
 * They are never speech, and players that do not know them print them as text.
 */
const OVERRIDE_BLOCK = /\{\\[^}]*\}/g;
export const stripOverrideTags = (text: string): string => text.replace(OVERRIDE_BLOCK, '');

/** Parse SRT or WebVTT text. Throws SUBTITLE_PARSE_FAILED when no cue can be read. */
export function parseSubtitle(input: string, hint?: SubtitleFormat): SubtitleFile {
  const text = normalizeNewlines(input);
  const format = hint ?? detectFormat(text);
  const blocks = text.split(/\n{2,}/);
  const cues: Cue[] = [];

  for (const block of blocks) {
    const lines = block.split('\n').filter((l, i, a) => !(l.trim() === '' && i === a.length - 1));
    const timeIdx = lines.findIndex((l) => TIME_LINE.test(l));
    if (timeIdx === -1 || timeIdx > 1) continue; // header, NOTE, STYLE, junk
    const m = TIME_LINE.exec(lines[timeIdx] as string);
    if (!m) continue;
    const startMs = toMs(m[1], m[2] as string, m[3] as string, m[4] as string);
    const endMs = toMs(m[5], m[6] as string, m[7] as string, m[8] as string);
    const body = stripOverrideTags(lines.slice(timeIdx + 1).join('\n')).trim();
    const cue: Cue = { index: cues.length + 1, startMs, endMs, text: body };
    const settings = m[9]?.trim();
    if (format === 'vtt' && settings) cue.settings = settings;
    cues.push(cue);
  }

  if (cues.length === 0) {
    throw new AppError('SUBTITLE_PARSE_FAILED', 'no cues found');
  }
  return { format, cues };
}
