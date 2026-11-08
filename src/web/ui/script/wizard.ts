import type { UiCtx } from '../context';

/** Views, the setup wizard and the start-with-Windows switches. */
export function scriptWizard(c: UiCtx): string {
  const { startStep } = c;
  return `// Three views share the page: wizard, main screen (dash) and the subtitle library.
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
  document.querySelectorAll('[data-chip]').forEach(c => {
    const n = Number(c.dataset.chip);
    c.classList.toggle('border-warm-ac', n === step); c.classList.toggle('text-warm-ac', n === step);
    c.classList.toggle('border-warm-ln', n !== step); c.classList.toggle('text-warm-mu', n !== step);
    c.classList.toggle('text-warm-tx', false);
  });
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
`;
}
