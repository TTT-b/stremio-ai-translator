import { readFileSync } from 'node:fs';
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

/** Locally built Tailwind CSS (npm run build:css), inlined so the page loads nothing external. */
const CSS = readFileSync(new URL('./tailwind.generated.css', import.meta.url), 'utf8').replace(
  /<\/style/gi,
  '<\\/style',
);

const card =
  'rounded-2xl border border-slate-700/60 bg-slate-900/70 p-6 shadow-xl shadow-black/30 backdrop-blur';
const field =
  'w-full rounded-xl border border-slate-700 bg-slate-950/70 px-3.5 py-2.5 text-slate-100 placeholder-slate-500 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30';
const labelCls = 'mb-1.5 block text-sm font-medium text-slate-300';
const btn =
  'rounded-xl border border-slate-600 bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:border-indigo-400 hover:bg-slate-700 active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400';
const btnPrimary =
  'rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-indigo-500/20 transition hover:-translate-y-0.5 hover:shadow-indigo-500/40 active:translate-y-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300';
const result = 'text-sm font-medium';

const badge = (ok: boolean, yes = 'configured', no = 'missing') =>
  `<span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
    ok
      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-300'
      : 'border-rose-500/40 bg-rose-500/10 text-rose-300'
  }"><span class="h-1.5 w-1.5 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}"></span>${ok ? yes : no}</span>`;

const heading = (title: string, hint = '') =>
  `<div class="mb-4"><h2 class="text-lg font-semibold text-white">${title}</h2>${
    hint ? `<p class="text-sm text-slate-400">${hint}</p>` : ''
  }</div>`;

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
    ? `<a class="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 px-6 py-4 text-lg font-bold text-white shadow-xl shadow-indigo-500/30 transition duration-200 hover:-translate-y-1 hover:scale-[1.02] hover:shadow-2xl hover:shadow-fuchsia-500/40 active:scale-100 focus:outline-none focus-visible:ring-4 focus-visible:ring-indigo-300 sm:w-auto" href="${escapeHtml(d.installUrl)}">
         <span>Install in Stremio</span><span class="transition-transform duration-200 group-hover:translate-x-1" aria-hidden="true">&rarr;</span></a>
       <p class="mt-5 text-sm text-slate-400">Or paste this address in Stremio &rarr; Add-ons:</p>
       <div class="mt-2 flex flex-col gap-2 sm:flex-row">
         <input id="manifest" readonly class="${field} font-mono text-sm" value="${escapeHtml(d.manifestUrl)}" aria-label="Manifest URL">
         <button type="button" id="copy" class="${btn}">Copy</button>
       </div>
       <p class="mt-3 text-xs text-amber-300/90">This address only works on this computer.</p>`
    : `<p class="text-sm text-slate-400">The Stremio add-on endpoint is not enabled yet.
       The install link will be: <code class="rounded bg-slate-800 px-1.5 py-0.5">${escapeHtml(d.installUrl)}</code></p>`;

  return `<!doctype html>
<html lang="en" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>AI Subtitle Translator</title>
<style nonce="${escapeHtml(d.nonce)}">${CSS}</style></head>
<body class="min-h-screen bg-[radial-gradient(900px_450px_at_50%_-120px,rgba(99,102,241,.28),transparent)] font-sans text-slate-200 antialiased">
<main class="mx-auto max-w-3xl px-4 pb-24 pt-12">
<header class="mb-8 text-center sm:text-left">
  <div class="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">Local &middot; runs only on this computer</div>
  <h1 class="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">AI Subtitle Translator</h1>
  <p class="mt-2 text-slate-400">Translate Stremio subtitles with Gemini, on demand.</p>
</header>

<div class="space-y-6">

<section class="${card}">${heading('API keys', 'Stored in the local .env file and never shown again.')}
<ul class="mb-5 grid gap-2">
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">Gemini API key</span>${badge(d.geminiConfigured)}</li>
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">OpenSubtitles API key</span>${badge(d.openSubtitlesKeyConfigured)}</li>
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">OpenSubtitles login${d.openSubtitlesUsername ? ` (<span class="font-mono">${escapeHtml(d.openSubtitlesUsername)}</span>)` : ''}</span>${badge(d.openSubtitlesLoginConfigured)}</li>
</ul>
<form id="keys" autocomplete="off">
<div class="grid gap-4 sm:grid-cols-2">
<div><label class="${labelCls}" for="k-gemini">Gemini API key</label>
<input class="${field}" id="k-gemini" type="password" autocomplete="off" placeholder="${d.geminiConfigured ? 'saved - leave empty to keep' : 'paste key'}"></div>
<div><label class="${labelCls}" for="k-os">OpenSubtitles API key</label>
<input class="${field}" id="k-os" type="password" autocomplete="off" placeholder="${d.openSubtitlesKeyConfigured ? 'saved - leave empty to keep' : 'paste key'}"></div>
<div><label class="${labelCls}" for="k-user">OpenSubtitles username</label>
<input class="${field}" id="k-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? 'saved - leave empty to keep' : 'your opensubtitles.com username'}"></div>
<div><label class="${labelCls}" for="k-pass">OpenSubtitles password</label>
<input class="${field}" id="k-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? 'saved - leave empty to keep' : 'your opensubtitles.com password'}"></div>
</div>
<div class="mt-5 flex flex-wrap items-center gap-3"><button type="submit" class="${btnPrimary}">Save keys</button><span class="${result}" id="keys-result"></span></div>
</form>
</section>

<section class="${card}">${heading('Preferences', `RTL punctuation fix: ${d.rtlFix ? 'on' : 'off'} (set RTL_FIX in .env).`)}
<div class="grid gap-4 sm:grid-cols-2">
<div><label class="${labelCls}" for="lang">Target language</label><select class="${field}" id="lang">${langOptions}</select></div>
<div><label class="${labelCls}" for="model">Gemini model</label><select class="${field}" id="model">${modelOptions}</select></div>
</div>
<div class="mt-5 flex flex-wrap items-center gap-3"><button type="button" id="save" class="${btnPrimary}">Save settings</button><span class="${result}" id="save-result"></span></div>
</section>

<section class="${card}">${heading('Test connections')}
<div class="space-y-3">
<div class="flex flex-wrap items-center gap-3"><button type="button" class="${btn}" data-test="gemini">Test Gemini</button><span class="${result}" id="r-gemini"></span></div>
<div class="flex flex-wrap items-center gap-3"><button type="button" class="${btn}" data-test="opensubtitles">Test OpenSubtitles</button><span class="${result}" id="r-opensubtitles"></span></div>
<div class="flex flex-wrap items-center gap-3"><button type="button" class="${btn}" id="sample">Translate built-in sample</button><span class="${result}" id="r-sample"></span></div>
</div>
<pre id="sample-out" hidden class="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm"></pre>
</section>

<section class="${card} border-indigo-400/30">${heading('Installation', 'Keep this program running while you watch.')}${install}</section>

<p class="px-1 text-center text-xs text-slate-500">Subtitle text is sent to Google Gemini for translation. API quotas, billing and
free-tier data-use terms are controlled by the providers (Google, OpenSubtitles), not by this add-on.</p>
</div>
</main>
<div id="toast" role="status" aria-live="polite" class="pointer-events-none fixed bottom-6 left-1/2 max-w-[90vw] -translate-x-1/2 translate-y-8 rounded-xl border px-5 py-3 text-sm font-semibold opacity-0 shadow-2xl transition duration-300"></div>
<script nonce="${escapeHtml(d.nonce)}">
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(r => r.json());
const TONE = {ok:'text-emerald-400', bad:'text-rose-400'};
let toastTimer;
const toast = (ok, msg) => {
  const t = document.getElementById('toast');
  t.textContent = (ok ? '\\u2714 ' : '\\u2716 ') + msg;
  t.className = 'pointer-events-none fixed bottom-6 left-1/2 max-w-[90vw] -translate-x-1/2 rounded-xl border px-5 py-3 text-sm font-semibold shadow-2xl transition duration-300 translate-y-0 opacity-100 ' +
    (ok ? 'border-emerald-500/50 bg-emerald-950 text-emerald-200' : 'border-rose-500/50 bg-rose-950 text-rose-200');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('translate-y-0', 'opacity-100'); t.classList.add('translate-y-8', 'opacity-0'); }, 3500);
};
const show = (id, ok, msg) => { const el = document.getElementById(id); el.textContent = (ok ? '\\u2714 ' : '\\u2716 ') + msg; el.className = '${result} ' + (ok ? TONE.ok : TONE.bad); };
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
