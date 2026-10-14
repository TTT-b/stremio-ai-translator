import type { SubtitleFile } from './types';

function pad(n: number, w: number): string {
  return String(n).padStart(w, '0');
}

export function formatTimestamp(ms: number, sep: ',' | '.'): string {
  const total = Math.max(0, Math.round(ms));
  const h = Math.floor(total / 3_600_000);
  const m = Math.floor((total % 3_600_000) / 60_000);
  const s = Math.floor((total % 60_000) / 1000);
  return `${pad(h, 2)}:${pad(m, 2)}:${pad(s, 2)}${sep}${pad(total % 1000, 3)}`;
}

export function serializeSubtitle(file: SubtitleFile): string {
  if (file.format === 'vtt') {
    const body = file.cues
      .map((c) => {
        const settings = c.settings ? ` ${c.settings}` : '';
        return `${formatTimestamp(c.startMs, '.')} --> ${formatTimestamp(c.endMs, '.')}${settings}\n${c.text}`;
      })
      .join('\n\n');
    return `WEBVTT\n\n${body}\n`;
  }
  const body = file.cues
    .map(
      (c, i) =>
        `${i + 1}\n${formatTimestamp(c.startMs, ',')} --> ${formatTimestamp(c.endMs, ',')}\n${c.text}`,
    )
    .join('\n\n');
  return `${body}\n`;
}
