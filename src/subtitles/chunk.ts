import type { Cue } from './types';

export interface ChunkCue {
  id: string;
  text: string;
}

export interface Chunk {
  /** 0-based chunk number. */
  number: number;
  cues: Cue[];
  /** Read-only source lines just before this chunk, for naming/tone consistency. */
  context: ChunkCue[];
}

export const cueId = (cue: Cue): string => String(cue.index);

/**
 * Split cues into chunks of at most `size` cues. Each chunk also carries up to
 * `contextSize` source cues from the previous chunk (not to be re-translated).
 */
export function chunkCues(cues: Cue[], size: number, contextSize = 3): Chunk[] {
  if (size < 1) throw new RangeError('chunk size must be >= 1');
  const chunks: Chunk[] = [];
  for (let start = 0; start < cues.length; start += size) {
    const slice = cues.slice(start, start + size);
    const context = cues
      .slice(Math.max(0, start - contextSize), start)
      .map((c) => ({ id: cueId(c), text: c.text }));
    chunks.push({ number: chunks.length, cues: slice, context });
  }
  return chunks;
}
