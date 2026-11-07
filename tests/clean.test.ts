import { describe, expect, it } from 'vitest';
import { cleanSubtitle, cleanText, cleanTranslated } from '../src/subtitles/clean';
import type { SubtitleFile } from '../src/subtitles/types';

describe('music notes between music symbols', () => {
  it.each([
    '♪ tense music plays ♪',
    '♪ soft music ♪',
    '♪ Soft music plays ♪',
    '<i>♪ instrumental music playing ♪</i>',
    '♪ soft, tense music playing ♪',
    '♪ woman vocalizing continues ♪',
    '♪',
    '♪ tense musical stinger ♪',
    '♪ music intensifies ♪',
    '♪ music ends abruptly ♪',
    '♪ kalimba plays softly ♪',
    '♪ dramatic majestic music\nplays ♪',
    '- ♪ tense musical stinger\n- ♪ music intensifies',
  ])('removes %s', (text) => {
    expect(cleanText(text)).toBe('');
  });

  it('keeps the spoken line next to a music note', () => {
    expect(cleanText('- ♪ tense musical stinger\n- Run!')).toBe('Run!');
  });

  it.each([
    "♪ 'Cause I'm in too deep ♪",
    "<i>♪ Someday you'll return to me ♪</i>",
    '♪ Did you sink it in the sea? ♪',
    "♪ Oh, little one,\nwhere'd you take my heart ♪",
    '♪ I will always love you ♪',
    '♪ Music is all I need ♪',
    '♪ Soft music ♪',
    '♪ Play me a song tonight ♪',
  ])('keeps lyrics %s', (text) => {
    expect(cleanText(text)).not.toBe('');
  });
});

describe('cleanText', () => {
  it.each([
    ['KATARA: Water.', 'Water.'],
    [
      'SOKKA: Was that you or Dad who put an octopus on your head?',
      'Was that you or Dad who put an octopus on your head?',
    ],
    ['MAN 1: Hello there.', 'Hello there.'],
    ['SOKKA (O.S.): Over here!', 'Over here!'],
    ['Look out! (groans)', 'Look out!'],
    ['(sniffing) Oops!', 'Oops!'],
    ['[door slams] Who is it?', 'Who is it?'],
    ['- (thud)\n- Aang!', 'Aang!'],
    ['- (growling)\n- Be careful!', 'Be careful!'],
  ])('%j becomes %j', (input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });

  it('removes a line that is only a sound, and keeps the other', () => {
    expect(cleanText('(wind blowing)\nCome on.')).toBe('Come on.');
  });

  it('is empty when the cue was only a sound', () => {
    expect(cleanText('(groans)')).toBe('');
    expect(cleanText('[MUSIC PLAYING]')).toBe('');
    expect(cleanText('- (grunts)\n- (panting)')).toBe('');
  });

  it('keeps two speakers when both lines stay', () => {
    expect(cleanText('- Where are you?\n- Here!')).toBe('- Where are you?\n- Here!');
  });

  it('leaves ordinary text alone', () => {
    for (const text of [
      'Note: this is not a name.',
      'The time is 10:30 now.',
      'He said: "go".',
      'I love you (really).',
      'Warning: do not touch!',
      'Hello, how are you?',
      'WAIT! Stop!',
    ]) {
      expect(cleanText(text)).toBe(text);
    }
  });

  it('works for Hebrew notes in brackets too', () => {
    expect(cleanText('(נוהם) תיזהר!')).toBe('תיזהר!');
    expect(cleanText('[מוזיקה]')).toBe('');
  });
});

describe('cleanText with tags around the words', () => {
  const font = (inner: string) => '<font face="Serif" size="18">' + inner + '</font>';
  it.each([
    [font('KATARA: Water.'), font('Water.')],
    [font('- (THUDDING)\n- Unh!'), font('Unh!')],
    [font('- Watch out!\n- (GROWLING)'), font('Watch out!')],
    ['<i>KATARA: Hi</i>', '<i>Hi</i>'],
    ['<i>(groans)</i>', ''],
    [font('(WIND BLOWING)'), ''],
    ['<i>(groans)</i>\nCome on.', 'Come on.'],
  ])('%j becomes %j', (input, expected) => {
    expect(cleanText(input)).toBe(expected);
  });
});

describe('cleanSubtitle', () => {
  const file: SubtitleFile = {
    format: 'srt',
    cues: [
      { index: 1, startMs: 1000, endMs: 2000, text: 'KATARA: Water.' },
      { index: 2, startMs: 3000, endMs: 4000, text: '(groans)' },
      { index: 3, startMs: 5000, endMs: 6000, text: 'Earth.' },
    ],
  };

  it('drops sound-only cues and numbers the rest from 1', () => {
    const out = cleanSubtitle(file);
    expect(out.cues.map((c) => [c.index, c.text, c.startMs])).toEqual([
      [1, 'Water.', 1000],
      [2, 'Earth.', 5000],
    ]);
  });

  it('does not change the input', () => {
    cleanSubtitle(file);
    expect(file.cues).toHaveLength(3);
    expect(file.cues[0]?.text).toBe('KATARA: Water.');
  });
});

describe('credits and adverts', () => {
  const cue = (index: number, text: string) => ({
    index,
    startMs: index * 1000,
    endMs: index * 1000 + 800,
    text,
  });
  const run = (texts: string[]) =>
    cleanSubtitle({ format: 'srt', cues: texts.map((t, i) => cue(i + 1, t)) }).cues.map(
      (c) => c.text,
    );

  it.each([
    'תורגם ע"י נוי גמליאל',
    '<i>תורגם על ידי דני</i>',
    'תרגום: דני כהן\nסנכרון: רון',
    'Translated by Noy',
    'Subtitles by SubTeam',
    'Synced & corrected by Foo',
    'Downloaded from www.OpenSubtitles.org',
  ])('removes the credit "%s"', (credit) => {
    expect(run([credit, 'Hello there.'])).toEqual(['Hello there.']);
  });

  it('keeps speech that only looks similar', () => {
    expect(
      run(['The translation was wrong.', 'We need to sync our watches.', 'תרגום זה לא פשוט.']),
    ).toEqual(['The translation was wrong.', 'We need to sync our watches.', 'תרגום זה לא פשוט.']);
  });
});

describe('cleanTranslated', () => {
  const cue = (index: number, text: string) => ({
    index,
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text,
  });

  it('drops a sound note the AI wrote and keeps the speech, with the direction marks back', () => {
    const out = cleanTranslated(
      [cue(1, '‏[מוזיקה נוסטלגית מנגנת]‏'), cue(2, '‏שלום לכולם.‏'), cue(3, '[מוזיקה]')],
      true,
    );
    expect(out.map((c) => c.text)).toEqual(['‏שלום לכולם.‏']);
    expect(out[0]?.index).toBe(1);
  });
});
