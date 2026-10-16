import { readFileSync } from 'node:fs';
import { PROVIDERS } from '../translation/providers';

/** Replaced at build time by scripts/build-electron.mjs; undefined when running from source. */
declare const __TAILWIND_CSS__: string | undefined;

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
  aiConfigured: boolean;
  /** Provider detected from the saved key, e.g. "Google Gemini"; empty when none. */
  aiProviderLabel: string;
  aiModel: string;
  dualSubtitles: boolean;
  openSubtitlesKeyConfigured: boolean;
  openSubtitlesLoginConfigured: boolean;
  /** Not secret: shown so the user can see which account is configured. */
  openSubtitlesUsername: string;
  languages: { code: string; name: string }[];
  targetLanguage: string;
  manifestUrl: string;
  installUrl: string;
  stremioReady: boolean;
  rtlFix: boolean;
  /** True inside the Electron desktop window: renders the custom title bar. */
  desktop?: boolean;
}

/** Locally built Tailwind CSS (npm run build:css), inlined so the page loads nothing external. */
const CSS = (
  typeof __TAILWIND_CSS__ === 'string'
    ? __TAILWIND_CSS__ // embedded by scripts/build-electron.mjs
    : readFileSync(new URL('./tailwind.generated.css', import.meta.url), 'utf8')
).replace(/<\/style/gi, '<\\/style');

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

const winBtn =
  'no-drag flex h-9 w-12 items-center justify-center text-slate-400 transition hover:bg-slate-700/60 hover:text-white focus:outline-none';
/** Custom title bar for the frameless desktop window (drag area + minimize / close-to-tray). */
const titleBar = `<div class="drag fixed inset-x-0 top-0 z-50 flex h-9 items-center justify-between border-b border-slate-800 bg-slate-950/95 backdrop-blur">
<div class="flex items-center gap-2 pl-3 text-xs font-medium text-slate-400"><span class="h-2.5 w-2.5 rounded-full bg-gradient-to-br from-indigo-400 to-fuchsia-500"></span>AI Subtitle Translator</div>
<div class="flex"><button type="button" id="win-min" class="${winBtn}" aria-label="Minimize"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 5h10" stroke="currentColor"/></svg></button>
<button type="button" id="win-max" class="${winBtn}" aria-label="Maximize"><svg width="10" height="10" viewBox="0 0 10 10" fill="none"><rect id="win-max-icon" x=".5" y=".5" width="9" height="9" stroke="currentColor"/></svg></button>
<button type="button" id="win-close" class="${winBtn} hover:!bg-rose-600" aria-label="Close"><svg width="10" height="10" viewBox="0 0 10 10"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></button></div></div>
<div id="exit-modal" class="no-drag fixed inset-0 z-[60] hidden items-center justify-center bg-slate-950/80 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="exit-title">
<div class="w-full max-w-sm rounded-2xl border border-slate-700/70 bg-slate-900 p-6 shadow-2xl shadow-black/60">
<h2 id="exit-title" class="text-lg font-semibold text-white">Close the Translator?</h2>
<p class="mt-1 text-sm text-slate-400">Minimizing keeps translations running in the background.</p>
<div class="mt-5 grid gap-2">
<button type="button" id="exit-tray" class="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300">Minimize to System Tray</button>
<button type="button" id="exit-quit" class="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">Quit Program</button>
<button type="button" id="exit-cancel" class="px-4 py-2 text-sm text-slate-400 transition hover:text-white focus:outline-none">Cancel</button>
</div></div></div>`;

export function renderStatusPage(d: StatusPageData): string {
  const langOptions = d.languages
    .map(
      (l) =>
        `<option value="${escapeHtml(l.code)}"${l.code === d.targetLanguage ? ' selected' : ''}>${escapeHtml(l.name)} (${escapeHtml(l.code)})</option>`,
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
${d.desktop ? titleBar : ''}
<main class="mx-auto max-w-3xl px-4 pb-24 xl:max-w-7xl ${d.desktop ? 'pt-20' : 'pt-12'}">
<header class="mb-8 text-center sm:text-left">
  <div class="mb-3 inline-flex items-center gap-2 rounded-full border border-indigo-400/30 bg-indigo-500/10 px-3 py-1 text-xs font-medium text-indigo-300">Local &middot; runs only on this computer</div>
  <h1 class="bg-gradient-to-r from-white to-indigo-300 bg-clip-text text-3xl font-extrabold tracking-tight text-transparent sm:text-4xl">AI Subtitle Translator</h1>
  <p class="mt-2 text-slate-400">Translate Stremio subtitles with AI, on demand.</p>
</header>

<div class="grid grid-cols-1 gap-6 xl:grid-cols-2 xl:items-start">
<div class="space-y-6">

<section class="${card}">${heading('API keys', 'Stored securely on your local machine. Never shown again.')}
<ul class="mb-5 grid gap-2">
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">AI provider API key</span>${badge(d.aiConfigured, d.aiProviderLabel || 'configured')}</li>
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">OpenSubtitles API key</span>${badge(d.openSubtitlesKeyConfigured)}</li>
<li class="flex items-center justify-between gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-2.5"><span class="text-sm">OpenSubtitles login${d.openSubtitlesUsername ? ` (<span class="font-mono">${escapeHtml(d.openSubtitlesUsername)}</span>)` : ''}</span>${badge(d.openSubtitlesLoginConfigured)}</li>
</ul>
<form id="keys" autocomplete="off">
<div class="grid gap-4 sm:grid-cols-2">
<div class="sm:col-span-2"><label class="${labelCls}" for="k-ai">AI Provider API Key</label>
<input class="${field}" id="k-ai" type="password" autocomplete="off" placeholder="${d.aiConfigured ? 'saved - leave empty to keep' : 'paste your Gemini, Claude or OpenAI key'}">
<p id="k-ai-hint" class="mt-1.5 hidden text-xs text-emerald-300"></p>
<p id="k-ai-warn" class="mt-1.5 hidden text-xs text-amber-300" role="alert">This doesn't look like a valid API key. Google keys start with "AIza", Anthropic keys with "sk-ant", OpenAI keys with "sk-".</p></div>
<div><label class="${labelCls}" for="k-os">OpenSubtitles API key</label>
<input class="${field}" id="k-os" type="password" autocomplete="off" placeholder="${d.openSubtitlesKeyConfigured ? 'saved - leave empty to keep' : 'paste key'}"></div>
<div><label class="${labelCls}" for="k-user">OpenSubtitles username</label>
<input class="${field}" id="k-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? 'saved - leave empty to keep' : 'your opensubtitles.com username'}"></div>
<div><label class="${labelCls}" for="k-pass">OpenSubtitles password</label>
<input class="${field}" id="k-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? 'saved - leave empty to keep' : 'your opensubtitles.com password'}"></div>
</div>
<div class="mt-5 grid gap-2"><button type="submit" id="save-keys" class="${btnPrimary} w-full disabled:cursor-not-allowed disabled:opacity-40">Save keys</button><span class="${result} text-center" id="keys-result"></span></div>
</form>
</section>

<section class="${card}">${heading('Preferences', `RTL punctuation fix: ${d.rtlFix ? 'on' : 'off'} (advanced option, see Troubleshooting).`)}
<div><label class="${labelCls}" for="lang">Target language</label><select class="${field}" id="lang">${langOptions}</select></div>
<label class="mt-4 flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-950/50 px-3.5 py-3"><input type="checkbox" id="dual" class="mt-0.5 h-4 w-4 accent-indigo-500"${d.dualSubtitles ? ' checked' : ''}><span><span class="block text-sm font-medium text-slate-200">Dual Subtitles (English + Target Language)</span><span class="block text-xs text-slate-400">Shows the original line on top and the translation directly below it. Applies to subtitles translated after you save.</span></span></label>
<div class="mt-5 grid gap-2"><button type="button" id="save" class="${btnPrimary} w-full">Save settings</button><span class="${result} text-center" id="save-result"></span></div>
<div class="mt-5 border-t border-slate-700/60 pt-5"><p class="mb-3 text-sm text-slate-400">Delete saved translations so subtitles are translated again next time.</p><button type="button" id="clear-cache" class="${btn} w-full">Clear Translation Cache</button><span class="${result} mt-2 block text-center" id="clear-result"></span></div>
</section>

</div>
<div class="space-y-6">

<section class="${card}">${heading('Live status', d.aiConfigured ? `Using ${escapeHtml(d.aiProviderLabel)} (${escapeHtml(d.aiModel)}).` : 'No AI key saved yet.')}
<div class="grid gap-3 sm:grid-cols-2">
<div class="rounded-xl border border-slate-700/60 bg-slate-950/50 px-4 py-3"><div class="text-xs uppercase tracking-wide text-slate-500">State</div><div class="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-100"><span id="st-dot" class="h-2.5 w-2.5 rounded-full bg-slate-500"></span><span id="st-state">Waiting for Stremio...</span></div></div>
<div class="rounded-xl border border-slate-700/60 bg-slate-950/50 px-4 py-3"><div class="text-xs uppercase tracking-wide text-slate-500">Subtitle lines translated this session</div><div id="st-lines" class="mt-1 text-2xl font-bold text-white">0</div></div>
</div>
</section>

<section class="${card}">${heading('Test connections')}
<div class="grid gap-3 sm:grid-cols-3">
<div class="flex flex-col gap-2"><button type="button" class="${btn} w-full" data-test="ai">Test AI provider</button><span class="${result} text-center" id="r-ai"></span></div>
<div class="flex flex-col gap-2"><button type="button" class="${btn} w-full" data-test="opensubtitles">Test OpenSubtitles</button><span class="${result} text-center" id="r-opensubtitles"></span></div>
<div class="flex flex-col gap-2"><button type="button" class="${btn} w-full" id="sample">Translate built-in sample</button><span class="${result} text-center" id="r-sample"></span></div>
</div>
<pre id="sample-out" hidden class="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-3 text-sm"></pre>
</section>

<section class="${card} border-indigo-400/30">${heading('Installation', 'Keep this program running while you watch.')}${install}</section>

</div>
</div>
<p class="mt-6 px-1 text-center text-xs text-slate-500">Subtitle text is sent to the AI provider that matches your key (Google Gemini, Anthropic or OpenAI) for translation. API quotas, billing and
data-use terms are controlled by the providers, not by this add-on.</p>
</main>
<div id="toast" role="status" aria-live="polite" class="pointer-events-none fixed bottom-6 left-1/2 max-w-[90vw] -translate-x-1/2 translate-y-8 rounded-xl border px-5 py-3 text-sm font-semibold opacity-0 shadow-2xl transition duration-300"></div>
<script nonce="${escapeHtml(d.nonce)}">
const KEY_RULES = ${JSON.stringify(PROVIDERS.map((p) => ({ prefix: p.prefix, label: p.label, model: p.model })))};
const detect = (v) => KEY_RULES.find((r) => v.trim().startsWith(r.prefix));
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
    const r = await post('/api/settings', {targetLanguage: document.getElementById('lang').value, dualSubtitles: document.getElementById('dual').checked});
    show('save-result', r.ok, r.ok ? 'Settings saved' : r.message);
    toast(r.ok, r.ok ? 'Settings saved' : r.message);
  } catch { show('save-result', false, 'request failed'); toast(false, 'Request failed'); }
});
document.getElementById('keys').addEventListener('submit', async (e) => {
  e.preventDefault();
  const fields = {aiApiKey:'k-ai', openSubtitlesApiKey:'k-os', openSubtitlesUsername:'k-user', openSubtitlesPassword:'k-pass'};
  const body = {};
  for (const [name, id] of Object.entries(fields)) { const v = document.getElementById(id).value.trim(); if (v) body[name] = v; }
  if (Object.keys(body).length === 0) { show('keys-result', false, 'nothing to save'); return; }
  if (body.aiApiKey && !detect(body.aiApiKey)) { show('keys-result', false, 'the AI key is not valid - not saved'); return; }
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
const aiKey = document.getElementById('k-ai');
const aiWarn = document.getElementById('k-ai-warn');
const aiHint = document.getElementById('k-ai-hint');
const saveKeys = document.getElementById('save-keys');
aiKey.addEventListener('input', () => {
  const v = aiKey.value.trim();
  const p = detect(v);
  const invalid = v !== '' && !p;
  aiWarn.classList.toggle('hidden', !invalid);
  aiHint.classList.toggle('hidden', !p);
  if (p) aiHint.textContent = '\\u2714 Detected ' + p.label + ' - the app will use ' + p.model + '.';
  saveKeys.disabled = invalid;
});
document.getElementById('clear-cache').addEventListener('click', async () => {
  try {
    const r = await post('/api/cache/clear');
    show('clear-result', r.ok, r.message);
    toast(r.ok, r.ok ? 'Translation cache cleared' : r.message);
  } catch { show('clear-result', false, 'request failed'); toast(false, 'Request failed'); }
});
const STATES = {
  waiting: ['Waiting for Stremio...', 'bg-slate-500'],
  translating: ['Translating...', 'bg-indigo-400 animate-pulse'],
  idle: ['Ready - last subtitle finished', 'bg-emerald-400'],
  error: ['Last translation failed - use Test connections', 'bg-rose-400']
};
const refreshStatus = async () => {
  try {
    const r = await (await fetch('/api/status')).json();
    const st = STATES[r.state] || STATES.waiting;
    document.getElementById('st-state').textContent = st[0];
    document.getElementById('st-dot').className = 'h-2.5 w-2.5 rounded-full ' + st[1];
    document.getElementById('st-lines').textContent = String(r.linesTranslated);
  } catch { /* the app may be restarting */ }
};
refreshStatus();
setInterval(refreshStatus, 2500);
if (window.desktop) {
  const maxIcon = document.getElementById('win-max-icon');
  document.getElementById('win-max').addEventListener('click', () => window.desktop.toggleMaximize());
  window.desktop.onMaximizeChange((m) => { maxIcon.setAttribute('width', m ? '7' : '9'); maxIcon.setAttribute('height', m ? '7' : '9'); maxIcon.setAttribute('y', m ? '2.5' : '.5'); });
  document.getElementById('win-min').addEventListener('click', () => window.desktop.minimize());
  const modal = document.getElementById('exit-modal');
  const setModal = (open) => { modal.classList.toggle('hidden', !open); modal.classList.toggle('flex', open); };
  document.getElementById('win-close').addEventListener('click', () => setModal(true));
  document.getElementById('exit-cancel').addEventListener('click', () => setModal(false));
  document.getElementById('exit-tray').addEventListener('click', () => { setModal(false); window.desktop.hide(); });
  document.getElementById('exit-quit').addEventListener('click', () => window.desktop.quit());
  modal.addEventListener('click', (e) => { if (e.target === modal) setModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setModal(false); });
}
const copy = document.getElementById('copy');
if (copy) copy.addEventListener('click', () => { navigator.clipboard.writeText(document.getElementById('manifest').value); toast(true, 'Manifest URL copied'); });
</script>
</body></html>`;
}
