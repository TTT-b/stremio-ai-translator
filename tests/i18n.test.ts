import { describe, expect, it } from 'vitest';
import { ERROR_META } from '../src/errors';
import { dictFor, ERROR_MESSAGES, fmt, UI_LANGS } from '../src/web/i18n';
import { renderStatusPage, type StatusPageData } from '../src/web/html';

const base: StatusPageData = {
  nonce: 'abc',
  aiConfigured: true,
  aiProviderLabel: 'Google Gemini',
  aiModel: 'gemini-3.5-flash-lite',
  dualSubtitles: false,
  openSubtitlesKeyConfigured: true,
  openSubtitlesLoginConfigured: true,
  openSubtitlesUsername: 'user',
  languages: [
    { code: 'he', name: 'Hebrew' },
    { code: 'en', name: 'English' },
  ],
  targetLanguage: 'he',
  manifestUrl: 'http://127.0.0.1:7000/manifest.json',
  installUrl: 'https://web.stremio.com/#/addons?addon=x',
  stremioReady: true,
  rtlFix: true,
};

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('dictionary', () => {
  it('has every text in both languages with the same placeholders', () => {
    const he = dictFor('he');
    const en = dictFor('en');
    for (const key of Object.keys(he) as (keyof typeof he)[]) {
      expect(he[key].trim(), key).not.toBe('');
      expect(en[key].trim(), key).not.toBe('');
      expect(placeholders(he[key]), key).toEqual(placeholders(en[key]));
    }
  });

  it('has an error message for every error code in both languages', () => {
    for (const lang of UI_LANGS) {
      for (const code of Object.keys(ERROR_META)) {
        expect(
          ERROR_MESSAGES[lang][code as keyof (typeof ERROR_MESSAGES)['he']],
          code,
        ).toBeTruthy();
      }
    }
    expect(ERROR_MESSAGES.he.INVALID_API_KEY).toMatch(/[א-ת]/);
    expect(ERROR_MESSAGES.en.INVALID_API_KEY).not.toMatch(/[א-ת]/);
  });

  it('fills placeholders', () => {
    expect(fmt('{a} of {b}', { a: 1, b: 2 })).toBe('1 of 2');
    expect(fmt('{a} {missing}', { a: 1 })).toBe('1 {missing}');
  });
});

describe('page language', () => {
  it('is Hebrew and right-to-left by default', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('<html lang="he" dir="rtl"');
    expect(html).toContain('הכתוביות שלי');
  });

  it('is English and left-to-right when chosen, with no Hebrew UI text left', () => {
    const html = renderStatusPage({ ...base, uiLang: 'en', desktop: true });
    expect(html).toContain('<html lang="en" dir="ltr"');
    expect(html).toContain('My subtitles');
    expect(html).toContain('Close the window?');
    // Hebrew may appear only as a language's own name (e.g. the interface-language choice).
    const visible = html
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<option[\s\S]*?<\/option>/g, '')
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<div class="js-lang-menu[\s\S]*?<\/div>/g, '');
    expect(visible).not.toMatch(/[א-ת]/);
  });

  it.each([
    ['he', false],
    ['en', false],
    ['he', true],
    ['en', true],
  ] as const)('ships a script that parses (%s, desktop=%s)', (uiLang, desktop) => {
    const html = renderStatusPage({ ...base, uiLang, desktop });
    const script = /<script nonce="abc">([\s\S]*)<\/script>/.exec(html)?.[1] ?? '';
    expect(script.length).toBeGreaterThan(1000);
    expect(() => new Function(script)).not.toThrow();
  });

  it('offers the wizard a way back to the main screen and puts the checks on it', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('id="dr-ai"');
    expect(html).toContain('id="news-panel"');
    expect(html.match(/js-news-badge/g)?.length).toBeGreaterThanOrEqual(2); // wizard and main screen
    expect(html).toContain('id="dsample"');
    expect(html).toContain('let fromDash = true;');
    expect(renderStatusPage({ ...base, aiConfigured: false })).toContain('let fromDash = false;');
  });
});
