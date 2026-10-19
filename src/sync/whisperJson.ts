import type { SpokenWord } from './align';
import { normalizeWord } from './align';

/** The part of whisper.cpp's `--output-json-full` file that is used here. */
interface WhisperToken {
  text: string;
  offsets: { from: number; to: number };
  /** Token time from dynamic time warping, in hundredths of a second; -1 when not computed. */
  t_dtw?: number;
}
interface WhisperJson {
  transcription?: { tokens?: WhisperToken[] }[];
}

/**
 * Words with their times from whisper's JSON. Sub-word tokens are joined into words; special
 * tokens and sound-effect notes ("[music playing]") are dropped. The word start is the DTW time
 * (accurate); the end is capped, because the token end times are only rough.
 */
export function parseWhisperJson(json: unknown): SpokenWord[] {
  const doc = json as WhisperJson;
  const words: SpokenWord[] = [];
  let inNote = false;
  for (const seg of doc.transcription ?? []) {
    for (const t of seg.tokens ?? []) {
      const text = t.text ?? '';
      if (/^\[_|^<\|/.test(text.trim())) continue; // special tokens such as [_BEG_] or <|endoftext|>
      // "[music playing]" and "(growling)" are written as several tokens: skip until the closing mark.
      if (/[[(]/.test(text)) inNote = true;
      const closes = /[\])]/.test(text);
      if (inNote) {
        if (closes) inNote = false;
        continue;
      }
      const piece = normalizeWord(text);
      if (!piece) continue;
      const start = t.t_dtw !== undefined && t.t_dtw > 0 ? t.t_dtw / 100 : t.offsets.from / 1000;
      const to = t.offsets.to / 1000;
      const last = words[words.length - 1];
      if (/^\s/.test(text) || !last) {
        words.push({ w: piece, start, end: Math.max(start + 0.1, Math.min(to, start + 1.2)) });
      } else {
        last.w += piece;
        last.end = Math.max(last.end, Math.min(to, last.start + 1.2));
      }
    }
  }
  return words;
}
