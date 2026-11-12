import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { AppError } from '../src/errors';
import { chunkCues } from '../src/subtitles/chunk';
import { parseSubtitle, stripOverrideTags } from '../src/subtitles/parse';
import { applyRtlFix, stripDialogueDashes, unflipPunctuation } from '../src/subtitles/rtl';
import { serializeSubtitle } from '../src/subtitles/serialize';
import {
  assertSameStructure,
  findBrokenWords,
  findChunkProblems,
  findDriftedLines,
  findSuspiciousLines,
  stripForeignScripts,
} from '../src/subtitles/validate';

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

  it('gives each chunk read-only upcoming lines from the cues after it', () => {
    const chunks = chunkCues(cues, 4, 2, 3);
    expect(chunks[0]?.upcoming.map((c) => c.id)).toEqual(['5', '6', '7']);
    expect(chunks[1]?.upcoming.map((c) => c.id)).toEqual(['9', '10']);
    expect(chunks[2]?.upcoming).toEqual([]);
  });
});

describe('suspicious Latin leftovers', () => {
  const src = [{ index: 1, startMs: 0, endMs: 1, text: 'No way, Bob! OK' }];
  const HE = 'שלום';
  const check = (text: string, code = 'he') => findSuspiciousLines(src, [{ id: '1', text }], code);

  it('flags a Latin word that is not in the source line', () => {
    expect(check(HE + ' lad')).toEqual(['1']);
  });
  it('accepts names from the source, abbreviations and single letters', () => {
    expect(check(HE + ' Bob')).toEqual([]);
    expect(check(HE + ' DNA ok kg')).toEqual([]);
    expect(check(HE + ' T:')).toEqual([]);
  });
  it('does not check languages written in Latin', () => {
    expect(check('hola lad', 'es')).toEqual([]);
  });
});

describe('broken Hebrew words', () => {
  const HE = 'שלום';
  it('flags a lone Hebrew letter standing between spaces', () => {
    const t = [
      { id: '1', text: `${HE} ה ${HE}` },
      { id: '2', text: `${HE} ${HE}` },
      { id: '3', text: `${HE} ו` },
    ];
    expect(findBrokenWords(t, 'he')).toEqual(['1', '3']);
  });
  it('does not check other languages', () => {
    expect(findBrokenWords([{ id: '1', text: 'a b c' }], 'es')).toEqual([]);
  });
});

describe('drifted lines', () => {
  const SRC = 'This is a normal line of dialogue';
  const HE = 'זו שורה רגילה של דיאלוג כאן';
  const cues = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ index: i + 1, startMs: i, endMs: i + 1, text: SRC }));
  const reply = (n: number, texts: Record<number, string> = {}) =>
    Array.from({ length: n }, (_, i) => ({ id: String(i + 1), text: texts[i + 1] ?? HE }));

  it('finds nothing when every line is about as long as it should be', () => {
    expect(findDriftedLines(cues(20), reply(20))).toEqual([]);
  });
  it('flags a run of lines far shorter than their source, with a few neighbours', () => {
    const slid = findDriftedLines(cues(20), reply(20, { 10: 'כן', 11: 'כן', 12: 'כן' }));
    expect(slid).toEqual(expect.arrayContaining(['10', '11', '12']));
    expect(slid).toContain('8');
    expect(slid).not.toContain('1');
  });
  it('ignores one or two odd lines', () => {
    expect(findDriftedLines(cues(20), reply(20, { 5: 'כן', 6: 'כן' }))).toEqual([]);
  });
  it('does not judge tiny chunks', () => {
    expect(findDriftedLines(cues(5), reply(5, { 1: 'כן', 2: 'כן', 3: 'כן' }))).toEqual([]);
  });
});

describe('foreign script sanitizing', () => {
  const src = [{ index: 1, startMs: 0, endMs: 1, text: 'Hello Bob' }];
  const clean = (text: string, code = 'he', source = src) =>
    stripForeignScripts(source, [{ id: '1', text }], code)[0]?.text;
  const HE = '\u05E9\u05DC\u05D5\u05DD'; // shalom
  const AR = '\u0645'; // an Arabic letter

  it('removes an Arabic letter inside a Hebrew word', () => {
    expect(clean('\u05E9\u05DC' + AR + '\u05D5\u05DD')).toBe(HE);
  });
  it('removes letters of any other alphabet (Georgian, Ethiopic, Bengali), not only a fixed list', () => {
    expect(clean('אგრამ ' + HE)).toBe('א ' + HE);
    expect(clean(HE + 'ዝ')).toBe(HE);
    expect(clean('ה' + 'ও' + 'א')).toBe('הא');
  });
  it('removes Cyrillic and CJK, and tidies the gap', () => {
    expect(clean(HE + ' \u0434 ' + HE)).toBe(HE + ' ' + HE);
    expect(clean(HE + ' \u4F60\u597D')).toBe(HE);
  });
  it('keeps Hebrew, Latin names and brands, digits and punctuation', () => {
    const ok = HE + ' Bob, iPhone 15!? "..." \u2013 \u266A';
    expect(clean(ok)).toBe(ok);
  });
  it('returns the very same array when nothing changes', () => {
    const t = [{ id: '1', text: HE }];
    expect(stripForeignScripts(src, t, 'he')).toBe(t);
  });
  it('keeps a script that the source line itself contains', () => {
    const arabicSource = [
      { index: 1, startMs: 0, endMs: 1, text: '\u0642\u0627\u0644 \u0645\u0631\u062D\u0628\u0627' },
    ];
    const t = HE + ' \u0645\u0631\u062D\u0628\u0627';
    expect(clean(t, 'he', arabicSource)).toBe(t);
  });
  it('does nothing for an unknown language, and keeps the target own script', () => {
    expect(clean(HE + AR, 'xx')).toBe(HE + AR);
    expect(clean('\u0645\u0631\u062D\u0628\u0627', 'ar')).toBe('\u0645\u0631\u062D\u0628\u0627');
    expect(clean('\u3053\u3093\u306B\u3061\u306F', 'ja')).toBe('\u3053\u3093\u306B\u3061\u306F');
  });
  it('leaves a line empty when only foreign letters were there (validation then reports it)', () => {
    expect(clean(AR)).toBe('');
    expect(findChunkProblems(src, [{ id: '1', text: clean(AR) ?? '' }])).toEqual([
      'empty translation id 1',
    ]);
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

  it('wraps an English term inside a Hebrew line so punctuation next to it stays in place', () => {
    const out = applyRtlFix('נשארו לי 50 HP, ו-MP נגמר.');
    expect(out).toBe(`${RLM}נשארו לי 50 ${RLM}HP${RLM}, ו-${RLM}MP${RLM} נגמר.${RLM}`);
    expect(applyRtlFix(out)).toBe(out);
  });

  it('keeps a multi-word English phrase together and does not touch tags', () => {
    expect(applyRtlFix('<i>הוא אמר Hello World.</i>')).toBe(
      `${RLM}<i>הוא אמר ${RLM}Hello World${RLM}.${RLM}</i>`,
    );
  });

  it('does not mark English in a line with no Hebrew', () => {
    expect(applyRtlFix('Hello there.')).toBe(`${RLM}Hello there.${RLM}`);
  });
});

describe('music notes', () => {
  it('removes the note symbols from a line that has words', () => {
    expect(applyRtlFix('♪ או שיט ♪')).toBe('‏או שיט‏');
    expect(applyRtlFix('<i>♪ la la ♪</i>')).toBe('‏<i>la la‏</i>');
  });

  it('leaves a line that is only notes alone', () => {
    expect(applyRtlFix('♪♪')).toBe('‏♪♪‏');
  });
});

describe('stripDialogueDashes', () => {
  it('removes a leading dash and a trailing dash, keeping the final stop', () => {
    expect(stripDialogueDashes('- טייסינו הטובים! מה קורה?\n– היי, אחי.')).toBe(
      'טייסינו הטובים! מה קורה?\nהיי, אחי.',
    );
    expect(stripDialogueDashes('תתפוצץ-.')).toBe('תתפוצץ.');
    expect(stripDialogueDashes('<i>- שלום</i>')).toBe('<i>שלום</i>');
    expect(stripDialogueDashes('שלום -')).toBe('שלום');
  });

  it('keeps a dash inside a line', () => {
    expect(stripDialogueDashes('דו-קרב גדול')).toBe('דו-קרב גדול');
  });
});

describe('unflipPunctuation (subtitles stored with flipped punctuation)', () => {
  it('puts stops back at the end and a trailing dash at the start (real case)', () => {
    const flipped = [
      '.שיניתי את דעתי\n.בואו נלך',
      '?למה אתה מתכוון -\n?למה אני מתכוון -',
      '!שתוק\n.שב',
    ];
    expect(unflipPunctuation(flipped)).toEqual([
      'שיניתי את דעתי.\nבואו נלך.',
      '- למה אתה מתכוון?\n- למה אני מתכוון?',
      'שתוק!\nשב.',
    ]);
  });

  it('keeps tags in place and reverses a flipped "?!" run', () => {
    const flipped = ['<i>.אחד</i>', '<i>?!שניים</i>', '.שלוש'];
    expect(unflipPunctuation(flipped)).toEqual(['<i>אחד.</i>', '<i>שניים!?</i>', 'שלוש.']);
  });

  it('leaves a normal file untouched', () => {
    const normal = ['שלום!', '- מה?\n- כלום...', 'ביי.', 'עוד אחד', '...והוא הלך'];
    expect(unflipPunctuation(normal)).toEqual(normal);
  });

  it('leaves a file with only a rare leading stop untouched', () => {
    const texts = Array.from({ length: 40 }, () => 'שורה רגילה.');
    texts[5] = '.חריג';
    expect(unflipPunctuation(texts)).toEqual(texts);
  });
});

describe('style blocks inside subtitle text', () => {
  it('removes position and style blocks such as an8, keeps the words, and leaves other braces alone', () => {
    const srt =
      '1\n00:00:01,000 --> 00:00:02,000\n{\\an8}The police said {\\i1}no{\\i0}.\nA {set} of keys\n';
    const cue = parseSubtitle(srt).cues[0];
    expect(cue?.text).toBe('The police said no.\nA {set} of keys');
  });
  it('strips them from text that is already translated', () => {
    expect(stripOverrideTags('{\\an8}המשטרה קבעה')).toBe('המשטרה קבעה');
    expect(stripOverrideTags('בלי תגים')).toBe('בלי תגים');
  });
});
