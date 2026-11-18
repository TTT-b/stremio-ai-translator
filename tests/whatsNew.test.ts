import { describe, expect, it } from 'vitest';
import { pickWhatsNew, RELEASE_NOTES, type ReleaseNote } from '../src/electron/whatsNew';
import { NEWS_TARGETS } from '../src/web/newsTargets';

const notes = { '2.0.0': { en: ['One', 'Two'], he: ['אחד', 'שניים'] } };

describe('pickWhatsNew', () => {
  it('shows the notes on the first launch after an update', () => {
    expect(pickWhatsNew('1.9.0', '2.0.0', 'en', notes)).toEqual({
      version: '2.0.0',
      notes: ['One', 'Two'],
    });
  });

  it('shows the notes in the chosen language', () => {
    expect(pickWhatsNew('1.9.0', '2.0.0', 'he', notes)?.notes).toEqual(['אחד', 'שניים']);
  });

  it('stays quiet on a fresh install', () => {
    expect(pickWhatsNew(undefined, '2.0.0', 'en', notes)).toBeUndefined();
  });

  it('stays quiet when the version did not change', () => {
    expect(pickWhatsNew('2.0.0', '2.0.0', 'en', notes)).toBeUndefined();
  });

  it('stays quiet when this version has no notes', () => {
    expect(pickWhatsNew('2.0.0', '2.0.1', 'en', notes)).toBeUndefined();
  });

  it('has notes in both languages for the version in package.json', async () => {
    const pkg = (await import('../package.json')) as { default: { version: string } };
    const entry = RELEASE_NOTES[pkg.default.version];
    expect(entry?.en.length).toBeGreaterThan(0);
    expect(entry?.he.length).toBe(entry?.en.length);
  });

  describe('"show me" tour targets', () => {
    const versions = Object.keys(RELEASE_NOTES).sort((a, b) =>
      b.localeCompare(a, undefined, { numeric: true }),
    );
    const shown = (notes: ReleaseNote[]): string[] =>
      notes.flatMap((n) => (typeof n === 'object' && 'show' in n && n.show ? [n.show] : []));

    it('only the latest two releases use show, at most 5 each, same keys in both languages', () => {
      versions.forEach((v, i) => {
        const entry = RELEASE_NOTES[v]!;
        expect(shown(entry.he)).toEqual(shown(entry.en));
        if (i >= 2) expect(shown(entry.he)).toEqual([]);
        expect(shown(entry.he).length).toBeLessThanOrEqual(5);
      });
    });

    it('every show key exists in NEWS_TARGETS', () => {
      for (const v of versions.slice(0, 2)) {
        for (const key of shown(RELEASE_NOTES[v]!.he)) expect(NEWS_TARGETS).toHaveProperty(key);
      }
    });
  });
});
