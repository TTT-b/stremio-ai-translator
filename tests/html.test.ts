import { describe, expect, it } from 'vitest';
import { renderStatusPage } from '../src/web/html';

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
  installUrl: 'stremio://127.0.0.1:7000/manifest.json',
  stremioReady: true,
  rtlFix: false,
});

describe('config page', () => {
  it('loads nothing external and has no QR code', () => {
    expect(page).not.toMatch(/<script[^>]*\ssrc=/i);
    expect(page).not.toMatch(/<link[^>]*rel=["']?stylesheet/i);
    expect(page).not.toMatch(/(src|href)=["']https?:\/\/(?!127\.0\.0\.1)/i);
    expect(page).not.toMatch(/cdn\.tailwindcss\.com|<svg/i);
  });

  it('inlines the locally built CSS with the nonce', () => {
    expect(page).toMatch(/<style nonce="abc">[^<]*\.rounded-2xl/);
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
    installUrl: 'stremio://127.0.0.1:7000/manifest.json',
    stremioReady: true,
    rtlFix: false,
  };

  it('is only rendered inside the desktop window', () => {
    expect(renderStatusPage(base)).not.toContain('Close the Translator?');
    expect(renderStatusPage({ ...base, desktop: true })).toContain('Close the Translator?');
  });

  it('has minimize, maximize and close controls', () => {
    const html = renderStatusPage({ ...base, desktop: true });
    for (const id of ['win-min', 'win-max', 'win-close']) expect(html).toContain('id="' + id + '"');
  });

  it('offers tray and quit choices in the exit modal', () => {
    const html = renderStatusPage({ ...base, desktop: true });
    expect(html).toContain('Minimize to System Tray');
    expect(html).toContain('Quit Program');
  });

  it('no longer mentions .env', () => {
    expect(page).not.toContain('.env');
  });
});

describe('simplified settings', () => {
  it('has no model picker and one generic key field', () => {
    expect(page).not.toContain('id="model"');
    expect(page).not.toContain('Gemini model');
    expect(page).toContain('AI Provider API Key');
    expect(page).not.toContain('Gemini API key');
  });

  it('accepts any key text: no prefix rules in the page', () => {
    expect(page).not.toContain('startsWith');
    expect(page).not.toContain('KEY_RULES');
    expect(page).not.toContain("doesn't look like a valid API key");
    expect(page).toContain('id="save-keys"');
    expect(page).toContain('verifying key...');
  });

  it('hands the install link to the desktop app', () => {
    expect(page).toContain('id="install"');
    expect(page).toContain('window.desktop.openStremio');
  });
});

describe('premium features', () => {
  it('has the dual subtitles toggle, cache button and live status card', () => {
    expect(page).toContain('Dual Subtitles (English + Target Language)');
    expect(page).toContain('id="dual"');
    expect(page).toContain('Clear Translation Cache');
    expect(page).toContain('Waiting for Stremio...');
    expect(page).toContain('Subtitle lines translated this session');
  });

  it('uses a two-column grid on wide screens', () => {
    expect(page).toContain('xl:grid-cols-2');
    expect(page).toContain('xl:max-w-7xl');
  });
});
