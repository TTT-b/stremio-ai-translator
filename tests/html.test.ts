import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { ERROR_META } from '../src/errors';
import { ERROR_MESSAGES_HE, renderStatusPage, prettyModel, providerLine } from '../src/web/html';

const page = renderStatusPage({
  nonce: 'abc',
  aiConfigured: true,
  aiProviderLabel: 'Google Gemini',
  aiModel: 'gemini-3.5-flash-lite',
  dualSubtitles: false,
  openSubtitlesKeyConfigured: false,
  openSubtitlesLoginConfigured: false,
  openSubtitlesUsername: '',
  languages: [{ code: 'he', name: 'Hebrew' }],
  targetLanguage: 'he',
  manifestUrl: 'http://127.0.0.1:7000/manifest.json',
  installUrl:
    'https://web.stremio.com/#/addons?addon=http%3A%2F%2F127.0.0.1%3A7000%2Fmanifest.json',
  stremioReady: true,
  rtlFix: false,
});

describe('config page', () => {
  it('loads nothing external and has no QR code', () => {
    expect(page).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(page).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    expect(page).not.toMatch(/src=["']https?:\/\/(?!127\.0\.0\.1)/i);
    // External links are click-throughs only (Stremio Web + the key-creation pages), never loaded resources.
    expect(page).not.toMatch(
      /href=["']https?:\/\/(?!127\.0\.0\.1|web\.stremio\.com\/|aistudio\.google\.com\/|platform\.claude\.com\/|platform\.openai\.com\/|www\.opensubtitles\.com\/|subdl\.com\/)/i,
    );
    expect(page).not.toMatch(/cdn\.tailwindcss\.com|<canvas/i);
    // The only drawings are the two small flags, the menu arrow and the eye icon (no QR code).
    const drawings = page.match(/<svg[^>]*>/gi) ?? [];
    expect(drawings.every((tag) => /viewBox="0 0 (22 16|60 30|10 6|20 20|24 24)"/.test(tag))).toBe(
      true,
    );
  });

  it('has styled key-creation buttons that open safely and mark the free ones', () => {
    for (const url of [
      'https://aistudio.google.com/apikey',
      'https://platform.claude.com/settings/keys',
      'https://platform.openai.com/api-keys',
      'https://www.opensubtitles.com/consumers',
      'https://www.opensubtitles.com/en/users/sign_up',
      'https://subdl.com/panel/api',
    ]) {
      expect(page).toContain(`href="${url}" target="_blank" rel="noopener noreferrer"`);
    }
    expect(page.match(/>חינם</g)).toHaveLength(4);
  });

  it('always shows the SubDL check, and says the key is missing when pressed without one', () => {
    const withKey = renderStatusPage({
      nonce: 'abc',
      aiConfigured: true,
      aiProviderLabel: 'Google Gemini',
      aiModel: 'm',
      dualSubtitles: false,
      openSubtitlesKeyConfigured: true,
      subdlKeyConfigured: true,
      openSubtitlesLoginConfigured: true,
      openSubtitlesUsername: 'u',
      languages: [{ code: 'he', name: 'Hebrew' }],
      targetLanguage: 'he',
      manifestUrl: 'http://127.0.0.1:7000/manifest.json',
      installUrl: 'https://web.stremio.com/#/addons',
      stremioReady: true,
      rtlFix: false,
    });
    const rowOf = (html: string) =>
      /<div class="([^"]*)js-subdl-row ([^"]*)flex items-center/.exec(html);
    expect(page).toContain('id="dr-subdl"');
    expect(withKey).toContain('id="dr-subdl"');
    expect(page).toContain('חסר מפתח SubDL');
    expect(rowOf(page)).toBeNull();
  });

  it('inlines the locally built CSS with the nonce', () => {
    expect(page).toMatch(/<style nonce="abc">[^<]*\.rounded-2xl/);
  });
});

describe('model names and the header', () => {
  it('writes the model in readable words', () => {
    expect(prettyModel('gemini-3.5-flash-lite')).toBe('Gemini 3.5 Flash Lite');
    expect(prettyModel('gpt-4o-mini')).toBe('GPT 4o Mini');
    expect(prettyModel('claude-sonnet-5-5')).toBe('Claude Sonnet 5.5');
  });

  it('joins the provider and the model without repeating the name', () => {
    expect(providerLine('Google Gemini', 'gemini-3.5-flash-lite')).toBe(
      'Google Gemini 3.5 Flash Lite',
    );
    expect(providerLine('OpenAI', 'gpt-4o-mini')).toBe('OpenAI · GPT 4o Mini');
    expect(providerLine('', 'gpt-4o')).toBe('GPT 4o');
  });
});

describe('main screen layout', () => {
  const base = {
    nonce: 'abc',
    aiConfigured: true,
    aiProviderLabel: 'Google Gemini',
    aiModel: 'gemini-3.5-flash-lite',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: true,
    openSubtitlesLoginConfigured: true,
    openSubtitlesUsername: 'u',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/#/addons',
    stremioReady: true,
    rtlFix: false,
  };

  it('shows the model without dashes', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('Google Gemini 3.5 Flash Lite');
    expect(html).not.toContain('gemini-3.5-flash-lite');
  });

  it('has a language menu with flags, and no language choice inside the settings', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('js-lang-btn');
    expect(html).toContain('data-ui="en"');
    expect(html).not.toContain('id="d-ui"');
  });

  it('asks before leaving for another site, and can open Stremio', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('id="ext-modal"');
    expect(html).toContain('id="ext-open"');
    expect(html).toContain('id="open-stremio"');
  });

  it('uses two columns on a wide window and one on a narrow one', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('lg:max-w-[1040px]');
    expect(html).toContain('lg:grid-cols-2');
  });

  it('puts the Continue button inside the status card', () => {
    const html = renderStatusPage(base);
    const card = html.indexOf('id="st-state"');
    const button = html.indexOf('id="resume-btn"');
    const next = html.indexOf('id="st-progress-text"');
    expect(card).toBeGreaterThan(-1);
    expect(button).toBeGreaterThan(card);
    expect(button).toBeLessThan(next);
  });

  it('says no key was entered when there is no SubDL key, and counts when there is', () => {
    const without = renderStatusPage({ ...base, subdlKeyConfigured: false });
    expect(without).toContain('לא הוזן מפתח');
    const withKey = renderStatusPage({ ...base, subdlKeyConfigured: true });
    expect(withKey).toMatch(/id="st-subdl-nokey" class="[^"]*hidden/);
  });
});

describe('desktop title bar', () => {
  const base = {
    nonce: 'abc',
    aiConfigured: false,
    aiProviderLabel: '',
    aiModel: 'gemini-3.5-flash-lite',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: false,
    openSubtitlesLoginConfigured: false,
    openSubtitlesUsername: '',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl:
      'https://web.stremio.com/#/addons?addon=http%3A%2F%2F127.0.0.1%3A7000%2Fmanifest.json',
    stremioReady: true,
    rtlFix: false,
  };

  it('is only rendered inside the desktop window', () => {
    expect(renderStatusPage(base)).not.toContain('לסגור את החלון?');
    expect(renderStatusPage({ ...base, desktop: true })).toContain('לסגור את החלון?');
  });

  it('has minimize, maximize and close controls', () => {
    const html = renderStatusPage({ ...base, desktop: true });
    for (const id of ['win-min', 'win-max', 'win-close']) expect(html).toContain('id="' + id + '"');
  });

  it('offers tray and quit choices in the exit modal', () => {
    const html = renderStatusPage({ ...base, desktop: true });
    expect(html).toContain('סגור את החלון והמשך לעבוד ברקע');
    expect(html).toContain('כבה את האפליקציה');
  });

  it('no longer mentions .env', () => {
    expect(page).not.toContain('.env');
  });
});

describe('simplified settings', () => {
  it('has no model picker and one generic key field', () => {
    expect(page).not.toContain('id="model"');
    expect(page).not.toContain('Gemini model');
    expect(page).toContain('מפתח API של ספק ה-AI');
    expect(page).not.toContain('Gemini API key');
  });

  it('accepts any key text: no prefix rules in the page', () => {
    expect(page).not.toContain('startsWith');
    expect(page).not.toContain('KEY_RULES');
    expect(page).not.toContain("doesn't look like a valid API key");
    expect(page).toContain('id="w-next"'); // the wizard's Continue button verifies and saves keys
    expect(page).toContain('מאמת את המפתח...');
  });

  it('opens the install link in the browser', () => {
    expect(page).toContain('id="install"');
    expect(page).toContain('target="_blank"');
    expect(page).not.toContain('window.desktop.openStremio');
  });
});

describe('premium features', () => {
  it('has the dual subtitles toggle, cache button and live status card', () => {
    expect(page).toContain('כתוביות כפולות (אנגלית + שפת היעד)');
    expect(page).toContain('id="dual"');
    expect(page).toContain('נקה מטמון תרגומים');
    expect(page).toContain('ממתין ל-Stremio...');
    expect(page).toContain('שורות כתוביות שתורגמו בסשן הזה');
    expect(page).toContain('id="st-progress"');
    expect(page).toContain(' מתוך ');
  });

  it('uses the focused setup wizard with a five-step progress bar and a settings drawer', () => {
    for (let n = 1; n <= 5; n++) {
      expect(page).toContain(`data-pane="${n}"`);
      expect(page).toContain(`data-bar="${n}"`);
    }
    expect(page).toContain('id="w-next"');
    expect(page).toContain('id="drawer"');
    expect(page).toContain('הרץ את האשף מחדש');
  });
});

describe('setup wizard start', () => {
  const base = {
    nonce: 'abc',
    aiConfigured: false,
    aiProviderLabel: '',
    aiModel: 'm',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: false,
    openSubtitlesLoginConfigured: false,
    openSubtitlesUsername: '',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/',
    stremioReady: true,
    rtlFix: false,
  };

  it('opens at the AI key step when no key is saved', () => {
    const html = renderStatusPage(base);
    expect(html).toContain('let step = 1;');
    expect(html).toMatch(/id="wizard" class="flex/);
    expect(html).toMatch(/id="dash" class="hidden/);
  });

  it('opens at the OpenSubtitles step when only the AI key is saved', () => {
    expect(renderStatusPage({ ...base, aiConfigured: true })).toContain('let step = 2;');
  });

  it('shows the dashboard once every key is saved', () => {
    const html = renderStatusPage({
      ...base,
      aiConfigured: true,
      openSubtitlesKeyConfigured: true,
      openSubtitlesLoginConfigured: true,
    });
    expect(html).toMatch(/id="wizard" class="hidden/);
    expect(html).toMatch(/id="dash" class="flex/);
    expect(html).toContain('הכול מוכן');
  });
});

describe('Hebrew interface', () => {
  it('is Hebrew and right-to-left, with the window title bar kept left-to-right', () => {
    expect(page).toContain('<html lang="he" dir="rtl"');
    expect(page).toContain('עברית (he)'); // language names shown in Hebrew
    const html = renderStatusPage({ ...base(), desktop: true });
    expect(html).toContain('<div dir="ltr" class="drag');
  });

  it('has a Hebrew message for every error code and keeps the English server text out', () => {
    for (const code of Object.keys(ERROR_META)) {
      expect(ERROR_MESSAGES_HE[code as keyof typeof ERROR_MESSAGES_HE]).toMatch(/[א-ת]/);
    }
    expect(page).toContain(ERROR_MESSAGES_HE.INVALID_API_KEY);
  });
});

function base() {
  return {
    nonce: 'abc',
    aiConfigured: false,
    aiProviderLabel: '',
    aiModel: 'm',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: false,
    openSubtitlesLoginConfigured: false,
    openSubtitlesUsername: '',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/',
    stremioReady: true,
    rtlFix: false,
  };
}

describe('start with Windows, key-gated checks and the progress bar', () => {
  const base = {
    nonce: 'abc',
    aiConfigured: true,
    aiProviderLabel: 'Google Gemini',
    aiModel: 'm',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: true,
    openSubtitlesLoginConfigured: true,
    openSubtitlesUsername: 'u',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/#/addons',
    stremioReady: true,
    rtlFix: false,
  };

  it('offers the two startup switches in settings and a sixth wizard step only in the desktop app', () => {
    const desktop = renderStatusPage({ ...base, desktop: true });
    expect(desktop).toContain('id="d-startup"');
    expect(desktop).toContain('id="d-minimized"');
    expect(desktop).toContain('id="w-startup"');
    expect(desktop).toContain('data-pane="6"');
    expect(desktop.match(/data-bar="\d"/g)).toHaveLength(6);
    const browser = renderStatusPage(base);
    expect(browser).not.toContain('id="d-startup"');
    expect(browser).not.toContain('data-pane="6"');
    expect(browser.match(/data-bar="\d"/g)).toHaveLength(5);
  });

  it('hides the SubDL and Jimaku checks until their key is set', () => {
    const none = renderStatusPage(base);
    expect(none.match(/data-check-row="subdl" class="hidden /g)).toHaveLength(2);
    expect(none.match(/data-check-row="jimaku" class="hidden /g)).toHaveLength(2);
    const keyed = renderStatusPage({
      ...base,
      subdlKeyConfigured: true,
      jimakuKeyConfigured: true,
    });
    expect(keyed).not.toMatch(/data-check-row="(subdl|jimaku)" class="hidden /);
    expect(keyed.match(/data-check-row="subdl"/g)).toHaveLength(2);
  });

  it('moves the progress bars without a width animation, so they do not wobble', () => {
    const bar = /id="st-progress" class="([^"]*)"/.exec(page)?.[1] ?? '';
    const sync = /id="st-sync-fill" class="([^"]*)"/.exec(page)?.[1] ?? '';
    expect(bar).not.toContain('transition');
    expect(sync).not.toContain('transition');
    expect(page).toContain('id="st-progress-eta"');
    expect(page).toContain('id="st-total-eta"');
  });
});

describe('unsaved changes in the settings drawer', () => {
  const html = renderStatusPage({
    nonce: 'abc',
    aiConfigured: true,
    aiProviderLabel: 'Google Gemini',
    aiModel: 'm',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: true,
    openSubtitlesLoginConfigured: true,
    openSubtitlesUsername: 'u',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/#/addons',
    stremioReady: true,
    rtlFix: false,
    desktop: true,
  });

  it('offers the library download as two icon buttons: subtitles, and a video menu with MKV and MP4', () => {
    expect(html).toContain('libSubsBtn');
    expect(html).toContain("muxOption('MKV'");
    expect(html).toContain("muxOption('MP4'");
    expect(html).not.toContain('libMuxMp4)');
  });

  it('shows the eye button of a password field only once something is typed', () => {
    expect(html).toContain('top-1/2 hidden h-8 w-8');
    expect(html).toContain("b.classList.toggle('hidden', !has)");
  });

  it('gives clickable controls the hand cursor', () => {
    expect(html).toContain('select,button,summary');
    expect(html).toContain('cursor:pointer');
  });

  it('has a page script that is valid JavaScript', () => {
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1] ?? '');
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new Script(code)).not.toThrow();
  });

  it('shows the three timing kinds in different colors, each with its own icon', () => {
    for (const hex of ['#4cc38a', '#5aa9f0', '#f08a4b']) expect(html).toContain(hex);
    expect(html).not.toContain('border-amber-400 text-amber-400');
  });

  it('follows a video save with a thin bar, a cancel button, and a done row with folder and close', () => {
    for (const part of ["'/api/mux/'", "'/cancel'", 'libReady', 'revealVideo', 'libCancel']) {
      expect(html).toContain(part);
    }
  });

  it('asks to save, discard or keep editing before closing with changes', () => {
    for (const id of ['unsaved-modal', 'unsaved-save', 'unsaved-discard', 'unsaved-stay']) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it('does not save the startup switches by itself: only the Save button applies them', () => {
    expect(html).toContain("wireStartup('d-startup', 'd-minimized', false);");
    expect(html).toContain("startupApi.set($('d-startup').checked, $('d-minimized').checked)");
  });
});

describe('developer settings', () => {
  const base = {
    nonce: 'abc',
    aiConfigured: true,
    aiProviderLabel: 'Google Gemini',
    aiModel: 'm',
    dualSubtitles: false,
    openSubtitlesKeyConfigured: true,
    openSubtitlesLoginConfigured: true,
    openSubtitlesUsername: 'u',
    languages: [{ code: 'he', name: 'Hebrew' }],
    targetLanguage: 'he',
    manifestUrl: 'http://127.0.0.1:7000/manifest.json',
    installUrl: 'https://web.stremio.com/#/addons',
    stremioReady: true,
    rtlFix: false,
  };

  it('are hidden from users, but the page still works', () => {
    const html = renderStatusPage(base);
    expect(html).toMatch(/<details hidden[^>]*>[\s\S]*?id="dev-sound"/);
  });

  it('are shown when the author turns them on', () => {
    const html = renderStatusPage({ ...base, devSettings: true });
    expect(html).not.toMatch(/<details hidden[^>]*>[\s\S]*?id="dev-sound"/);
    expect(html).toContain('id="dev-sound"');
  });
});
