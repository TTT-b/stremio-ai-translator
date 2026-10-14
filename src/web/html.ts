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
        `<option value="${escapeHtml(m)}"${m === d.model ? ' selected' : ''}>${escapeHtml(m)}</option>`,
    )
    .join('');

  const install = d.stremioReady
    ? `<p><a class="btn primary" href="${escapeHtml(d.installUrl)}">Install in Stremio</a></p>
       <p class="row"><input id="manifest" readonly value="${escapeHtml(d.manifestUrl)}" aria-label="Manifest URL">
       <button type="button" id="copy">Copy</button></p>`
    : `<p class="muted">The Stremio add-on endpoint is not enabled yet (built in a later phase).
       The install link will be: <code>${escapeHtml(d.installUrl)}</code></p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>AI Subtitle Translator</title>
<style nonce="${escapeHtml(d.nonce)}">
 :root{--bg:#0d1117;--card:#161b22;--border:#30363d;--text:#e6edf3;--muted:#9da7b3;--accent:#58a6ff;--ok:#3fb950;--bad:#ff7b72;--field:#0d1117}
 *{box-sizing:border-box}
 body{margin:0;background:var(--bg);color:var(--text);font:16px/1.55 system-ui,'Segoe UI',sans-serif;color-scheme:dark}
 main{max-width:780px;margin:0 auto;padding:2rem 1rem 4rem}
 h1{font-size:1.6rem;margin:0 0 .25rem} h2{font-size:1.1rem;margin:0 0 .75rem}
 .sub{color:var(--muted);margin:0 0 1.5rem}
 section{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:1.1rem 1.3rem;margin:1rem 0}
 .muted{color:var(--muted)} code{background:#21262d;padding:.1rem .35rem;border-radius:4px;word-break:break-all}
 .badge{display:inline-block;padding:.05rem .6rem;border-radius:999px;font-size:.85rem;font-weight:600;border:1px solid}
 .badge.ok{color:var(--ok);border-color:var(--ok)} .badge.bad{color:var(--bad);border-color:var(--bad)}
 label{display:block;margin:.6rem 0 .2rem;font-weight:600}
 input,select{width:100%;padding:.55rem .7rem;background:var(--field);color:var(--text);border:1px solid var(--border);border-radius:8px;font:inherit}
 input:focus,select:focus,button:focus-visible,.btn:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
 ::placeholder{color:#6e7681}
 button,.btn{font:inherit;padding:.5rem 1rem;border-radius:8px;border:1px solid var(--border);background:#21262d;color:var(--text);cursor:pointer;text-decoration:none;display:inline-block}
 button:hover,.btn:hover{border-color:var(--accent)}
 .primary{background:#1f6feb;border-color:#1f6feb;color:#fff}
 .row{display:flex;gap:.5rem;align-items:center;flex-wrap:wrap} .row input{flex:1;min-width:200px}
 .result{margin-left:.5rem;font-weight:600} .result.ok{color:var(--ok)} .result.bad{color:var(--bad)}
 pre{background:var(--field);border:1px solid var(--border);padding:.75rem;border-radius:8px;white-space:pre-wrap;max-height:260px;overflow:auto}
 ul{padding-left:1.2rem}
</style></head><body><main>
<h1>AI Subtitle Translator</h1>
<p class="sub">Local add-on for Stremio &middot; runs only on this computer</p>

<section><h2>API keys</h2>
<ul>
<li>Gemini API key: ${badge(d.geminiConfigured)}</li>
<li>OpenSubtitles API key: ${badge(d.openSubtitlesKeyConfigured)}</li>
<li>OpenSubtitles login${d.openSubtitlesUsername ? ` (<code>${escapeHtml(d.openSubtitlesUsername)}</code>)` : ''}: ${badge(d.openSubtitlesLoginConfigured)}</li>
</ul>
<form id="keys" autocomplete="off">
<label for="k-gemini">Gemini API key</label>
<input id="k-gemini" type="password" autocomplete="off" placeholder="${d.geminiConfigured ? 'saved - leave empty to keep' : 'paste key'}">
<label for="k-os">OpenSubtitles API key</label>
<input id="k-os" type="password" autocomplete="off" placeholder="${d.openSubtitlesKeyConfigured ? 'saved - leave empty to keep' : 'paste key'}">
<label for="k-user">OpenSubtitles username</label>
<input id="k-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? 'saved - leave empty to keep' : 'your opensubtitles.com username'}">
<label for="k-pass">OpenSubtitles password</label>
<input id="k-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? 'saved - leave empty to keep' : 'your opensubtitles.com password'}">
<p><button type="submit" class="primary">Save keys</button><span class="result" id="keys-result"></span></p>
</form>
<p class="muted">Keys are written to the local <code>.env</code> file and are never displayed again.</p>
</section>

<section><h2>Settings</h2>
<label for="lang">Target language</label><select id="lang">${langOptions}</select>
<label for="model">Gemini model</label><select id="model">${modelOptions}</select>
<p><button type="button" id="save">Save settings</button><span class="result" id="save-result"></span></p>
<p class="muted">RTL punctuation fix: ${d.rtlFix ? 'on' : 'off'} (set RTL_FIX in .env).</p>
</section>

<section><h2>Test connections</h2>
<p><button type="button" data-test="gemini">Test Gemini</button><span class="result" id="r-gemini"></span></p>
<p><button type="button" data-test="opensubtitles">Test OpenSubtitles</button><span class="result" id="r-opensubtitles"></span></p>
<p><button type="button" id="sample">Translate built-in sample</button><span class="result" id="r-sample"></span></p>
<pre id="sample-out" hidden></pre>
</section>

<section><h2>Install</h2>${install}</section>

<section><h2>Notice</h2>
<p class="muted">Subtitle text is sent to Google Gemini for translation. API quotas, billing and
free-tier data-use terms are controlled by the providers (Google, OpenSubtitles), not by this add-on.</p>
</section>
</main>
<script nonce="${escapeHtml(d.nonce)}">
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(r => r.json());
const show = (id, ok, msg) => { const el = document.getElementById(id); el.textContent = (ok ? '\\u2714 ' : '\\u2716 ') + msg; el.className = 'result ' + (ok ? 'ok' : 'bad'); };
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  const name = b.dataset.test; show('r-' + name, true, 'testing...');
  try { const r = await post('/api/test/' + name); show('r-' + name, r.ok, r.message); }
  catch { show('r-' + name, false, 'request failed'); }
}));
document.getElementById('save').addEventListener('click', async () => {
  try {
    const r = await post('/api/settings', {targetLanguage: document.getElementById('lang').value, geminiModel: document.getElementById('model').value});
    show('save-result', r.ok, r.ok ? 'saved' : r.message);
  } catch { show('save-result', false, 'request failed'); }
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
    if (r.ok) { for (const id of Object.values(fields)) document.getElementById(id).value = ''; setTimeout(() => location.reload(), 900); }
  } catch { show('keys-result', false, 'request failed'); }
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
if (copy) copy.addEventListener('click', () => navigator.clipboard.writeText(document.getElementById('manifest').value));
</script>
</body></html>`;
}
