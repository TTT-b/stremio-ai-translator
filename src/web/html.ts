import QRCode from 'qrcode';
import { DEFAULT_MODEL } from '../config/languages';

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface StatusPageData {
  nonce: string;
  geminiConfigured: boolean;
  openSubtitlesKeyConfigured: boolean;
  openSubtitlesLoginConfigured: boolean;
  /** Not secret: shown so the user can see which account is configured. */
  openSubtitlesUsername: string;
  languages: { code: string; name: string }[];
  models: string[];
  targetLanguage: string;
  model: string;
  manifestUrl: string;
  installUrl: string;
  stremioReady: boolean;
  rtlFix: boolean;
}

/** Inline SVG QR code, rendered server-side so the strict CSP needs no image or script sources. */
function qrSvg(text: string): string {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const n = qr.modules.size;
  const data = qr.modules.data;
  let path = '';
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (data[y * n + x]) path += `M${x + 4} ${y + 4}h1v1h-1z`;
    }
  }
  const size = n + 8;
  return `<svg class="qr" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for the manifest URL" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#0b0f17"/></svg>`;
}

const isLoopback = (url: string): boolean =>
  /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])[:/]/i.test(url);

const badge = (ok: boolean, yes = 'configured', no = 'missing') =>
  `<span class="badge ${ok ? 'ok' : 'bad'}">${ok ? yes : no}</span>`;

export function renderStatusPage(d: StatusPageData): string {
  const langOptions = d.languages
    .map(
      (l) =>
        `<option value="${escapeHtml(l.code)}"${l.code === d.targetLanguage ? ' selected' : ''}>${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`,
    )
    .join('');
  const modelList = d.models.includes(d.model) ? d.models : [d.model, ...d.models];
  const modelOptions = modelList
    .map(
      (m) =>
        `<option value="${escapeHtml(m)}"${m === d.model ? ' selected' : ''}>${escapeHtml(m)}${m === DEFAULT_MODEL ? ' (recommended)' : ''}</option>`,
    )
    .join('');

  const install = d.stremioReady
    ? `<p><a class="btn primary" href="${escapeHtml(d.installUrl)}">Install in Stremio</a></p>
       <p class="row"><input id="manifest" readonly value="${escapeHtml(d.manifestUrl)}" aria-label="Manifest URL">
       <button type="button" id="copy">Copy</button></p>
       <div class="qrbox">${qrSvg(d.manifestUrl)}
       <div><strong>Scan to install</strong>
       <p class="muted">Scan with a phone or TV camera to open the manifest URL.</p>
       ${
         isLoopback(d.manifestUrl)
           ? `<p class="warn">This address (<code>${escapeHtml(d.manifestUrl)}</code>) only works on this computer. A phone or TV needs this computer's network address instead, and the add-on must be reachable from it.</p>`
           : ''
       }</div></div>`
    : `<p class="muted">The Stremio add-on endpoint is not enabled yet (built in a later phase).
       The install link will be: <code>${escapeHtml(d.installUrl)}</code></p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>AI Subtitle Translator</title>
<style nonce="${escapeHtml(d.nonce)}">
 :root{--bg:#0b0f17;--card:#141a26;--border:#273045;--text:#e8edf5;--muted:#93a0b5;--accent:#6ea8ff;--accent-2:#4c82f7;--ok:#3ccf7a;--bad:#ff7b72;--field:#0e1420;--shadow:0 8px 28px rgba(0,0,0,.35)}
 *{box-sizing:border-box}
 body{margin:0;background:radial-gradient(1200px 500px at 50% -200px,#1b2740 0,var(--bg) 70%) no-repeat,var(--bg);color:var(--text);font:16px/1.6 system-ui,'Segoe UI',Roboto,sans-serif;color-scheme:dark}
 main{max-width:760px;margin:0 auto;padding:2.5rem 1rem 5rem}
 header{margin-bottom:1.5rem}
 h1{font-size:1.8rem;letter-spacing:-.02em;margin:0 0 .25rem}
 h2{font-size:1.05rem;margin:0 0 1rem}
 .sub{color:var(--muted);margin:0}
 section{background:var(--card);border:1px solid var(--border);border-radius:16px;padding:1.3rem 1.5rem;margin:1.1rem 0;box-shadow:var(--shadow)}
 .muted{color:var(--muted);font-size:.92rem} code{background:#1c2536;padding:.1rem .4rem;border-radius:6px;word-break:break-all;font-size:.9em}
 .badge{display:inline-block;padding:.05rem .65rem;border-radius:999px;font-size:.8rem;font-weight:600;border:1px solid}
 .badge.ok{color:var(--ok);border-color:var(--ok);background:rgba(60,207,122,.1)} .badge.bad{color:var(--bad);border-color:var(--bad);background:rgba(255,123,114,.1)}
 .status{list-style:none;padding:0;margin:0 0 1rem;display:grid;gap:.4rem}
 .status li{display:flex;justify-content:space-between;gap:1rem;padding:.5rem .8rem;background:var(--field);border:1px solid var(--border);border-radius:10px}
 .grid{display:grid;grid-template-columns:1fr 1fr;gap:0 1rem}
 @media(max-width:560px){.grid{grid-template-columns:1fr} section{padding:1.1rem}}
 label{display:block;margin:.8rem 0 .3rem;font-weight:600;font-size:.92rem}
 input,select{width:100%;padding:.65rem .8rem;background:var(--field);color:var(--text);border:1px solid var(--border);border-radius:10px;font:inherit;transition:border-color .15s,box-shadow .15s}
 input:focus,select:focus{outline:none;border-color:var(--accent);box-shadow:0 0 0 3px rgba(110,168,255,.25)}
 button:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
 ::placeholder{color:#5f6c82}
 button,.btn{font:inherit;font-weight:600;padding:.6rem 1.1rem;border-radius:10px;border:1px solid var(--border);background:#1c2536;color:var(--text);cursor:pointer;text-decoration:none;display:inline-block;transition:background .15s,border-color .15s,transform .05s}
 button:hover,.btn:hover{border-color:var(--accent)} button:active{transform:translateY(1px)}
 .primary{background:linear-gradient(180deg,var(--accent-2),#3a6fe0);border-color:var(--accent-2);color:#fff}
 .actions{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin:1rem 0 .25rem}
 .row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap} .row input{flex:1;min-width:200px}
 .result{font-weight:600} .result.ok{color:var(--ok)} .result.bad{color:var(--bad)}
 .test{display:flex;align-items:center;gap:.8rem;flex-wrap:wrap;margin:.5rem 0}
 pre{background:var(--field);border:1px solid var(--border);padding:.8rem;border-radius:10px;white-space:pre-wrap;max-height:260px;overflow:auto}
 .qrbox{display:flex;gap:1.2rem;align-items:center;flex-wrap:wrap;margin-top:1rem;padding:1rem;background:var(--field);border:1px solid var(--border);border-radius:12px}
 .qr{width:168px;height:168px;border-radius:10px;flex:none}
 .qrbox p{margin:.3rem 0}
 .warn{color:#ffd479;font-size:.9rem}
 section h2::before{content:'';display:inline-block;width:.55rem;height:.55rem;margin-right:.55rem;border-radius:3px;background:linear-gradient(135deg,var(--accent),#a78bfa);vertical-align:.05rem}
 #toast{position:fixed;left:50%;bottom:1.5rem;transform:translate(-50%,2rem);opacity:0;pointer-events:none;padding:.75rem 1.2rem;border-radius:12px;font-weight:600;box-shadow:var(--shadow);transition:opacity .25s,transform .25s;background:#12301f;border:1px solid var(--ok);color:#b9f5d0;max-width:90vw}
 #toast.bad{background:#35161a;border-color:var(--bad);color:#ffc9c4}
 #toast.show{opacity:1;transform:translate(-50%,0)}
 @media(prefers-reduced-motion:reduce){*{transition:none!important}}
</style></head><body><main>
<header><h1>AI Subtitle Translator</h1>
<p class="sub">Local add-on for Stremio &middot; runs only on this computer</p></header>

<section><h2>API keys</h2>
<ul class="status">
<li><span>Gemini API key</span>${badge(d.geminiConfigured)}</li>
<li><span>OpenSubtitles API key</span>${badge(d.openSubtitlesKeyConfigured)}</li>
<li><span>OpenSubtitles login${d.openSubtitlesUsername ? ` (<code>${escapeHtml(d.openSubtitlesUsername)}</code>)` : ''}</span>${badge(d.openSubtitlesLoginConfigured)}</li>
</ul>
<form id="keys" autocomplete="off"><div class="grid">
<div><label for="k-gemini">Gemini API key</label>
<input id="k-gemini" type="password" autocomplete="off" placeholder="${d.geminiConfigured ? 'saved - leave empty to keep' : 'paste key'}"></div>
<div><label for="k-os">OpenSubtitles API key</label>
<input id="k-os" type="password" autocomplete="off" placeholder="${d.openSubtitlesKeyConfigured ? 'saved - leave empty to keep' : 'paste key'}"></div>
<div><label for="k-user">OpenSubtitles username</label>
<input id="k-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? 'saved - leave empty to keep' : 'your opensubtitles.com username'}"></div>
<div><label for="k-pass">OpenSubtitles password</label>
<input id="k-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? 'saved - leave empty to keep' : 'your opensubtitles.com password'}"></div>
</div>
<div class="actions"><button type="submit" class="primary">Save keys</button><span class="result" id="keys-result"></span></div>
</form>
<p class="muted">Keys are written to the local <code>.env</code> file and are never displayed again.</p>
</section>

<section><h2>Settings</h2>
<div class="grid">
<div><label for="lang">Target language</label><select id="lang">${langOptions}</select></div>
<div><label for="model">Gemini model</label><select id="model">${modelOptions}</select></div>
</div>
<div class="actions"><button type="button" id="save" class="primary">Save settings</button><span class="result" id="save-result"></span></div>
<p class="muted">RTL punctuation fix: ${d.rtlFix ? 'on' : 'off'} (set RTL_FIX in .env).</p>
</section>

<section><h2>Test connections</h2>
<div class="test"><button type="button" data-test="gemini">Test Gemini</button><span class="result" id="r-gemini"></span></div>
<div class="test"><button type="button" data-test="opensubtitles">Test OpenSubtitles</button><span class="result" id="r-opensubtitles"></span></div>
<div class="test"><button type="button" id="sample">Translate built-in sample</button><span class="result" id="r-sample"></span></div>
<pre id="sample-out" hidden></pre>
</section>

<section><h2>Install</h2>${install}</section>

<section><h2>Notice</h2>
<p class="muted">Subtitle text is sent to Google Gemini for translation. API quotas, billing and
free-tier data-use terms are controlled by the providers (Google, OpenSubtitles), not by this add-on.</p>
</section>
</main>
<div id="toast" role="status" aria-live="polite"></div>
<script nonce="${escapeHtml(d.nonce)}">
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(r => r.json());
let toastTimer;
const toast = (ok, msg) => { const t = document.getElementById('toast'); t.textContent = (ok ? '\\u2714 ' : '\\u2716 ') + msg; t.className = 'show' + (ok ? '' : ' bad'); clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.className = ok ? '' : 'bad'; }, 3500); };
const show = (id, ok, msg) => { const el = document.getElementById(id); el.textContent = (ok ? '\\u2714 ' : '\\u2716 ') + msg; el.className = 'result ' + (ok ? 'ok' : 'bad'); };
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  const name = b.dataset.test; show('r-' + name, true, 'testing...');
  try { const r = await post('/api/test/' + name); show('r-' + name, r.ok, r.message); }
  catch { show('r-' + name, false, 'request failed'); }
}));
document.getElementById('save').addEventListener('click', async () => {
  try {
    const r = await post('/api/settings', {targetLanguage: document.getElementById('lang').value, geminiModel: document.getElementById('model').value});
    show('save-result', r.ok, r.ok ? 'Settings saved' : r.message);
    toast(r.ok, r.ok ? 'Settings saved' : r.message);
  } catch { show('save-result', false, 'request failed'); toast(false, 'Request failed'); }
});
document.getElementById('keys').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {geminiApiKey:'k-gemini', openSubtitlesApiKey:'k-os', openSubtitlesUsername:'k-user', openSubtitlesPassword:'k-pass'};
  const body = {};
  for (const [name, id] of Object.entries(fields)) { const v = document.getElementById(id).value.trim(); if (v) body[name] = v; }
  if (Object.keys(body).length === 0) { show('keys-result', false, 'nothing to save'); return; }
  try {
    const r = await post('/api/keys', body);
    show('keys-result', r.ok, r.message);
    toast(r.ok, r.message);
    if (r.ok) { for (const id of Object.values(fields)) document.getElementById(id).value = ''; setTimeout(() => location.reload(), 1200); }
  } catch { show('keys-result', false, 'request failed'); toast(false, 'Request failed'); }
});
document.getElementById('sample').addEventListener('click', async () => {
  show('r-sample', true, 'translating...');
  try {
    const r = await post('/api/dev/sample');
    show('r-sample', r.ok, r.message);
    const out = document.getElementById('sample-out');
    if (r.ok) { out.textContent = r.preview; out.hidden = false; } else { out.hidden = true; }
  } catch { show('r-sample', false, 'request failed'); }
});
const copy = document.getElementById('copy');
if (copy) copy.addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('manifest').value); toast(true, 'Manifest URL copied'); });
</script>
</body></html>`;
}
