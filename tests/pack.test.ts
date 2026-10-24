import { describe, expect, it } from 'vitest';
import { fileIsEpisode, pickEpisodeEntry } from '../src/sources/pack';

const e = (...names: string[]) => names.map((name) => ({ name }));
const pick = (names: string[], season: number | undefined, episode: number) =>
  pickEpisodeEntry(e(...names), season, episode)?.name;

describe('fileIsEpisode (is this file the wanted episode?)', () => {
  it('trusts season and episode in the name, and a bare number only when allowed', () => {
    expect(fileIsEpisode('Show.S02E05.srt', 2, 5, true)).toBe(true);
    expect(fileIsEpisode('Show.S02E05.srt', 2, 6, true)).toBe(false);
    expect(fileIsEpisode('Show.S01E05.srt', 2, 5, true)).toBe(false);
    expect(fileIsEpisode('Show - S02E052.English.ass', 2, 1, true)).toBe(false);
    expect(fileIsEpisode('[Grp] Show - 031 (1080p).srt', 1, 31, true)).toBe(true);
    expect(fileIsEpisode('[Grp] Show - 031 (1080p).srt', 1, 3, true)).toBe(false);
    expect(fileIsEpisode('[Grp] Show - 031 (1080p).srt', 2, 31, false)).toBe(false);
    expect(fileIsEpisode('Show - E099 [TV].srt', undefined, 1, true)).toBe(false);
    expect(fileIsEpisode('Show - E001 [TV].srt', undefined, 1, true)).toBe(true);
    expect(fileIsEpisode('Show.E05.srt', undefined, 5, false)).toBe(false);
  });
});

describe('pickEpisodeEntry (one episode out of a season pack)', () => {
  it('matches SxxExx names, with or without leading zeros, and not E15 for E5', () => {
    const names = ['Show.S02E04.srt', 'Show.S02E05.srt', 'Show.S02E15.srt'];
    expect(pick(names, 2, 5)).toBe('Show.S02E05.srt');
    expect(pick(names, 2, 15)).toBe('Show.S02E15.srt');
    expect(pick(names, 2, 6)).toBeUndefined();
  });

  it('is not fooled by another season with the same episode number', () => {
    expect(pick(['Show.S01E05.srt', 'Show.S02E05.srt'], 2, 5)).toBe('Show.S02E05.srt');
    expect(pick(['Show.S01E05.srt'], 2, 5)).toBeUndefined();
  });

  it('matches 1x05 names and names inside folders', () => {
    expect(pick(['Subs/2x05 - Name.srt', 'Subs/2x06 - Name.srt'], 2, 5)).toBe(
      'Subs/2x05 - Name.srt',
    );
    expect(pick(['Show 2023/Show.S02E05.srt'], 2, 5)).toBe('Show 2023/Show.S02E05.srt');
  });

  it('takes the Black Clover style pack names (season and absolute number together)', () => {
    const names = [
      'Black Clover - S02E01 (052).English[CC].srt',
      'Black Clover - S02E02 (053).English[CC].srt',
    ];
    expect(pick(names, 2, 1)).toBe(names[0]);
    expect(pick(names, 2, 2)).toBe(names[1]);
  });

  it('numbers without season: " - 031 (1080p)" style, ignoring resolution and codec words', () => {
    const names = [
      '[SubsPlease] Show - 030 (1080p).srt',
      '[SubsPlease] Show - 031 (1080p).srt',
      '[SubsPlease] Show - 031v2 [x264 10bit].srt',
    ];
    expect(pick(names, undefined, 31)).toBe(names[1]);
    expect(pick(['Show.1080p.x264.srt', 'Show - 05.srt'], undefined, 5)).toBe('Show - 05.srt');
    expect(pick(['Show.1080p.x264.srt'], undefined, 1)).toBeUndefined();
  });

  it('reads the last number of a name, so a number in the title is not the episode', () => {
    const names = ['Mob Psycho 100 - 05.srt', 'Mob Psycho 100 - 100.srt'];
    expect(pick(names, undefined, 100)).toBe('Mob Psycho 100 - 100.srt');
    expect(pick(names, undefined, 5)).toBe('Mob Psycho 100 - 05.srt');
    expect(pick(['Kaguya-sama 3 - 05.srt'], undefined, 3)).toBeUndefined();
    expect(pick(['Kaguya-sama 3 - 05 [1080p].srt'], undefined, 5)).toBe(
      'Kaguya-sama 3 - 05 [1080p].srt',
    );
  });

  it('never guesses a bare number when the pack labels its files with season and episode', () => {
    expect(pick(['Show.S01E01.srt', 'Show.S01E02.srt'], 3, 2)).toBeUndefined();
  });

  it('only looks at .srt files', () => {
    expect(pick(['Show.S02E05.ass', 'Show.S02E05.txt'], 2, 5)).toBeUndefined();
    expect(pick(['Show.S02E05.ass', 'Show.S02E05.SRT'], 2, 5)).toBe('Show.S02E05.SRT');
  });
});
