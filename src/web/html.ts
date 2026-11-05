import { readFileSync } from 'node:fs';
import { dictFor, ERROR_MESSAGES, t, type UiLang } from './i18n';
import { escapeHtml } from './ui/components';
import { createUiCtx } from './ui/context';
import { renderDashboard } from './ui/dashboard';
import { renderDrawer } from './ui/drawer';
import { renderLibrary } from './ui/library';
import { renderConfirmModals, renderExtModal } from './ui/modals';
import { renderTitleBar } from './ui/titleBar';
import { renderWizard } from './ui/wizard';

/** Replaced at build time by scripts/build-electron.mjs; undefined when running from source. */
declare const __TAILWIND_CSS__: string | undefined;

export { escapeHtml };
export { prettyModel, providerLine } from './ui/provider';

export interface StatusPageData {
  nonce: string;
  aiConfigured: boolean;
  /** Provider detected from the saved key, e.g. "Google Gemini"; empty when none. */
  aiProviderLabel: string;
  aiModel: string;
  dualSubtitles: boolean;
  /** Use subtitle tracks stored inside the video file (default on). */
  embeddedSubtitles?: boolean;
  cleanSubtitles?: boolean;
  /** auto: translate right away. ask: wait for the user's OK first. */
  translationMode?: 'auto' | 'ask';
  /** Which subtitle source is asked first. */
  subtitleSource?: 'opensubtitles' | 'subdl';
  /** Developer test mode is on (made-up subtitles, pretend AI). */
  testMode?: boolean;
  jimakuKeyConfigured?: boolean;
  /** Settings > Developers: the current values. */
  dev?: {
    soundCheck: 'background' | 'wait' | 'off';
    seasonPacks: boolean;
    preferTranslation: boolean;
    prefetchNext: boolean;
    embeddedWaitSec: number;
    embeddedMaxEtaSec: number;
    /** Every source, the ones in use first (in order), then the ones switched off. */
    sources: { id: 'subdl' | 'opensubtitles' | 'jimaku'; on: boolean; hasKey: boolean }[];
  };
  openSubtitlesKeyConfigured: boolean;
  subdlKeyConfigured?: boolean;
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
  /** Show Settings > About > Developer settings (off for everyone but the author: SHOW_DEV_SETTINGS=1). */
  devSettings?: boolean;
  /** Language of the screens. Hebrew (right-to-left) unless set to English. */
  uiLang?: UiLang;
}

/** Locally built Tailwind CSS (npm run build:css), inlined so the page loads nothing external. */
const CSS = (
  typeof __TAILWIND_CSS__ === 'string'
    ? __TAILWIND_CSS__ // embedded by scripts/build-electron.mjs
    : readFileSync(new URL('./tailwind.generated.css', import.meta.url), 'utf8')
).replace(/<\/style/gi, '<\\/style');

/** Everything that can be clicked shows the hand cursor (a disabled control shows the arrow). */
const POINTER_CSS =
  'select,button,summary,[role=button],[role=option],label[for],input[type=checkbox],input[type=range]{cursor:pointer}button:disabled,input:disabled,select:disabled{cursor:default}';

/** Hebrew text for the API error codes (kept for callers and tests; see i18n.ts for both languages). */
export const ERROR_MESSAGES_HE = ERROR_MESSAGES.he;

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

export function renderStatusPage(d: StatusPageData): string {
  const c = createUiCtx(d);
  const { lang, dir, tt, arrow, STEPS, startStep } = c;
  // The script only needs the texts it writes itself; the title-bar texts live in the markup.
  const clientDict = Object.fromEntries(
    Object.entries(dictFor(lang)).filter(([key]) => !TITLE_BAR_KEYS.has(key)),
  );

  return `<!doctype html>
<html lang="${lang}" dir="${dir}" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${tt('appTitle')}</title>
<style nonce="${escapeHtml(d.nonce)}">${CSS}${POINTER_CSS}</style></head>
<body class="min-h-screen bg-warm-bg font-sans text-warm-tx antialiased">
${d.desktop ? renderTitleBar(c) : ''}
<main class="mx-auto flex min-h-screen w-full flex-col items-center px-4 pb-10 sm:px-10 ${d.desktop ? 'pt-[76px]' : 'pt-10'}">

${renderWizard(c)}

${renderDashboard(c)}

${renderLibrary(c)}

<p class="mt-auto max-w-[560px] px-1 pt-8 text-center text-xs text-warm-mu/80">${tt('privacy')}</p>
</main>

${renderConfirmModals(c)}

${renderDrawer(c)}

${renderExtModal(c)}
<script nonce="${escapeHtml(d.nonce)}">
// Every response also carries its HTTP status, so the page can pick the matching message.
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(async r => ({...(await r.json()), status: r.status}));
const $ = (id) => document.getElementById(id);
const UI = ${JSON.stringify(lang)};
const T = ${JSON.stringify(clientDict)};
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

// Three views share the page: wizard, main screen (dash) and the subtitle library.
const VIEWS = {wizard: $('wizard'), dash: $('dash'), lib: $('lib')};
const setView = (name) => {
  for (const [k, el] of Object.entries(VIEWS)) { el.classList.toggle('hidden', k !== name); el.classList.toggle('flex', k === name); }
  if (name === 'lib') loadLib();
};

// Wizard (design 1B "Focus"): one centered card, five steps, segmented progress bar.
let step = ${startStep || 1};
// True when the wizard was opened from the main screen, so the first step can offer a way out.
let fromDash = ${startStep ? 'false' : 'true'};
const next = $('w-next'), back = $('w-back');
const render = () => {
  $('w-stepof').textContent = f(T.stepOf, {n: step, total: STEPS.length});
  $('w-title').textContent = STEPS[step - 1][1];
  $('w-sub').textContent = STEPS[step - 1][2];
  document.querySelectorAll('[data-pane]').forEach(p => { const on = Number(p.dataset.pane) === step; p.classList.toggle('hidden', !on); p.classList.toggle('flex', on); });
  document.querySelectorAll('[data-bar]').forEach(b => { const on = Number(b.dataset.bar) <= step; b.classList.toggle('bg-warm-ac', on); b.classList.toggle('bg-warm-ln', !on); });
  // Step 1 has nothing to go back to, unless the wizard was opened from the main screen: then it cancels.
  back.classList.toggle('invisible', step === 1 && !fromDash);
  back.textContent = step === 1 ? T.leaveWizard : T.back;
  next.textContent = step === LAST ? T.finish : T.next + ' ' + ARROW;
  show('w-result', null, '');
};
const LAST = STEPS.length;
const go = (n) => { step = Math.max(1, Math.min(LAST, n)); render(); };
back.addEventListener('click', () => { if (step === 1) setView('dash'); else go(step - 1); });
document.querySelectorAll('.js-lang-wrap').forEach((wrap) => {
  const btn = wrap.querySelector('.js-lang-btn'), menu = wrap.querySelector('.js-lang-menu');
  const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.classList.toggle('hidden') === false; btn.setAttribute('aria-expanded', String(open)); });
  menu.querySelectorAll('[data-ui]').forEach((o) => o.addEventListener('click', () => { close(); if (o.dataset.ui !== UI) setUiLang(o.dataset.ui); }));
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
});
next.addEventListener('click', async () => {
  next.disabled = true;
  try {
    if (step === 1) {
      const body = readKeys('k-', ['aiApiKey']);
      if (!body.aiApiKey && !have.ai) { show('w-result', false, T.pasteToContinue); return; }
      if (body.aiApiKey) { if (!(await saveKeys(body, 'w-result'))) return; have.ai = true; $('k-ai').value = ''; }
    } else if (step === 2) {
      const body = readKeys('k-', ['openSubtitlesApiKey', 'openSubtitlesUsername', 'openSubtitlesPassword', 'subdlApiKey']);
      const keyOk = have.osKey || !!body.openSubtitlesApiKey;
      const loginOk = have.osLogin || (!!body.openSubtitlesUsername && !!body.openSubtitlesPassword);
      if (!keyOk || !loginOk) { show('w-result', false, T.fillOs); return; }
      if (Object.keys(body).length) { if (!(await saveKeys(body, 'w-result'))) return; have.osKey = true; have.osLogin = true; clearKeys('k-'); }
    } else if (step === 3) {
      const r = await saveSettings($('lang').value, $('dual').checked);
      if (!r.ok) { show('w-result', false, r.message); return; }
    } else if (step === LAST) {
      if (startupApi && $('w-startup')) { try { await startupApi.set($('w-startup').checked, $('w-minimized').checked); } catch { show('w-result', false, FAILED); return; } }
      location.reload(); // the main screen is rendered with the freshly saved settings
      return;
    }
    go(step + 1);
  } catch { show('w-result', false, FAILED); }
  finally { next.disabled = false; }
});
render();

// Start with Windows (desktop app only). The second switch only works while the first is on.
const startupApi = window.desktop && window.desktop.startup;
const startupRefresh = {};
const wireStartup = (onId, minId, autosave) => {
  const on = $(onId), min = $(minId);
  if (!on || !min || !startupApi) return;
  const label = min.closest('label');
  const hint = label.querySelector('.text-xs');
  const hintOn = hint ? hint.textContent : '';
  const refresh = () => {
    min.disabled = !on.checked;
    label.classList.toggle('opacity-40', !on.checked);
    label.classList.toggle('pointer-events-none', !on.checked);
    if (hint) hint.textContent = on.checked ? hintOn : T.minimizedHintOff;
  };
  const save = async () => {
    try { await startupApi.set(on.checked, min.checked); toast(true, T.settingsSaved); }
    catch { toast(false, FAILED); }
  };
  on.addEventListener('change', () => { refresh(); if (autosave) save(); });
  if (autosave) min.addEventListener('change', save);
  startupRefresh[onId] = refresh;
  refresh();
};
const loadStartup = async (onId, minId, firstRun) => {
  if (!startupApi || !startupRefresh[onId]) return;
  try {
    const st = await startupApi.get();
    $(onId).checked = firstRun ? true : st.openAtLogin;
    $(minId).checked = st.minimized;
    startupRefresh[onId]();
    if (!st.available) {
      $(onId).disabled = true; $(minId).disabled = true;
      const note = $('startup-note'); if (note) note.classList.remove('hidden');
    }
  } catch { /* the switches stay as they are */ }
};
wireStartup('w-startup', 'w-minimized', false);
wireStartup('d-startup', 'd-minimized', false);
loadStartup('w-startup', 'w-minimized', !fromDash);

// Settings drawer.
const drawer = $('drawer');
document.querySelectorAll('#groups > details').forEach((g) => g.addEventListener('toggle', () => {
  if (g.open) document.querySelectorAll('#groups > details').forEach((o) => { if (o !== g) o.open = false; });
}));
// Changes in the drawer are only kept with Save; closing with changes asks first.
const devGroupEl = $('dev-sound').closest('details');
// A set key can be removed: the small x asks first, then the key is cleared and the page reloads.
const swap = (row, asking) => {
  for (const [sel, on] of [['[data-rm-normal]', !asking], ['[data-rm-ask]', asking]]) {
    const part = row.querySelector(sel);
    part.classList.toggle('hidden', !on);
    part.classList.toggle('inline-flex', on);
  }
};
document.addEventListener('click', async (ev) => {
  const t = ev.target.closest ? ev.target.closest('[data-rm], [data-rm-no], [data-rm-yes]') : null;
  if (!t) return;
  const row = t.closest('[data-key-row]');
  if (t.hasAttribute('data-rm')) swap(row, true);
  else if (t.hasAttribute('data-rm-no')) swap(row, false);
  else {
    t.disabled = true;
    try {
      const r = await fetch('/api/keys/remove', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({field: t.getAttribute('data-rm-yes')})});
      if (!r.ok) throw new Error('failed');
      location.reload();
    } catch { t.disabled = false; toast(false, T.removeKeyFail); }
  }
});
const drawerEls = () => [...drawer.querySelectorAll('input, select')].filter((el) => !devGroupEl.contains(el) && el.id !== 'd-src');
const elValue = (el) => el.type === 'checkbox' ? el.checked : el.value;
let drawerSnap = new Map();
const takeSnap = () => { drawerSnap = new Map(drawerEls().map((el) => [el, elValue(el)])); };
const drawerDirty = () => drawerEls().some((el) => drawerSnap.get(el) !== elValue(el));
const setDrawer = (open) => {
  drawer.classList.toggle('hidden', !open); drawer.classList.toggle('flex', open);
  if (open) loadStartup('d-startup', 'd-minimized', false).then(takeSnap);
};
const unsaved = $('unsaved-modal');
const showUnsaved = (on) => { unsaved.classList.toggle('hidden', !on); unsaved.classList.toggle('flex', on); if (on) $('unsaved-save').focus(); };
const requestCloseDrawer = () => { if (drawerDirty()) showUnsaved(true); else setDrawer(false); };
$('open-settings').addEventListener('click', () => setDrawer(true));
$('close-settings').addEventListener('click', requestCloseDrawer);
drawer.addEventListener('click', (e) => { if (e.target === drawer) requestCloseDrawer(); });
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || drawer.classList.contains('hidden')) return;
  if (unsaved.classList.contains('hidden')) requestCloseDrawer(); else showUnsaved(false);
});
$('unsaved-stay').addEventListener('click', () => showUnsaved(false));
$('unsaved-save').addEventListener('click', () => { showUnsaved(false); $('save').click(); });
$('unsaved-discard').addEventListener('click', () => {
  for (const el of drawerEls()) { const v = drawerSnap.get(el); if (el.type === 'checkbox') el.checked = v; else el.value = v; }
  if (startupRefresh['d-startup']) startupRefresh['d-startup']();
  showUnsaved(false); setDrawer(false);
});
const quickSave = async () => {
  const lang = $('q-lang').value, dual = $('q-dual').checked;
  try {
    const r = await saveSettings(lang, dual);
    toast(r.ok, r.message);
    if (r.ok) { $('d-lang').value = lang; $('d-dual').checked = dual; }
  } catch { toast(false, FAILED); }
};
const openStremioBtn = $('open-stremio');
const openStremioNow = async () => {
  openStremioBtn.disabled = true;
  try {
    const r = await post('/api/open-stremio', {});
    toast(r.ok, r.ok ? T.openStremioOk : r.code === 'NOT_INSTALLED' ? T.openStremioMissing : FAILED);
  } catch { toast(false, FAILED); }
  setTimeout(() => { openStremioBtn.disabled = false; }, 2000);
};
if (openStremioBtn) openStremioBtn.addEventListener('click', () => askOpen(T.extStremioTitle, T.extStremioBody, 'Stremio', openStremioNow));
$('resume-btn').addEventListener('click', async () => {
  const btn = $('resume-btn');
  const label = btn.textContent;
  btn.style.minWidth = btn.offsetWidth + 'px'; // the new text must not change the button's size
  btn.disabled = true;
  btn.textContent = T.resumeBusy;
  btn.classList.add('animate-pulse');
  setTimeout(() => { btn.disabled = false; btn.textContent = label; btn.classList.remove('animate-pulse'); }, 1500);
  try {
    const r = await post('/api/resume', {});
    toast(r.ok, r.ok ? T.resumeStarted : T.resumeNone);
  } catch { toast(false, FAILED); }
  refreshStatus();
});
$('sync-now-btn').addEventListener('click', async () => {
  const btn = $('sync-now-btn');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 1500);
  try {
    const r = await post('/api/sync-now', {});
    const why = {NO_SUBTITLE: T.syncNowNoSub, NO_VIDEO: T.syncNowNoVideo, BUSY: T.syncNowBusy};
    toast(r.ok, r.ok ? T.syncNowStarted : why[r.code] || FAILED);
  } catch { toast(false, FAILED); }
  dismissedUpgrade = 0;
  refreshStatus();
});
$('q-lang').addEventListener('change', quickSave);
$('q-dual').addEventListener('change', quickSave);
$('rerun').addEventListener('click', () => { setDrawer(false); fromDash = true; go(1); setView('wizard'); });
$('save').addEventListener('click', async () => {
  const saveBtn = $('save');
  saveBtn.disabled = true;
  try {
    const body = readKeys('d-');
    if (Object.keys(body).length && !(await saveKeys(body, 'save-result'))) return;
    const startupChanged = startupApi && $('d-startup') && (drawerSnap.get($('d-startup')) !== $('d-startup').checked || drawerSnap.get($('d-minimized')) !== $('d-minimized').checked);
    if (startupChanged) {
      try { await startupApi.set($('d-startup').checked, $('d-minimized').checked); }
      catch { show('save-result', false, FAILED); toast(false, FAILED); return; }
    }
    const r = await saveSettings($('d-lang').value, $('d-dual').checked, undefined, $('d-emb').checked, undefined, $('d-ask').checked, $('d-clean').checked);
    show('save-result', r.ok, r.message);
    toast(r.ok, r.message);
    if (r.ok) { clearKeys('d-'); setTimeout(() => location.reload(), 1000); }
  } catch { show('save-result', false, FAILED); toast(false, FAILED); }
  finally { saveBtn.disabled = false; }
});

// Connection checks (wizard step 4 and the main screen).
const TEST_OK = {ai: T.testOkAi, opensubtitles: T.testOkOs, subdl: T.testOkSubdl, jimaku: T.testOkJimaku};
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  const name = b.dataset.test, id = b.dataset.rp + name;
  if (name === 'subdl' && !subdlOn) { show(id, false, T.testNoKeySubdl); return; }
  if (name === 'jimaku' && !jimakuOn) { show(id, false, T.testNoKeyJimaku); return; }
  show(id, null, T.testing);
  try { const r = await post('/api/test/' + name); show(id, r.ok, r.ok ? TEST_OK[name] : errText(r, FAILED)); }
  catch { show(id, false, FAILED); }
}));
// Eye button: shows or hides what was typed in a password field (nothing saved is ever sent here).
document.querySelectorAll('[data-reveal]').forEach(b => {
  const input = $(b.dataset.reveal);
  const sync = () => {
    const has = input.value !== '';
    b.classList.toggle('hidden', !has);
    b.classList.toggle('flex', has);
    if (!has && input.type === 'text') b.click();
  };
  input.addEventListener('input', sync);
  sync();
});
document.querySelectorAll('[data-reveal]').forEach(b => b.addEventListener('click', () => {
  const input = $(b.dataset.reveal);
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  b.setAttribute('aria-pressed', String(show));
  b.setAttribute('aria-label', show ? T.hidePassword : T.showPassword);
  b.title = show ? T.hidePassword : T.showPassword;
  b.querySelector('[data-slash]').classList.toggle('hidden', !show);
}));
document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', async () => {
  const id = b.dataset.res, out = $(b.dataset.out);
  show(id, null, T.translating);
  // The old result must not stay on screen while a new one is being made.
  out.textContent = T.translating;
  out.hidden = false;
  try {
    const r = await post('/api/dev/sample');
    const count = r.ok && /\\d+/.exec(r.message || '');
    show(id, r.ok, r.ok ? (count ? f(T.translatedN, {n: count[0]}) : T.translatedOk) : errText(r, FAILED));
    if (r.ok) { out.textContent = r.preview; out.hidden = false; } else { out.hidden = true; }
  } catch { show(id, false, FAILED); out.hidden = true; }
}));
$('d-src').addEventListener('change', async () => {
  try {
    // Choosing the first source here replaces any custom order set under Developers.
    const r = await post('/api/settings', {subtitleSource: $('d-src').value, sourceOrder: []});
    if (r.ok) document.querySelectorAll('[data-src-badge]').forEach((b) => { const first = b.dataset.srcBadge === $('d-src').value; b.textContent = first ? T.srcInUse : T.srcBackup; b.className = 'rounded-full px-2 py-0.5 text-[11px] font-bold ' + (first ? 'bg-warm-ac/15 text-warm-ac' : 'bg-warm-ln text-warm-mu'); });
    toast(r.ok, r.ok ? T.settingsSaved : FAILED);
  } catch { toast(false, FAILED); }
});
$('d-test').addEventListener('change', async () => {
  const on = $('d-test').checked;
  try {
    const r = await post('/api/settings', {testMode: on});
    if (!r.ok) throw new Error('save');
    $('test-run').classList.toggle('hidden', !on);
    $('test-run').classList.toggle('flex', on);
    toast(true, on ? T.testEnabled : T.testDisabled);
  } catch { $('d-test').checked = !on; toast(false, FAILED); }
});
$('test-run-btn').addEventListener('click', async () => {
  try {
    const r = await post('/api/test/run');
    toast(r.ok, r.ok ? T.testStarted : FAILED);
  } catch { toast(false, FAILED); }
});
// Settings > Developers: every control is saved as soon as it changes.
const devSave = async (patch) => {
  try { const r = await post('/api/settings', patch); toast(r.ok, r.ok ? T.settingsSaved : FAILED); return r.ok; }
  catch { toast(false, FAILED); return false; }
};
$('dev-sound').addEventListener('change', () => devSave({soundCheck: $('dev-sound').value}));
$('dev-packs').addEventListener('change', () => devSave({seasonPacks: $('dev-packs').checked}));
$('dev-prefetch').addEventListener('change', () => devSave({prefetchNext: $('dev-prefetch').checked}));
$('dev-translate').addEventListener('change', () => devSave({preferTranslation: $('dev-translate').checked}));
[['dev-emb-wait', 'embeddedWaitSec', 120], ['dev-emb-eta', 'embeddedMaxEtaSec', 600]].forEach(([id, key, max]) => $(id).addEventListener('change', () => {
  const n = Math.min(max, Math.max(0, Math.round(Number($(id).value))));
  if (Number.isFinite(n)) { $(id).value = String(n); devSave({[key]: n}); }
}));
const orderItems = () => [...document.querySelectorAll('#dev-order [data-src]')];
const saveOrder = (changed) => {
  const on = orderItems().filter((li) => li.querySelector('input').checked).map((li) => li.dataset.src);
  if (on.length === 0) { if (changed) changed.checked = true; toast(false, T.devOrderNone); return; }
  devSave({sourceOrder: on});
};
$('dev-order').addEventListener('change', (e) => saveOrder(e.target));
$('dev-order').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]'); if (!b) return;
  const li = b.closest('li'), dir = Number(b.dataset.move);
  const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!other) return;
  if (dir < 0) other.before(li); else other.after(li);
  saveOrder();
});
$('dev-order-reset').addEventListener('click', async () => {
  if (await devSave({sourceOrder: [], subtitleSource: 'subdl'})) location.reload();
});
const loadRedoList = async () => {
  try {
    const j = await (await fetch('/api/library')).json();
    const sel = $('dev-redo-item');
    sel.textContent = '';
    for (const e of (j.items || [])) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.title + (e.kind === 'series' ? ' S' + String(e.season ?? 0).padStart(2, '0') + 'E' + String(e.episode ?? 0).padStart(2, '0') : '');
      sel.appendChild(o);
    }
    $('dev-redo-btn').disabled = sel.options.length === 0;
    if (sel.options.length === 0) show('dev-redo-result', null, T.devRedoNone);
  } catch { /* the list stays empty */ }
};
$('dev-order').closest('details').addEventListener('toggle', (e) => { if (e.target.open) loadRedoList(); });
$('dev-redo-btn').addEventListener('click', async () => {
  const id = $('dev-redo-item').value;
  if (!id) return;
  try {
    const r = await post('/api/dev/redo', {id, source: $('dev-redo-src').value});
    show('dev-redo-result', r.ok, r.ok ? T.devRedoStarted : (r.status === 400 ? T.devRedoNoKey : T.devRedoBusy));
    if (r.ok) refreshStatus();
  } catch { show('dev-redo-result', false, FAILED); }
});
$('copy-diag').addEventListener('click', async () => {
  try {
    const text = await (await fetch('/api/diagnostics')).text();
    await navigator.clipboard.writeText(text);
    toast(true, T.diagCopied);
  } catch { toast(false, FAILED); }
});
$('clear-cache').addEventListener('click', async () => {
  try {
    const r = await post('/api/cache/clear');
    const size = r.ok && /\\(([^)]+)\\)/.exec(r.message || '');
    const msg = r.ok ? T.clearOk + (size ? ' (' + size[1] + ')' : '') : T.clearFail;
    show('clear-result', r.ok, msg);
    toast(r.ok, msg);
  } catch { show('clear-result', false, FAILED); toast(false, FAILED); }
});

// Live status.
const STATES = {
  waiting: [T.stWaiting, 'bg-warm-mu'],
  translating: [T.stTranslating, 'bg-warm-ac animate-pulse'],
  ratelimited: [T.stRate, 'bg-amber-400 animate-pulse'],
  idle: [T.stIdle, 'bg-warm-ok'],
  error: [T.stError, 'bg-rose-400']
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
// The translation queue: waiting for the user's OK, waiting for a free slot, or running.
const queueAct = async (id, action) => { try { await post('/api/jobs/' + id + '/' + action); } catch { /* shown on the next refresh */ } refreshStatus(); };
const queueRows = new Map(); // id -> the line on screen, kept between refreshes so a click is never lost
const queueStatus = (it) => it.state === 'pending' ? T.qPending : it.state === 'queued' ? T.qQueued : it.skippable === 'local' ? T.qLocal : it.skippable === 'sync' ? T.qSync : (it.percent === null ? T.qRunning : f(T.qRunningPct, {p: it.percent}));
const buildQueueRow = (it) => {
  const li = el('li', 'flex flex-col gap-2 rounded-xl border p-3 ' + (it.state === 'pending' ? 'border-warm-ac/60 bg-warm-ac/10' : 'border-warm-ln bg-warm-bg/40'));
  const where = it.season !== undefined && it.episode !== undefined ? ' · ' + f(T.qSeasonEp, {s: it.season, e: it.episode}) : '';
  li.append(el('div', 'text-sm font-semibold text-warm-tx', it.title + where));
  const status = el('div', 'text-xs ' + (it.state === 'pending' ? 'text-warm-ac' : 'text-warm-mu'), queueStatus(it));
  li.append(status);
  let fill = null;
  if (it.state === 'running') {
    const bar = el('div', 'h-1.5 overflow-hidden rounded-full bg-warm-bg');
    fill = el('div', 'h-full rounded-full bg-warm-ac transition-[width] duration-500');
    bar.append(fill);
    li.append(bar);
  }
  const row = el('div', 'flex flex-wrap gap-2');
  if (it.state === 'pending') {
    const yes = el('button', 'rounded-xl bg-warm-ac px-4 py-1.5 text-[13px] font-bold text-warm-on transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60', T.qTranslate);
    yes.type = 'button';
    yes.addEventListener('click', () => queueAct(it.id, 'approve'));
    row.append(yes);
  }
  if (it.skippable) {
    const skip = el('button', 'rounded-xl bg-warm-ac px-4 py-1.5 text-[13px] font-bold text-warm-on transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60', T.qSkip);
    skip.type = 'button';
    skip.addEventListener('click', () => queueAct(it.id, 'skip'));
    row.append(skip);
  }
  const no = el('button', 'rounded-xl border border-warm-ln px-4 py-1.5 text-[13px] font-semibold text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac', T.qCancel);
  no.type = 'button';
  no.addEventListener('click', () => queueAct(it.id, 'cancel'));
  row.append(no);
  li.append(row);
  return {li, state: it.state, skippable: it.skippable, status, fill};
};
const renderQueue = (items) => {
  const box = $('st-queue');
  // The list is for two or more; a single job is described, with its buttons, in the main card.
  const shown = items.length >= 2;
  box.classList.toggle('hidden', !shown);
  box.classList.toggle('flex', shown);
  const list = $('st-queue-list');
  // Rebuild only when a line appears, disappears or changes kind; otherwise just update the numbers.
  const same = items.length === queueRows.size && items.every((it) => queueRows.get(it.id)?.state === it.state && queueRows.get(it.id)?.skippable === it.skippable);
  if (!same) {
    list.replaceChildren();
    queueRows.clear();
    for (const it of items) { const r = buildQueueRow(it); queueRows.set(it.id, r); list.append(r.li); }
  }
  for (const it of items) {
    const r = queueRows.get(it.id);
    r.status.textContent = queueStatus(it);
    if (r.fill) r.fill.style.width = (it.percent ?? 0) + '%';
  }
};
// The "better subtitle is ready" notice can be closed; it comes back only for a newer one.
let dismissedUpgrade = 0;
const NOTICE_MS = 60000;
try { dismissedUpgrade = Number(localStorage.getItem('upgradeDismissed')) || 0; } catch { /* no storage: it just shows again */ }
const dismissSyncNotices = () => {
  dismissedUpgrade = Date.now();
  try { localStorage.setItem('upgradeDismissed', String(dismissedUpgrade)); } catch { /* not saved */ }
  for (const id of ['st-upgrade', 'st-sync']) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }
};
$('st-upgrade-close').addEventListener('click', dismissSyncNotices);
$('st-sync-ok').addEventListener('click', dismissSyncNotices);
$('st-sync-stop').addEventListener('click', async () => {
  try { await post('/api/sync-stop', {}); } catch { toast(false, FAILED); }
  refreshStatus();
});
// Cancel (and Skip, when a step can be skipped) sit with the other buttons and show only while there is a job.
let stopJob = '';
const renderStop = (items) => {
  const it = items.find((x) => x.state === 'running') || items.find((x) => x.state === 'pending');
  stopJob = it ? it.id : '';
  $('st-cancel-btn').classList.toggle('hidden', !it);
  $('st-skip-btn').classList.toggle('hidden', !(it && it.skippable));
};
$('st-cancel-btn').addEventListener('click', () => { if (stopJob) queueAct(stopJob, 'cancel'); });
$('st-skip-btn').addEventListener('click', () => { if (stopJob) queueAct(stopJob, 'skip'); });
const refreshStatus = async () => {
  try {
    const r = await (await fetch('/api/status')).json();
    const st = STATES[r.state] || STATES.waiting;
    // After a failure, say why (quota, key, rate limit...) instead of the general advice.
    $('st-state').textContent = (r.paused && r.running > 0 && T.stPaused) || (r.state === 'error' && r.lastError && ERRORS[r.lastError]) || st[0];
    $('st-dot').className = 'h-2.5 w-2.5 rounded-full ' + st[1] + (r.running > 0 ? ' animate-pulse' : '');
    $('st-lines').textContent = String(r.linesTranslated);
    const kb = r.bytesTranslated / 1024;
    $('st-size').textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
    const p = r.progress;
    const fmtEta = (s) => s < 60 ? s + (UI === 'he' ? ' שנ׳' : ' s') : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + (UI === 'he' ? ' דק׳' : ' min');
    const stageText = { queued: T.stageQueued, local: T.stageLocal, search: T.stageSearch, translate: T.stageTranslate, sync: f(T.stageSync, {p: r.syncPercent || 0}) }[r.stage];
    $('st-progress-text').textContent = p ? (p.percent >= 100 && r.running === 0 ? f(T.progressDone, {t: p.total}) : f(T.progressText, {d: p.done, t: p.total, p: p.percent})) : (r.running > 0 && stageText) || T.noSub;
    $('st-progress').style.width = (p ? p.percent : 0) + '%'; // CSSOM, allowed by the nonce-only CSP
    $('st-progress-eta').textContent = p && r.running > 0 && !r.paused && p.etaSec ? f(T.syncEta, {t: fmtEta(p.etaSec)}) : '';
    $('st-total-eta').classList.toggle('hidden', !(r.totalEtaSec && !r.paused));
    if (r.totalEtaSec && !r.paused) $('st-total-eta').textContent = f(T.etaTotal, {t: fmtEta(r.totalEtaSec)});
    // The sound check that goes on beside (or after) the translation, and how it ended.
    const nameOf = (x) => '⁨' + x.title + '⁩' + (x.season !== undefined && x.episode !== undefined ? (UI === 'he' ? ' עונה ' + x.season + ' פרק ' + x.episode : ' S' + x.season + 'E' + x.episode) : '');
    const bs = r.backgroundSync, ls = r.lastSync;
    const dl = r.lastDelivered;
    $('st-delivered').classList.toggle('hidden', !dl);
    if (dl) $('st-delivered').textContent = f(T.deliveredText, {name: nameOf(dl)});
    const syncBox = $('st-sync');
    // A finished notice goes away by itself after a minute. When an exact subtitle arrived after the
    // sound check, only that one is shown: the check's "kept" answer is no longer the whole story.
    const fresh = (x) => !!x && x.at > dismissedUpgrade && Date.now() - x.at < NOTICE_MS;
    const syncShown = !!bs || !!r.exactComing || (fresh(ls) && !(r.upgrade && r.upgrade.at >= ls.at));
    syncBox.classList.toggle('hidden', !syncShown);
    syncBox.classList.toggle('flex', syncShown);
    $('st-sync-bar').classList.toggle('hidden', !bs);
    $('st-sync-ok-row').classList.toggle('hidden', !!bs || !!r.exactComing);
    if (bs) {
      $('st-sync-text').textContent = bs.waiting ? f(T.syncWaitVideo, {name: nameOf(bs)}) : f(T.syncRunning, {p: bs.percent, name: nameOf(bs)});
      $('st-sync-fill').style.width = bs.percent + '%';
      $('st-sync-pct').textContent = bs.percent + '%';
      const eta = bs.waiting ? null : bs.etaSec;
      $('st-sync-eta').textContent = bs.waiting ? '' : eta === null || eta === undefined ? T.syncEtaWait : f(T.syncEta, {t: fmtEta(eta)});
    } else if (r.exactComing) {
      $('st-sync-text').textContent = f(T.syncWaitExact, {name: nameOf(r.exactComing)});
    } else if (syncShown) {
      $('st-sync-text').textContent = ls.outcome === 'moved' ? f(T.syncMoved, {name: nameOf(ls), s: (Math.abs(ls.offsetMs || 0) / 1000).toFixed(1)}) : ls.outcome === 'inSync' ? f(T.syncInSync, {name: nameOf(ls)}) : ls.outcome === 'unavailable' ? f(T.syncUnavailable, {name: nameOf(ls)}) : f(T.syncKept, {name: nameOf(ls)});
    }
    const q = r.quota;
    $('st-quota').classList.toggle('hidden', !q);
    if (q) {
      const used = q.limit - q.left;
      const share = Math.min(100, Math.round((used / q.limit) * 100));
      $('st-quota-text').textContent = used + ' / ' + q.limit;
      $('st-quota-bar').style.width = share + '%';
      $('st-quota-bar').className = 'h-full rounded-full transition-[width] duration-500 ' + (share >= 90 ? 'bg-rose-400' : share >= 70 ? 'bg-amber-400' : 'bg-warm-ok');
      const hint = $('st-quota-hint');
      hint.textContent = q.left === 0 ? T.stQuotaOut : q.left < 10 ? f(T.stQuotaLow, {n: q.left}) : '';
      hint.classList.toggle('hidden', !hint.textContent);
    }
    if (subdlOn) $('st-subdl-text').textContent = f(T.stSubdlCount, {n: r.subdlDownloads || 0});
    // Always a normal button; it only lights up when there is something to continue.
    const up = r.upgrade;
    const upVisible = fresh(up);
    $('st-upgrade').classList.toggle('hidden', !upVisible);
    $('st-upgrade').classList.toggle('flex', upVisible);
    if (upVisible) {
      const where = up.season !== undefined && up.episode !== undefined ? (UI === 'he' ? ' עונה ' + up.season + ' פרק ' + up.episode : ' S' + up.season + 'E' + up.episode) : '';
      $('st-upgrade-text').textContent = f(T.upgradeText, {name: up.title + where});
    }
    $('resume-btn').classList.toggle('!border-warm-ac', !!r.resumable);
    $('resume-btn').classList.toggle('!text-warm-ac', !!r.resumable);
    renderQueue(r.queue || []);
    renderStop(r.queue || []);
  } catch { /* the app may be restarting */ }
};
refreshStatus();
setInterval(refreshStatus, 1500);

// Subtitle library: everything translated so far, grouped by title, with delete.
const sizeText = (b) => b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : b < 1073741824 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1073741824).toFixed(2) + ' GB';
const muxJobs = new Map();
const muxPaint = new Map();
const dateText = (ms) => new Date(ms).toLocaleDateString(UI === 'he' ? 'he-IL' : 'en-GB');
let libItems = [];
const picked = new Set();
const openGroups = new Set();
const checkbox = (checked, indeterminate, label, onChange) => {
  const c = el('input', 'h-4 w-4 shrink-0 cursor-pointer accent-warm-ac');
  c.type = 'checkbox'; c.checked = checked; c.indeterminate = indeterminate; c.setAttribute('aria-label', label);
  c.addEventListener('change', () => onChange(c.checked));
  return c;
};
const setPicked = (ids, on) => { for (const id of ids) { if (on) picked.add(id); else picked.delete(id); } drawLib(); };
const groupState = (ids) => { const n = ids.filter(id => picked.has(id)).length; return {checked: n > 0 && n === ids.length, partial: n > 0 && n < ids.length}; };
const episodeRow = (e) => {
  const row = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 text-sm transition hover:bg-warm-bg');
  const pick = el('label', 'flex min-w-0 flex-1 cursor-pointer items-center gap-3');
  pick.append(checkbox(picked.has(e.id), false, e.title, (on) => setPicked([e.id], on)));
  const name = e.kind === 'series' ? f(T.libEpisode, {n: e.episode ?? '?'}) : (e.label || T.libSubtitle);
  pick.append(el('span', 'min-w-0 flex-1 truncate font-medium text-warm-tx', name));
  row.append(pick);
  const meta = el('span', 'flex shrink-0 items-center gap-3 text-xs text-warm-mu');
  const ltr = (text) => { const s = el('span', '', text); s.dir = 'ltr'; return s; };
  if (e.timing) {
    const TIMING = {
      exact: {color: '76,195,138', hex: '#4cc38a', paths: '<path d="M5 12l5 5L20 7"/>', text: T.libExact},
      speech: {color: '90,169,240', hex: '#5aa9f0', paths: '<path d="M5 10v4M9 7v10M13 4v16M17 8v8M21 11v2"/>', text: T.libSpeech},
      estimated: {color: '240,138,75', hex: '#f08a4b', paths: '<path d="M3 12c3-6 6 6 9 0s6 6 9 0"/>', text: T.libEstimated},
    };
    const kind = TIMING[e.timing];
    const badge = el('span', 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold');
    badge.style.cssText = 'color:' + kind.hex + ';border-color:' + kind.hex + ';background:rgba(' + kind.color + ',.1)';
    const tIcon = el('span', 'inline-flex');
    tIcon.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + kind.paths + '</svg>';
    badge.append(tIcon, el('span', '', kind.text));
    badge.title = e.timing === 'exact' ? T.libExactTip : e.timing === 'speech' ? T.libSpeechTip : T.libEstimatedTip;
    meta.append(badge);
  }
  if (e.source) {
    const SRC_NAME = {subdl: 'SubDL', opensubtitles: 'OpenSubtitles', jimaku: 'Jimaku', video: T.libSrcVideo};
    const how = e.source.kind === 'direct' ? T.libSrcDirect : f(T.libSrcTranslated, {l: e.source.language.toUpperCase()});
    const origin = el('span', 'rounded-full border border-warm-ln px-2 py-0.5 text-[11px] font-semibold text-warm-tx', SRC_NAME[e.source.provider] + ' · ' + how);
    origin.title = T.libSrcTip;
    meta.append(origin);
  }
  meta.append(el('span', '', f(T.libLines, {n: e.cues})), ltr(dateText(e.createdAt)), ltr(sizeText(e.bytes)));
  row.append(meta);
  const btnCls = 'inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-warm-ln px-2.5 py-1 text-xs font-semibold text-warm-mu transition hover:border-warm-ac/60 hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac';
  const icon = (paths) => { const s = el('span', 'inline-flex'); s.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + paths + '</svg>'; return s; };
  const dl = el('a', btnCls);
  dl.append(icon('<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>'), el('span', '', T.libSubsBtn));
  dl.href = '/api/library/' + e.id + '/srt';
  dl.title = T.libSrtTip;
  dl.addEventListener('click', async (ev) => {
    ev.preventDefault();
    try {
      const r = await fetch(dl.href);
      if (!r.ok) throw new Error('no file');
      const a = el('a');
      a.href = URL.createObjectURL(await r.blob());
      a.download = (e.title.replace(/[/:*?"<>|]/g, ' ').trim() || 'subtitle') + (e.kind === 'series' ? ' S' + String(e.season ?? 0).padStart(2, '0') + 'E' + String(e.episode ?? 0).padStart(2, '0') : '') + '.' + e.language + '.srt';
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    } catch { toast(false, T.libSrtFail); }
  });
  const actions = el('span', 'flex shrink-0 flex-wrap items-center gap-2');
  actions.append(dl);
  row.append(actions);
  if (window.desktop && window.desktop.pickVideo) {
    const wrap = el('span', '');
    wrap.style.position = 'relative';
    const mux = el('button', btnCls);
    mux.type = 'button';
    const muxLabel = el('span', '', T.libVideoBtn);
    mux.append(icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9.5v5l4.5-2.5z"/>'), muxLabel, el('span', '', '▾'));
    const menu = el('div', 'rounded-2xl border border-warm-ln bg-warm-sf p-1.5 text-sm');
    menu.hidden = true;
    menu.style.cssText = 'position:absolute;inset-inline-end:0;top:calc(100% + 6px);z-index:20;min-width:210px;box-shadow:0 8px 24px rgba(0,0,0,.35)';
    const closeMenu = () => { menu.hidden = true; };
    const sizeSpans = [];
    let sizesAsked = false;
    mux.addEventListener('click', (ev) => {
      ev.stopPropagation();
      menu.hidden = !menu.hidden;
      if (menu.hidden || sizesAsked) return;
      sizesAsked = true;
      fetch('/api/library/' + e.id + '/stream').then((r) => r.json()).then((s) => {
        if (s.bytes) for (const sp of sizeSpans) sp.textContent = '~' + sizeText(s.bytes);
      }).catch(() => {});
    });
    document.addEventListener('click', closeMenu);
    const muxOption = (name, desc, tip, format) => {
      const item = el('button', 'flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-start text-warm-tx transition hover:bg-warm-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac');
      item.type = 'button';
      item.title = tip;
      const label = el('span', 'flex flex-col');
      label.append(el('span', 'text-sm font-bold', name), el('span', 'text-xs text-warm-mu', desc));
      const size = el('span', 'text-xs font-semibold text-warm-ac');
      size.dir = 'ltr';
      sizeSpans.push(size);
      item.append(label, size);
      item.addEventListener('click', () => { closeMenu(); runMux(format); });
      return item;
    };
    menu.append(muxOption('MKV', T.libMkvDesc, T.libMuxTip, 'mkv'), muxOption('MP4', T.libMp4Desc, T.libMuxMp4Tip, 'mp4'));
    wrap.append(mux, menu);
    const panel = el('div', 'hidden w-full items-center gap-3 text-xs');
    panel.style.flexBasis = '100%';
    const edge = el('div');
    edge.style.cssText = 'position:absolute;inset-inline:0;bottom:0;height:3px;background:#352e25;border-radius:0 0 12px 12px;display:none';
    const edgeFill = el('i');
    edgeFill.style.cssText = 'display:block;height:100%;background:#e8b25c;width:0%';
    edge.append(edgeFill);
    row.style.position = 'relative';
    row.append(panel, edge);
    const etaText = (s) => s < 60 ? s + (UI === 'he' ? ' שנ׳' : ' s') : Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + (UI === 'he' ? ' דק׳' : ' min');
    const smallBtn = (cls, label, onClick) => { const b = el('button', btnCls + ' ' + cls, label); b.type = 'button'; b.addEventListener('click', onClick); return b; };
    const paint = () => {
      const st = muxJobs.get(e.id);
      panel.replaceChildren();
      if (!st) { panel.classList.add('hidden'); panel.classList.remove('flex'); edge.style.display = 'none'; mux.disabled = false; return; }
      panel.classList.remove('hidden'); panel.classList.add('flex');
      if (st.phase === 'run') {
        mux.disabled = true;
        edge.style.display = 'block';
        edgeFill.style.width = (st.percent ?? 0) + '%';
        const text = el('span', 'min-w-0 flex-1 text-warm-mu');
        text.append(el('b', 'font-semibold text-warm-tx', f(T.libSaving, {f: st.format.toUpperCase()})));
        if (st.percent !== null) text.append(' · ' + st.percent + '%');
        if (st.etaSec) text.append(' · ' + f(T.libLeft, {t: etaText(st.etaSec)}));
        if (st.bytes) text.append(' · ', ltr(sizeText(st.bytes) + (st.totalBytes ? ' / ' + sizeText(st.totalBytes) : '')));
        const cancel = smallBtn('text-rose-300 border-rose-400/50', T.libCancel, () => { cancel.disabled = true; fetch('/api/mux/' + st.task + '/cancel', {method: 'POST'}).catch(() => {}); });
        panel.append(text, cancel);
        return;
      }
      mux.disabled = false;
      edge.style.display = 'none';
      row.classList.add('bg-warm-ok/10');
      const ready = el('span', 'inline-flex items-center gap-1.5 font-semibold text-warm-ok');
      ready.append(icon('<path d="M5 12l5 5L20 7"/>'), el('span', '', T.libReady));
      const chip = el('span', 'rounded-full border border-warm-ln px-2 py-0.5 text-[11px] font-semibold text-warm-tx');
      chip.dir = 'ltr'; chip.textContent = sizeText(st.bytes || 0);
      const spacer = el('span', 'flex-1');
      panel.append(ready, st.bytes ? chip : '', spacer);
      if (window.desktop.revealVideo) {
        const show = smallBtn('', '', () => window.desktop.revealVideo(st.path));
        show.title = T.libShowFolder; show.setAttribute('aria-label', T.libShowFolder);
        show.append(icon('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'));
        panel.append(show);
      }
      const close = smallBtn('', '', () => { muxJobs.delete(e.id); row.classList.remove('bg-warm-ok/10'); paint(); });
      close.title = T.libClose; close.setAttribute('aria-label', T.libClose);
      close.append(icon('<path d="M6 6l12 12M18 6L6 18"/>'));
      panel.append(close);
    };
    muxPaint.set(e.id, paint);
    paint();
    const runMux = (format) => {
      (async () => {
        let payload = null;
        const name = e.kind === 'series' ? e.title + ' S' + String(e.season ?? 0).padStart(2, '0') + 'E' + String(e.episode ?? 0).padStart(2, '0') : e.title;
        try {
          const s = await (await fetch('/api/library/' + e.id + '/stream')).json();
          if (s.ok) {
            const out = await window.desktop.saveVideo(name, format);
            if (!out) return;
            payload = {stremio: true, output: out};
          }
        } catch { payload = null; }
        const video = payload ? 'stremio' : await window.desktop.pickVideo(name);
        if (!video) return;
        const task = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
        const st = {phase: 'run', format, task, percent: null, etaSec: null, bytes: 0, totalBytes: null};
        muxJobs.set(e.id, st);
        (muxPaint.get(e.id) || paint)();
        const timer = setInterval(async () => {
          try {
            const p = await (await fetch('/api/mux/' + task)).json();
            if (p.ok) { st.percent = p.percent; st.etaSec = p.etaSec; st.bytes = p.bytes; st.totalBytes = p.totalBytes; (muxPaint.get(e.id) || paint)(); }
          } catch { /* the next tick tries again */ }
        }, 1000);
        try {
          const r = await fetch('/api/library/' + e.id + '/mux', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({...(payload || {video, format}), task})});
          const j = await r.json();
          if (j.ok) muxJobs.set(e.id, {phase: 'done', path: j.path, bytes: j.bytes, name: j.name});
          else {
            muxJobs.delete(e.id);
            if (j.code === 'CANCELLED') toast(true, T.libCancelled);
            else toast(false, j.code === 'NO_FFMPEG' ? T.libMuxNoFfmpeg : (j.code === 'NOT_A_VIDEO' || j.code === 'BAD_PATH') ? T.libMuxBadFile : T.libMuxFail);
          }
        } catch { muxJobs.delete(e.id); toast(false, T.libMuxFail); }
        clearInterval(timer);
        (muxPaint.get(e.id) || paint)();
      })();
    };
    actions.append(wrap);
  }
  return row;
};
const section = (key, title, count, items, body) => {
  const d = el('details', 'rounded-2xl border border-warm-ln bg-warm-sf');
  d.open = openGroups.has(key);
  d.addEventListener('toggle', () => { if (d.open) openGroups.add(key); else openGroups.delete(key); });
  const s = el('summary', 'flex cursor-pointer list-none items-center gap-3 p-3.5');
  const ids = items.map(e => e.id), st = groupState(ids);
  s.append(checkbox(st.checked, st.partial, title, (on) => setPicked(ids, on)));
  s.append(el('span', 'min-w-0 flex-1 truncate text-sm font-bold text-warm-tx', title));
  s.append(el('span', 'shrink-0 text-xs text-warm-mu', count));
  d.append(s, body);
  return d;
};
const drawLib = () => {
  const list = $('lib-list');
  list.replaceChildren();
  const films = new Map();
  for (const e of libItems.filter(e => e.kind === 'movie')) {
    if (!films.has(e.titleKey)) films.set(e.titleKey, {title: e.title, items: []});
    films.get(e.titleKey).items.push(e);
  }
  const shows = new Map();
  for (const e of libItems.filter(e => e.kind === 'series')) {
    if (!shows.has(e.titleKey)) shows.set(e.titleKey, {title: e.title, items: []});
    shows.get(e.titleKey).items.push(e);
  }
  const groups = [
    ...[...films.entries()].map(([key, g]) => ['m:' + key, g, true]),
    ...[...shows.entries()].map(([key, g]) => [key, g, false]),
  ].sort((a, b) => a[1].title.localeCompare(b[1].title));
  for (const [key, g, isFilm] of groups) {
    if (isFilm) {
      const body = el('div', 'flex flex-col gap-0.5 px-3 pb-3');
      g.items.forEach((e, i) => { e.label = g.items.length > 1 ? f(T.libSubtitleN, {n: i + 1}) : ''; body.append(episodeRow(e)); });
      list.append(section(key, g.title, f(T.libSubtitleCount, {n: g.items.length}), g.items, body));
      continue;
    }
    const bySeason = new Map();
    for (const e of g.items) { const s = e.season ?? 1; if (!bySeason.has(s)) bySeason.set(s, []); bySeason.get(s).push(e); }
    const body = el('div', 'flex flex-col gap-2 px-3 pb-3');
    for (const [s, eps] of [...bySeason.entries()].sort((a, b) => a[0] - b[0])) {
      eps.sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0));
      const ids = eps.map(e => e.id), st = groupState(ids);
      const head = el('label', 'flex cursor-pointer items-center gap-3 px-2 pt-1 text-xs font-bold uppercase tracking-wide text-warm-ac');
      head.append(checkbox(st.checked, st.partial, f(T.libSeason, {n: s}), (on) => setPicked(ids, on)), el('span', '', f(T.libSeason, {n: s})));
      body.append(head);
      for (const e of eps) body.append(episodeRow(e));
    }
    list.append(section(key, g.title, f(T.libEpisodes, {n: g.items.length}), g.items, body));
  }
  $('lib-empty').hidden = libItems.length > 0;
  const total = libItems.reduce((n, e) => n + e.bytes, 0);
  $('lib-total').textContent = libItems.length ? f(T.libTotal, {n: libItems.length}) : '';
  $('lib-size').textContent = libItems.length ? f(T.libSize, {size: sizeText(total)}) : '';
  const everyPicked = libItems.length > 0 && libItems.every(e => picked.has(e.id));
  $('lib-all').textContent = everyPicked ? T.libSelectNone : T.libSelectAll;
  $('lib-all').hidden = libItems.length === 0;
  const sel = $('lib-del-sel');
  sel.disabled = picked.size === 0;
  $('lib-sel-count').textContent = f(T.libSelectedCount, {n: picked.size});
  $('lib-sel-bar').classList.toggle('hidden', picked.size === 0);
  $('lib-sel-bar').classList.toggle('flex', picked.size > 0);
  $('lib-del-all').disabled = libItems.length === 0;
};
const loadLib = async () => {
  try {
    const r = await (await fetch('/api/library')).json();
    libItems = r.ok ? r.items : [];
    show('lib-result', null, '');
    if (libItems.length <= 3) for (const e of libItems) openGroups.add(e.kind === 'movie' ? 'm:' + e.titleKey : e.titleKey);
  } catch { libItems = []; show('lib-result', false, T.libLoadFail); }
  for (const id of [...picked]) if (!libItems.some(e => e.id === id)) picked.delete(id);
  drawLib();
};
$('open-library').addEventListener('click', () => setView('lib'));
$('lib-back').addEventListener('click', () => setView('dash'));
$('lib-all').addEventListener('click', () => {
  const every = libItems.length > 0 && libItems.every(e => picked.has(e.id));
  setPicked(libItems.map(e => e.id), !every);
});
$('lib-none').addEventListener('click', () => setPicked([...picked], false));
const delModal = $('del-modal');
let pendingDelete = null;
const setDelModal = (open) => { delModal.classList.toggle('hidden', !open); delModal.classList.toggle('flex', open); };
const askDelete = (all) => {
  pendingDelete = all ? {all: true} : {ids: [...picked]};
  $('del-title').textContent = all ? T.libConfirmAll : f(T.libConfirmSel, {n: picked.size});
  setDelModal(true);
};
$('lib-del-sel').addEventListener('click', () => { if (picked.size) askDelete(false); });
$('lib-del-all').addEventListener('click', () => askDelete(true));
$('del-no').addEventListener('click', () => setDelModal(false));
delModal.addEventListener('click', (e) => { if (e.target === delModal) setDelModal(false); });
$('del-yes').addEventListener('click', async () => {
  const job = pendingDelete; setDelModal(false);
  if (!job) return;
  try {
    let removed = 0;
    if (job.all) { const r = await post('/api/library/delete', {all: true}); if (!r.ok) throw new Error(); removed = r.removed; }
    else for (let i = 0; i < job.ids.length; i += 150) {
      const r = await post('/api/library/delete', {ids: job.ids.slice(i, i + 150)});
      if (!r.ok) throw new Error();
      removed += r.removed;
    }
    picked.clear();
    toast(true, f(T.libDeleted, {n: removed}));
  } catch { toast(false, T.libDeleteFail); }
  loadLib();
});
// News and updates (the bell): messages from the author and the release notes of every version.
const newsPanel = $('news-panel');
const setNews = (open) => { newsPanel.classList.toggle('hidden', !open); newsPanel.classList.toggle('flex', open); };
let newsData = null;
const unseenIds = () => {
  if (!newsData) return [];
  const seen = new Set(newsData.seen);
  const ids = newsData.items.map(i => i.id).filter(id => !seen.has(id));
  const latest = newsData.releases[0];
  if (latest && !seen.has('release-' + latest.version)) ids.push('release-' + latest.version);
  return ids;
};
const drawBadge = () => {
  const n = unseenIds().length;
  document.querySelectorAll('.js-news-badge').forEach(b => { b.textContent = String(n); b.classList.toggle('hidden', n === 0); b.classList.toggle('inline-flex', n > 0); });
};
const loadNews = async () => {
  try { const r = await (await fetch('/api/news')).json(); newsData = r.ok ? r : null; } catch { newsData = null; }
  drawBadge();
};
// A release note: a plain bullet, or a short title card that opens to show its explanation.
const noteNode = (n) => {
  const li = el('li', typeof n === 'string' ? 'flex gap-2.5' : 'list-none');
  if (typeof n === 'string') {
    li.append(el('span', 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warm-ac'), el('span', '', n));
    return li;
  }
  const d = el('details', 'group rounded-xl border border-warm-ln bg-warm-sf');
  const sum = el('summary', 'flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-sm font-semibold text-warm-tx');
  sum.append(el('span', '', n.title), el('span', 'text-warm-mu transition group-open:rotate-180', '▾'));
  d.append(sum, el('p', 'px-3 pb-3 text-sm leading-relaxed text-warm-mu', n.text));
  li.append(d);
  return li;
};
const tag = () => el('span', 'rounded-full bg-warm-ac px-2 py-0.5 text-[10px] font-bold text-warm-on', T.newsNew);
const drawNews = () => {
  const body = $('news-body');
  body.replaceChildren();
  if (!newsData) { body.append(el('p', 'text-sm text-warm-mu', T.newsOffline)); return; }
  const seen = new Set(newsData.seen);
  if (!newsData.online) body.append(el('p', 'rounded-xl border border-warm-ln px-3 py-2 text-xs text-warm-mu', T.newsOffline));
  if (newsData.items.length) body.append(el('h3', 'text-xs font-bold uppercase tracking-wide text-warm-ac', T.newsFromCreator));
  for (const i of newsData.items) {
    const card = el('div', 'rounded-2xl border border-warm-ln bg-warm-bg p-3.5');
    const head = el('div', 'flex items-start justify-between gap-3');
    head.append(el('div', 'text-sm font-bold text-warm-tx', i.title[UI]));
    const meta = el('div', 'flex shrink-0 items-center gap-2 text-xs text-warm-mu');
    if (!seen.has(i.id)) meta.append(tag());
    const day = el('span', '', i.date); day.dir = 'ltr'; meta.append(day);
    head.append(meta);
    card.append(head, el('p', 'mt-1.5 whitespace-pre-line text-sm text-warm-tx/90', i.body[UI]));
    if (i.link) {
      const a = el('a', 'mt-2 inline-block text-xs font-semibold text-warm-ac hover:underline', T.newsLink);
      a.href = i.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      card.append(a);
    }
    body.append(card);
  }
  body.append(el('h3', 'mt-2 text-xs font-bold uppercase tracking-wide text-warm-ac', T.newsWhatsNew));
  // The newest three versions are listed; older ones stay behind a button so the list stays short.
  const VISIBLE = 3;
  const older = el('div', 'hidden flex-col gap-2.5');
  newsData.releases.forEach((r, idx) => {
    const d = el('details', 'rounded-2xl border border-warm-ln bg-warm-bg');
    d.open = idx === 0;
    const s = el('summary', 'flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 text-sm font-bold text-warm-tx');
    s.append(el('span', '', f(T.newsVersion, {v: r.version})));
    if (idx === 0 && !seen.has('release-' + r.version)) s.append(tag());
    const ul = el('ul', 'space-y-1.5 px-3.5 pb-3.5 text-sm text-warm-tx/90');
    for (const n of (r.notes[UI] || r.notes.en)) ul.append(noteNode(n));
    d.append(s, ul);
    (idx < VISIBLE ? body : older).append(d);
  });
  const extra = newsData.releases.length - VISIBLE;
  if (extra > 0) {
    const more = el('button', 'rounded-2xl border border-warm-ln px-4 py-2 text-sm font-semibold text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac', f(T.newsOlder, {n: extra}));
    more.type = 'button';
    more.addEventListener('click', () => {
      const show = older.classList.contains('hidden');
      older.classList.toggle('hidden', !show); older.classList.toggle('flex', show);
      more.textContent = show ? T.newsHideOlder : f(T.newsOlder, {n: extra});
    });
    body.append(more, older);
  }
};
const openNews = async () => {
  await loadNews();
  drawNews();
  setNews(true);
  const ids = unseenIds();
  if (ids.length) {
    try { const r = await post('/api/news/seen', {ids}); if (r.ok) { newsData.seen.push(...ids); drawBadge(); } } catch { /* shown as new once more */ }
  }
};
document.querySelectorAll('.js-news').forEach(b => b.addEventListener('click', openNews));
$('news-panel-close').addEventListener('click', () => setNews(false));
newsPanel.addEventListener('click', (e) => { if (e.target === newsPanel) setNews(false); });
loadNews();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDrawer(false); setDelModal(false); setNews(false); setSyncModal(false); } });
if (window.desktop) {
  window.desktop.setLanguage(UI);
  const maxIcon = $('win-max-icon');
  $('win-max').addEventListener('click', () => window.desktop.toggleMaximize());
  window.desktop.onMaximizeChange((m) => { maxIcon.setAttribute('width', m ? '7' : '9'); maxIcon.setAttribute('height', m ? '7' : '9'); maxIcon.setAttribute('y', m ? '2.5' : '.5'); });
  $('win-min').addEventListener('click', () => window.desktop.minimize());
  const modal = $('exit-modal');
  const setModal = (open) => { modal.classList.toggle('hidden', !open); modal.classList.toggle('flex', open); };
  $('win-close').addEventListener('click', () => setModal(true));
  $('exit-cancel').addEventListener('click', () => setModal(false));
  $('exit-tray').addEventListener('click', () => { setModal(false); window.desktop.hide(); });
  $('exit-quit').addEventListener('click', () => window.desktop.quit());
  modal.addEventListener('click', (e) => { if (e.target === modal) setModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setModal(false); });

  // Updates: top-bar button only when an update is downloaded; manual check lives in Settings.
  const updateBtn = $('update-btn');
  const checkBtn = $('check-update');
  const UPDATE_TEXT = {
    checking: [true, T.updChecking],
    none: [true, T.updNone],
    unavailable: [true, T.updUnavailable],
    error: [false, T.updError]
  };
  // The button's own display class would override the hidden attribute, so toggle classes instead.
  const showUpdateBtn = (on) => { updateBtn.classList.toggle('hidden', !on); updateBtn.classList.toggle('inline-flex', on); };
  const applyUpdate = (s) => {
    showUpdateBtn(s.status === 'downloaded');
    if (s.status === 'downloaded') updateBtn.title = f(T.updateInstallV, {v: s.version});
    const out = $('update-result');
    if (!out) return;
    if (s.status === 'downloading') show('update-result', true, f(T.updDownloading, {v: s.version}));
    else if (s.status === 'downloaded') show('update-result', true, f(T.updReady, {v: s.version}));
    else if (UPDATE_TEXT[s.status]) show('update-result', ...UPDATE_TEXT[s.status]);
    else out.textContent = '';
    checkBtn.disabled = s.status === 'checking';
  };
  window.desktop.updater.state().then((s) => showUpdateBtn(s.status === 'downloaded'));
  window.desktop.updater.onState(applyUpdate);
  updateBtn.addEventListener('click', () => window.desktop.updater.install());
  checkBtn.addEventListener('click', () => window.desktop.updater.check().then(applyUpdate));
  window.desktop.version().then((v) => { $('app-version').textContent = v; });

  // What's New: shown once, on the first launch after an update, in the screen's language.
  const news = $('news-modal');
  const closeNews = () => { news.classList.add('hidden'); news.classList.remove('flex'); window.desktop.whatsNew.dismiss(); };
  window.desktop.whatsNew.get(UI).then((w) => {
    if (!w) return;
    $('news-version').textContent = w.version;
    const list = $('news-list');
    for (const n of w.notes) list.append(noteNode(n));
    news.classList.remove('hidden');
    news.classList.add('flex');
  });
  $('news-close').addEventListener('click', closeNews);
}
for (const [btnId, fieldId] of [['copy', 'manifest'], ['copy-d', 'manifest-d']]) {
  const copyBtn = $(btnId);
  if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard.writeText($(fieldId).value); toast(true, ${JSON.stringify(t(lang, 'copied'))}); });
}
</script>
</body></html>`;
}
