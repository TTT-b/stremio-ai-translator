import { describe, expect, it } from 'vitest';
import { renderStatusPage } from '../src/web/html';

const page = renderStatusPage({
  nonce: 'abc',
  geminiConfigured: true,
  openSubtitlesKeyConfigured: false,
  openSubtitlesLoginConfigured: false,
  openSubtitlesUsername: '',
  languages: [{ code: 'he', name: 'Hebrew' }],
  models: ['m1'],
  targetLanguage: 'he',
  model: 'm1',
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
