import { ERROR_MESSAGES, dictFor, type UiLang } from '../../i18n';
import type { UiCtx } from '../context';

/** Texts used only by the desktop title bar and its dialogs (not sent to the script). */
const TITLE_BAR_KEYS = new Set<string>([
  'update',
  'updateTitle',
  'minimize',
  'maximize',
  'close',
  'exitTitle',
  'exitBody',
  'exitTray',
  'exitQuit',
  'newsUpdated',
  'newsTitle',
  'newsOk',
]);

/** The script only needs the texts it writes itself; the title-bar texts live in the markup. */
const clientTexts = (lang: UiLang) =>
  Object.fromEntries(Object.entries(dictFor(lang)).filter(([key]) => !TITLE_BAR_KEYS.has(key)));

/** Helpers, link/open dialogs, toast, key saving and settings saving. */
export function scriptCore(c: UiCtx): string {
  const { d, lang, arrow, STEPS } = c;
  return `// Every response also carries its HTTP status, so the page can pick the matching message.
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(async r => ({...(await r.json()), status: r.status}));
const $ = (id) => document.getElementById(id);
const UI = ${JSON.stringify(lang)};
const T = ${JSON.stringify(clientTexts(lang))};
const f = (s, v) => s.replace(/\\{(\\w+)\\}/g, (m, k) => (k in v ? v[k] : m));
const ERRORS = ${JSON.stringify(ERROR_MESSAGES[lang])};
const FAILED = T.failed;
/** Text for a failed response: by error code when there is one, else the given fallback. */
const errText = (r, fallback) => (r.code && ERRORS[r.code]) || fallback;
const TONE = {ok:'text-warm-ok', bad:'text-rose-400', info:'text-warm-mu'};
let toastTimer;
// Links to other sites ask first, so a click never leaves the app by surprise.
const extModal = $('ext-modal');
let extUrl = '';
let extAction = null;
const closeExt = () => { extModal.classList.add('hidden'); extModal.classList.remove('flex'); extUrl = ''; extAction = null; };
// Opening another program asks first too: what to open, and the same OK / Cancel.
const askOpen = (title, body, host, action) => {
  $('ext-title').textContent = title; $('ext-body').textContent = body; $('ext-host').textContent = host;
  extAction = action;
  extModal.classList.remove('hidden'); extModal.classList.add('flex');
  $('ext-open').focus();
};
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a) return;
  let u;
  try { u = new URL(a.href, location.href); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin || u.hostname === '127.0.0.1' || u.hostname === 'localhost') return;
  e.preventDefault();
  const url = u.href;
  extUrl = url;
  askOpen(T.extTitle, T.extBody, u.hostname, () => window.open(url, '_blank', 'noopener,noreferrer'));
}, true);
$('ext-open').addEventListener('click', () => { const run = extAction; closeExt(); if (run) run(); });
$('ext-cancel').addEventListener('click', closeExt);
extModal.addEventListener('click', (e) => { if (e.target === extModal) closeExt(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && extAction) closeExt(); });

const toast = (ok, msg) => {
  const t = $('toast');
  t.textContent = (ok ? '\u2714\uFE0E ' : '\u2716\uFE0E ') + msg;
  t.className = 'pointer-events-none fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-2xl border px-5 py-3 text-sm font-semibold shadow-2xl transition duration-300 translate-y-0 opacity-100 ' +
    (ok ? 'border-warm-ok/50 bg-warm-sf text-warm-ok' : 'border-rose-400/50 bg-warm-sf text-rose-300');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('translate-y-0', 'opacity-100'); t.classList.add('translate-y-8', 'opacity-0'); }, 3500);
};
const show = (id, ok, msg) => {
  const el = $(id);
  const base = el.className.split(' ').filter(c => !Object.values(TONE).includes(c)).join(' ');
  el.textContent = msg ? (ok === null ? '' : ok ? '\\u2714\\uFE0E ' : '\\u2716\\uFE0E ') + msg : '';
  el.className = base + ' ' + (ok === null ? TONE.info : ok ? TONE.ok : TONE.bad);
};
const STEPS = ${JSON.stringify(STEPS)};
const ARROW = ${JSON.stringify(arrow === '&larr;' ? '←' : '→')};
// Booleans only: which keys the server already has. Updated as the wizard saves keys.
const have = ${JSON.stringify({
    ai: d.aiConfigured,
    osKey: d.openSubtitlesKeyConfigured,
    osLogin: d.openSubtitlesLoginConfigured,
  })};
const KEY_FIELDS = {aiApiKey:'ai', openSubtitlesApiKey:'os', subdlApiKey:'subdl', jimakuApiKey:'jimaku', openSubtitlesUsername:'user', openSubtitlesPassword:'pass'};
const readKeys = (prefix, only) => {
  const body = {};
  for (const [name, id] of Object.entries(KEY_FIELDS)) {
    if (only && !only.includes(name)) continue;
    const input = document.getElementById(prefix + id); if (!input) continue;
    const v = input.value.trim(); if (v) body[name] = v;
  }
  return body;
};
const clearKeys = (prefix) => { for (const id of Object.values(KEY_FIELDS)) { const input = document.getElementById(prefix + id); if (input) input.value = ''; } };
const KEY_ERRORS = {400: T.keyErr400, 401: T.keyErr401, 503: T.keyErr503};
const saveKeys = async (body, resultId) => {
  show(resultId, null, body.aiApiKey ? T.verifying : T.saving);
  try {
    const r = await post('/api/keys', body);
    const msg = r.ok
      ? (r.provider ? f(T.verified, {p: r.provider}) : T.saved)
      : KEY_ERRORS[r.status] || T.keyErrOther;
    show(resultId, r.ok, msg);
    if (!r.ok) toast(false, msg);
    if (r.ok && body.subdlApiKey) {
      subdlOn = true;
      $('st-subdl-nokey').classList.add('hidden'); $('st-subdl-info').classList.remove('hidden');
      $('st-subdl-text').classList.remove('text-warm-mu'); $('st-subdl-text').textContent = f(T.stSubdlCount, {n: 0});
    }
    if (r.ok && body.jimakuApiKey) jimakuOn = true;
    for (const name of ['subdl', 'jimaku']) if (r.ok && body[name + 'ApiKey']) document.querySelectorAll('[data-check-row="' + name + '"]').forEach((row) => row.classList.remove('hidden'));
    return r.ok;
  } catch { show(resultId, false, FAILED); toast(false, FAILED); return false; }
};
let subdlOn = ${d.subdlKeyConfigured ? 'true' : 'false'};
let jimakuOn = ${d.jimakuKeyConfigured ? 'true' : 'false'};
const saveSettings = async (lang, dual, ui, embedded, sync, ask, clean) => {
  const r = await post('/api/settings', {targetLanguage: lang, dualSubtitles: dual, ...(ui ? {uiLanguage: ui} : {}), ...(embedded === undefined ? {} : {embeddedSubtitles: embedded}), ...(sync === undefined ? {} : {preciseSync: sync}), ...(ask === undefined ? {} : {translationMode: ask ? 'ask' : 'auto'}), ...(clean === undefined ? {} : {cleanSubtitles: clean})});
  return {...r, message: r.ok ? T.settingsSaved : T.settingsInvalid};
};
const setUiLang = async (ui) => {
  const r = await post('/api/settings', {uiLanguage: ui});
  if (r.ok) location.reload();
};
`;
}
