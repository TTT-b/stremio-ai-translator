import type { UiCtx } from '../context';

/** Settings drawer, connection checks, password eye and developer settings. */
export function scriptDrawer(_c: UiCtx): string {
  return `// Settings drawer.
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
// Model chooser (only on the page when an AI key is saved): the list comes from the provider itself.
const modelSel = $('d-model');
const modelRes = $('d-model-result');
const modelAuto = $('d-auto-model');
const saveModel = async () => {
  if (!modelSel) return true;
  const patch = {};
  if (drawerSnap.get(modelSel) !== modelSel.value) patch.aiModels = {[modelRes.dataset.provider]: modelSel.value};
  if (modelAuto && drawerSnap.get(modelAuto) !== modelAuto.checked) patch.autoSwitchModel = modelAuto.checked;
  if (!Object.keys(patch).length) return true;
  try { return (await post('/api/settings', patch)).ok; } catch { return false; }
};
const loadModels = async () => {
  show('d-model-result', null, T.modelLoading);
  $('d-model-refresh').disabled = true;
  try {
    const r = await post('/api/models', {});
    if (!r.ok) { show('d-model-result', false, r.code === 'CONFIGURATION_INVALID' ? T.modelNoKey : errText(r, T.modelListFail)); return; }
    const keep = modelSel.value;
    const ids = r.models.map((m) => m.id);
    if (keep && !ids.includes(keep)) ids.unshift(keep);
    modelSel.textContent = '';
    for (const id of ids) { const o = document.createElement('option'); o.value = id; o.textContent = id; modelSel.appendChild(o); }
    modelSel.value = keep;
    // The refreshed list is not a change the user made.
    drawerSnap.set(modelSel, keep);
    show('d-model-result', true, f(r.provider === 'openai' ? T.modelLoadedGuess : T.modelLoaded, {n: r.models.length}));
  } catch { show('d-model-result', false, T.modelListFail); }
  finally { $('d-model-refresh').disabled = false; }
};
if (modelSel) {
  $('d-model-refresh').addEventListener('click', loadModels);
  let modelsLoaded = false;
  modelSel.closest('details').addEventListener('toggle', (e) => { if (e.target.open && !modelsLoaded) { modelsLoaded = true; loadModels(); } });
}
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
    if (r.ok && !(await saveModel())) { show('save-result', false, FAILED); toast(false, FAILED); return; }
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
  if (name === 'subdl' && !subdlOn) { show(id, null, T.testNoKeySubdl); return; }
  if (name === 'jimaku' && !jimakuOn) { show(id, null, T.testNoKeyJimaku); return; }
  show(id, null, T.testing);
  try { const r = await post('/api/test/' + name); show(id, r.ok, r.ok ? TEST_OK[name] : errText(r, FAILED)); }
  catch { show(id, false, FAILED); }
}));
// One button for all the checks on the main screen; each provider still shows its own result.
$('checks-all').addEventListener('click', () => {
  document.querySelectorAll('[data-test][data-rp="dr-"]').forEach((b) => {
    const n = b.dataset.test;
    if ((n === 'subdl' && !subdlOn) || (n === 'jimaku' && !jimakuOn)) return; // not set up: nothing to check
    b.click();
  });
});
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
`;
}
