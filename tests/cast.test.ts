import { describe, expect, it } from 'vitest';
import { buildCast } from '../src/subtitles/cast';
import type { SubtitleFile } from '../src/subtitles/types';

const file = (texts: string[]): SubtitleFile => ({
  format: 'srt',
  cues: texts.map((text, i) => ({ index: i + 1, startMs: i * 1000, endMs: i * 1000 + 800, text })),
});

describe('buildCast', () => {
  it('finds the gender of a speaker from the pronouns that follow the name', () => {
    const cast = buildCast(
      file([
        '[Nisha] Hello there.',
        'Nisha said she was tired.',
        'I think Nisha lost her key.',
        '[Agam] Wait for me.',
        'Agam told us he would come.',
        'Everyone knows Agam and his sister.',
      ]),
    );
    expect(cast).toContain('Nisha: female');
    expect(cast).toContain('Agam: male');
  });

  it('uses a title in front of a name', () => {
    expect(buildCast(file(['KAI: Hi.', 'Mrs. Kai is here.']))).not.toContain('Kai: male');
    expect(buildCast(file(['LEE: Hi.', 'Where is Mr. Lee?', 'Mr. Lee is late.']))).toContain(
      'Lee: male',
    );
  });

  it('leaves out names without clear evidence and generic labels', () => {
    expect(buildCast(file(['[Jae] Hi.', '[Narrator] Long ago.', '[Uki] Yes.']))).toEqual([]);
    expect(buildCast(file(['[Pavi] Hi.', 'Pavi said she left and he stayed.']))).toEqual([]);
  });

  it('is empty for a file without labels', () => {
    expect(buildCast(file(['Hello.', 'Bye.']))).toEqual([]);
  });
});
