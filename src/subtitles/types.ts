export type SubtitleFormat = 'srt' | 'vtt';

export interface Cue {
  /** 1-based position in the file. Used as the translation ID. */
  index: number;
  startMs: number;
  endMs: number;
  /** Dialogue text; lines separated by "\n". */
  text: string;
  /** WebVTT cue settings (position, align...). Preserved verbatim. */
  settings?: string;
}

export interface SubtitleFile {
  format: SubtitleFormat;
  cues: Cue[];
}
