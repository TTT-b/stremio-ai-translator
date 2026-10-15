import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { chunkCues } from '../src/subtitles/chunk';
import { parseSubtitle } from '../src/subtitles/parse';
import { applyRtlFix } from '../src/subtitles/rtl';
import { serializeSubtitle } from '../src/subtitles/serialize';
import { assertSameStructure, findChunkProblems } from '../src/subtitles/validate';

const srt = readFileSync('tests/fixtures/sample.srt', 'utf8');
const vtt = readFileSync('tests/fixtures/sample.vtt', 'utf8');

describe('SRT', () => {
  it('parses cues with exact timestamps', () => {
    const f = parseSubtitle(srt);
    expect(f.format).toBe('srt');
    expect(f.cues).toHaveLength(3);
    expect(f.cues[1]).toMatchObject({
      startMs: 3500,
      endMs: 5250,
      text: '<i>How are you today?</i>',
    });
    expect(f.cues[2]?.startMs).toBe(62_040);
    expect(f.cues[2]?.text).toBe('- Fine, thanks.\n- Good to hear.');
  });

  it('round-trips parse -> serialize -> parse', () => {
    const a = parseSubtitle(srt);
    const b = parseSubtitle(serializeSubtitle(a));
    expect(b.cues).toEqual(a.cues);
  });

  it('handles BOM and CRLF', () => {
    const f = parseSubtitle('﻿' + srt.replace(/\n/g, '\r\n'));
    expect(f.cues).toHaveLength(3);
  });

  it('throws SUBTITLE_PARSE_FAILED for garbage', () => {
    expect(() => parseSubtitle('this is not a subtitle')).toThrow(AppError);
    try {
      parseSubtitle('nope');
    } catch (e) {
      expect((e as AppError).code).toBe('SUBTITLE_PARSE_FAILED');
    }
  });
});

describe('WebVTT', () => {
  it('parses cues, skipping NOTE blocks and keeping settings', () => {
    const f = parseSubtitle(vtt);
    expect(f.format).toBe('vtt');
    expect(f.cues).toHaveLength(2);
    expect(f.cues[0]).toMatchObject({ startMs: 1000, endMs: 3000, settings: 'align:start' });
    expect(f.cues[1]?.text).toBe('<i>How are you today?</i>');
  });

  it('round-trips', () => {
    const a = parseSubtitle(vtt);
    const out = serializeSubtitle(a);
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(parseSubtitle(out).cues).toEqual(a.cues);
  });
});

describe('chunkCues', () => {
  const cues = Array.from({ length: 10 }, (_, i) => ({
    index: i + 1,
    startMs: i * 1000,
    endMs: i * 1000 + 500,
    text: `line ${i + 1}`,
  }));

  it('splits by size and covers every cue once', () => {
    const chunks = chunkCues(cues, 4, 2);
    expect(chunks.map((c) => c.cues.length)).toEqual([4, 4, 2]);
    expect(chunks.flatMap((c) => c.cues.map((x) => x.index))).toEqual(cues.map((c) => c.index));
  });

  it('gives each chunk read-only context from the previous cues', () => {
    const chunks = chunkCues(cues, 4, 2);
    expect(chunks[0]?.context).toEqual([]);
    expect(chunks[1]?.context.map((c) => c.id)).toEqual(['3', '4']);
  });
});

describe('validation', () => {
  const source = [
    { index: 1, startMs: 0, endMs: 1, text: 'a' },
    { index: 2, startMs: 2, endMs: 3, text: 'b' },
  ];

  it('accepts a complete translation', () => {
    expect(
      findChunkProblems(source, [
        { id: '1', text: 'x' },
        { id: '2', text: 'y' },
      ]),
    ).toEqual([]);
  });
  it('detects missing, duplicate, unknown and empty', () => {
    expect(findChunkProblems(source, [{ id: '1', text: 'x' }])).toContain('missing id 2');
    expect(
      findChunkProblems(source, [
        { id: '1', text: 'x' },
        { id: '1', text: 'x' },
        { id: '2', text: 'y' },
      ]),
    ).toContain('duplicate id 1');
    expect(
      findChunkProblems(source, [
        { id: '1', text: 'x' },
        { id: '2', text: 'y' },
        { id: '9', text: 'z' },
      ]),
    ).toContain('unknown id 9');
    expect(
      findChunkProblems(source, [
        { id: '1', text: '  ' },
        { id: '2', text: 'y' },
      ]),
    ).toContain('empty translation id 1');
  });
  it('rejects Markdown fences', () => {
    expect(
      findChunkProblems(source, [
        { id: '1', text: '```x```' },
        { id: '2', text: 'y' },
      ]).length,
    ).toBeGreaterThan(0);
  });
  it('assertSameStructure catches count and timestamp drift', () => {
    expect(() => assertSameStructure(source, source.slice(0, 1))).toThrow(/cue count/);
    const moved = [{ ...source[0]!, startMs: 5 }, source[1]!];
    expect(() => assertSameStructure(source, moved)).toThrow(/timestamp/);
    expect(() => assertSameStructure(source, source)).not.toThrow();
  });
});

describe('rtl fix', () => {
  const RLM = '‏';

  it('marks start and end of every line with RLM, once', () => {
    const once = applyRtlFix('שלום!\nמה נשמע?');
    expect(once).toBe(`${RLM}שלום!${RLM}\n${RLM}מה נשמע?${RLM}`);
    expect(applyRtlFix(once)).toBe(once);
  });

  it('puts the trailing mark before closing tags', () => {
    expect(applyRtlFix('<i>שלום.</i>')).toBe(`${RLM}<i>שלום.${RLM}</i>`);
  });

  it('keeps leading dashes and ellipsis inside the marked line', () => {
    expect(applyRtlFix('- מה?\n- כלום...')).toBe(`${RLM}- מה?${RLM}\n${RLM}- כלום...${RLM}`);
  });

  it('leaves empty lines alone', () => {
    expect(applyRtlFix('א\n\nב')).toBe(`${RLM}א${RLM}\n\n${RLM}ב${RLM}`);
  });
});
