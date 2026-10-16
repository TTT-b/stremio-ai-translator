import { describe, expect, it } from 'vitest';
import { renderStatusPage } from '../src/web/html';

const page = renderStatusPage({
  nonce: 'abc',
  geminiConfigured: true,
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
    geminiConfigured: false,
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
  it('has no model picker and warns on non-Google keys', () => {
    expect(page).not.toContain('id="model"');
    expect(page).not.toContain('Gemini model');
    expect(page).toContain("doesn't look like a valid Google API key");
    expect(page).toContain("startsWith('AIza')");
  });
});
