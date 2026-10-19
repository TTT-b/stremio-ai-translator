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
  /** Read-only source lines just after this chunk: a pronoun or name there often settles gender. */
  upcoming: ChunkCue[];
}

export const cueId = (cue: Cue): string => String(cue.index);

/**
 * Split cues into chunks of at most `size` cues. Each chunk also carries up to `contextSize`
 * source cues before it and up to `lookahead` cues after it (read-only, not to be re-translated).
 */
export function chunkCues(cues: Cue[], size: number, contextSize = 3, lookahead = 4): Chunk[] {
  if (size < 1) throw new RangeError('chunk size must be >= 1');
  const chunks: Chunk[] = [];
  const toContext = (c: Cue): ChunkCue => ({ id: cueId(c), text: c.text });
  for (let start = 0; start < cues.length; start += size) {
    const slice = cues.slice(start, start + size);
    const end = start + size;
    chunks.push({
      number: chunks.length,
      cues: slice,
      context: cues.slice(Math.max(0, start - contextSize), start).map(toContext),
      upcoming: cues.slice(end, end + lookahead).map(toContext),
    });
  }
  return chunks;
}
