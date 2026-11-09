import { ERROR_MESSAGES, dictFor, type UiLang } from '../../i18n';
import type { UiCtx } from '../context';

/** Texts used only by the desktop title bar and its dialogs (not sent to the script). */
const TITLE_BAR_KEYS = new Set<string>([
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
// Connection-check rows on the main screen: a state (icon and text) per row, an overall chip and a last-checked line.
const CK_PATHS = {ok:'<path d="M5 12.5l4.5 4.5L19 7.5"/>', fail:'<path d="M7 7l10 10M17 7 7 17"/>', warn:'<path d="M12 6.5v7"/><path d="M12 17.5h.01"/>', idle:'<circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none"/>', nokey:'<path d="M7 12h10"/>'};
CK_PATHS.out = CK_PATHS.warn;
const ckIcon = (s) => s === 'checking'
  ? '<span class="inline-block h-[11px] w-[11px] animate-spin rounded-full border-[1.5px] border-current border-e-transparent" aria-hidden="true"></span>'
  : '<svg viewBox="0 0 24 24" class="h-3 w-3 flex-none" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + CK_PATHS[s] + '</svg>';
const CK = {
  idle: [T.checksNotChecked, 'text-warm-mu'],
  checking: [T.testing, 'text-warm-ac'],
  ok: [T.checksOk, 'text-warm-ok'],
  fail: [T.checksFailed, 'text-rose-300'],
  warn: [T.checksQuotaLow, 'text-amber-300'],
  out: [T.checksQuotaOut, 'text-rose-300'],
  nokey: [T.checksNotSetUp, 'text-warm-mu']
};
const CK_PILL = {
  idle: 'border-warm-ln text-warm-mu',
  checking: 'border-warm-ac/45 text-warm-ac',
  ok: 'border-warm-ok/40 text-warm-ok',
  fail: 'border-rose-400/45 text-rose-300',
  out: 'border-rose-400/45 text-rose-300',
  warn: 'border-amber-400/45 text-amber-300'
};
const ckRows = () => [...document.querySelectorAll('[data-check-row][data-base]')];
// A low or used-up quota shows on the row even when it was not tested yet.
const ckState = (row) => {
  const b = row.dataset.base;
  if (b === 'ok' || b === 'idle') { if (row.dataset.quota === 'out') return 'out'; if (row.dataset.quota === 'low') return 'warn'; }
  return b;
};
let ckAt = 0;
const paintLast = () => {
  const box = $('checks-last');
  if (!box) return;
  const m = Math.floor((Date.now() - ckAt) / 60000);
  box.textContent = !ckAt ? T.checksNever : m < 1 ? T.checksJustNow : f(T.checksMinAgo, {n: m});
};
const paintChecks = () => {
  const pill = $('checks-pill');
  if (!pill) return;
  const es = ckRows().filter((r) => r.dataset.base !== 'nokey').map(ckState);
  const bad = es.filter((e) => e === 'fail' || e === 'out').length;
  const a = es.includes('checking') ? 'checking' : es.includes('fail') ? 'fail' : es.includes('out') ? 'out' : es.includes('idle') ? 'idle' : es.includes('warn') ? 'warn' : 'ok';
  const label = a === 'ok' ? T.checksAllOk : a === 'fail' ? (bad === 1 ? T.checksOneProblem : f(T.checksProblems, {n: bad})) : CK[a][0];
  pill.className = 'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-px text-xs font-bold ' + CK_PILL[a];
  pill.innerHTML = ckIcon(a) + '<span></span>';
  pill.lastChild.textContent = label;
  paintLast();
};
const paintRow = (row) => {
  const s = ckState(row);
  row.dataset.state = s;
  const st = row.querySelector('[data-st]');
  st.className = 'inline-flex items-center gap-1 whitespace-nowrap text-xs font-bold ' + CK[s][1];
  st.innerHTML = ckIcon(s) + '<span></span>';
  st.lastChild.textContent = CK[s][0];
  row.querySelector('[data-msg]').classList.toggle('hidden', s === 'checking');
  paintChecks();
};
// A key was just saved for SubDL or Jimaku: its row becomes a normal, testable row.
const ckKeyAdded = (name) => {
  const row = document.querySelector('[data-check-row="' + name + '"][data-base]');
  if (!row) return;
  if (row.dataset.base === 'nokey') { row.dataset.base = 'idle'; row.querySelector('[data-msg]').textContent = ''; }
  if (name === 'jimaku') { $('jk-desc').classList.remove('hidden'); $('jk-nokey').classList.add('hidden'); }
  paintRow(row);
};
document.querySelectorAll('[data-open-settings]').forEach((b) => b.addEventListener('click', () => $('open-settings').click()));
setInterval(paintLast, 30000);
const msgTimers = new Map();
const show =(id, ok, msg) => {
  const el = $(id);
  const base = el.className.split(' ').filter(c => !Object.values(TONE).includes(c)).join(' ');
  el.textContent = msg ? (ok === null ? '' : ok ? '\\u2714\\uFE0E ' : '\\u2716\\uFE0E ') + msg : '';
  el.className = base + ' ' + (ok === null ? TONE.info : ok ? TONE.ok : TONE.bad);
  const row = el.closest('[data-check-row][data-base]');
  if (row && msg) {
    row.dataset.base = ok === null ? (msg === T.testing ? 'checking' : 'nokey') : ok ? 'ok' : 'fail';
    if (ok !== null) ckAt = Date.now();
    paintRow(row);
    // A success message goes away after a few seconds; the state and the "checked" line stay.
    // A failure message stays, because it says what to fix.
    clearTimeout(msgTimers.get(el));
    if (ok === true) {
      const text = el.textContent;
      msgTimers.set(el, setTimeout(() => { if (el.textContent === text) el.textContent = ''; }, 5000));
    }
  }
};
ckRows().forEach(paintRow);
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
    for (const name of ['subdl', 'jimaku']) if (r.ok && body[name + 'ApiKey']) ckKeyAdded(name);
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
