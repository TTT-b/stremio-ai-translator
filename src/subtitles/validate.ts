import { AppError } from '../errors';
import type { ChunkCue } from './chunk';
import type { Cue } from './types';

/**
 * Check one chunk's translation against its source. Returns a list of problems
 * (empty = valid). Problem strings contain IDs only, never dialogue.
 */
export function findChunkProblems(source: Cue[], translations: ChunkCue[]): string[] {
  const problems: string[] = [];
  const expected = new Set(source.map((c) => String(c.index)));
  const seen = new Map<string, string>();

  for (const t of translations) {
    if (typeof t?.id !== 'string' || typeof t?.text !== 'string') {
      problems.push('malformed translation entry');
      continue;
    }
    if (!expected.has(t.id)) problems.push(`unknown id ${t.id}`);
    else if (seen.has(t.id)) problems.push(`duplicate id ${t.id}`);
    else seen.set(t.id, t.text);
  }
  for (const c of source) {
    const id = String(c.index);
    const out = seen.get(id);
    if (out === undefined) problems.push(`missing id ${id}`);
    else if (c.text.trim() !== '' && out.trim() === '') problems.push(`empty translation id ${id}`);
    else if (/```/.test(out)) problems.push(`markdown fence in id ${id}`);
  }
  return problems;
}

/** Final whole-file check: same cue count, order and timestamps as the source. */
export function assertSameStructure(source: Cue[], result: Cue[]): void {
  if (source.length !== result.length) {
    throw new AppError('FINAL_SUBTITLE_INVALID', `cue count ${source.length} -> ${result.length}`);
  }
  for (let i = 0; i < source.length; i++) {
    const a = source[i] as Cue;
    const b = result[i] as Cue;
    if (a.startMs !== b.startMs || a.endMs !== b.endMs) {
      throw new AppError('FINAL_SUBTITLE_INVALID', `timestamp mismatch at cue ${a.index}`);
    }
    if (a.text.trim() !== '' && b.text.trim() === '') {
      throw new AppError('FINAL_SUBTITLE_INVALID', `empty text at cue ${a.index}`);
    }
  }
}
