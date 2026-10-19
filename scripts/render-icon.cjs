// Draws the app icon (warm dark tile, amber speech bubble with subtitle lines) and saves it as
// icon.png (256x256). Uses Electron's own renderer, so it needs no extra dependency.
// Run with: npx electron scripts/render-icon.cjs   (then: npm run icon)
/* eslint-disable no-undef, @typescript-eslint/no-require-imports -- CommonJS run by Electron, not part of the app */
const { app, BrowserWindow } = require('electron');
const { writeFileSync } = require('node:fs');
const { join } = require('node:path');

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2a231a"/><stop offset="1" stop-color="#15120e"/></linearGradient>
<linearGradient id="am" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f3c374"/><stop offset="1" stop-color="#e8b25c"/></linearGradient>
</defs>
<rect x="8" y="8" width="240" height="240" rx="56" fill="url(#bg)" stroke="#352e25" stroke-width="3"/>
<path d="M62 78 H170 a22 22 0 0 1 22 22 V150 a22 22 0 0 1 -22 22 H128 L100 202 V172 H62 a22 22 0 0 1 -22 -22 V100 a22 22 0 0 1 22 -22 Z" fill="none" stroke="url(#am)" stroke-width="12" stroke-linejoin="round"/>
<rect x="64" y="108" width="52" height="11" rx="5.5" fill="#f3ece1"/>
<rect x="124" y="108" width="40" height="11" rx="5.5" fill="url(#am)"/>
<rect x="64" y="134" width="30" height="11" rx="5.5" fill="url(#am)"/>
<rect x="102" y="134" width="62" height="11" rx="5.5" fill="#f3ece1"/>
<path d="M206 40 C208 56 214 62 230 64 C214 66 208 72 206 88 C204 72 198 66 182 64 C198 62 204 56 206 40 Z" fill="url(#am)"/>
<path d="M226 84 C227 91 230 94 237 95 C230 96 227 99 226 106 C225 99 222 96 215 95 C222 94 225 91 226 84 Z" fill="#f3ece1"/>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 256,
    height: 256,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true },
  });
  const html = `<html><body style="margin:0;background:transparent;overflow:hidden">${SVG}</body></html>`;
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 400));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 256, height: 256 });
  const size = image.getSize();
  if (size.width !== 256 || size.height !== 256) {
    console.error('Unexpected size', size);
    process.exit(1);
  }
  writeFileSync(join(__dirname, '..', 'icon.png'), image.toPNG());
  console.log('icon.png written');
  app.quit();
});
