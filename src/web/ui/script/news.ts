import { t } from '../../i18n';
import type { UiCtx } from '../context';
import { NEWS_TARGETS } from '../../newsTargets';

/** News and updates, copy buttons. */
export function scriptNews(c: UiCtx): string {
  const { lang } = c;
  return `// News and updates (the bell): the release notes of every version.
const newsPanel = $('news-panel');
const setNews = (open) => { newsPanel.classList.toggle('hidden', !open); newsPanel.classList.toggle('flex', open); };
let newsData = null;
const unseenIds = () => {
  if (!newsData) return [];
  const seen = new Set(newsData.seen);
  const ids = [];
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
  if (n.summary) {
    const s = el('li', 'list-none space-y-2');
    s.append(el('p', 'text-sm leading-relaxed text-warm-tx', n.summary), el('p', 'text-xs text-warm-mu', T.newsMore));
    return s;
  }
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
// The "show me what is new" tour: a bubble in the app's colours that walks from change to change and points at the real element.
const NEWS_TARGETS = ${JSON.stringify(NEWS_TARGETS)};
const TOUR_MAX = 5;
const EYE = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1.5 10S5 4 10 4s8.5 6 8.5 6-3.5 6-8.5 6S1.5 10 1.5 10z"/><circle cx="10" cy="10" r="2.5"/></svg>';
let tourGuards = [], tourRestore = [], tourToken = 0;
const tourClear = () => {
  tourToken++;
  tourLive = null;
  document.querySelectorAll('.tour-spot').forEach(e => e.classList.remove('tour-spot'));
  const b = $('tour-bubble'); if (b) b.remove();
  tourGuards.forEach(o => o.disconnect()); tourGuards = [];
  tourRestore.forEach(fn => fn()); tourRestore = [];
};
// The screen hides some elements again on every refresh, so a revealed one is kept visible while its step is open.
const tourPin = (target) => {
  for (let n = target; n && n !== document.body; n = n.parentElement) {
    const x = n;
    if (x.classList.contains('hidden')) { x.classList.remove('hidden'); tourRestore.push(() => x.classList.add('hidden')); }
    const o = new MutationObserver(() => { if (x.classList.contains('hidden')) x.classList.remove('hidden'); });
    o.observe(x, {attributes: true, attributeFilter: ['class']}); tourGuards.push(o);
  }
};
const tourColour = (cls, prop) => { const d = el('div', cls); d.style.display = 'none'; document.body.append(d); const v = getComputedStyle(d)[prop]; d.remove(); return v; };
const tourStyle = () => {
  if ($('tour-style')) return;
  const acc = tourColour('bg-warm-ac', 'backgroundColor');
  const st = el('style'); st.id = 'tour-style';
  // The page's content policy only allows styles that carry its nonce.
  const owner = document.querySelector('style[nonce], script[nonce]'); if (owner) st.nonce = owner.nonce;
  st.textContent = '.tour-spot{position:relative;z-index:50!important;outline:3px solid ' + acc + ';outline-offset:3px;border-radius:14px;box-shadow:0 0 0 9999px rgba(0,0,0,.6)}'
    + '#tour-bubble{position:absolute;z-index:70;width:300px;max-width:calc(100vw - 16px);padding:14px;box-shadow:0 10px 30px #000a;border:1px solid ' + acc + '}'
    + '#tour-arrow{position:absolute;width:14px;height:14px;transform:rotate(45deg);border:1px solid ' + acc + '}';
  document.head.append(st);
};
const tourButton = (cls, label, fn) => { const b = el('button', 'rounded-xl px-4 py-1.5 text-xs font-bold transition hover:opacity-90 ' + cls, label); b.type = 'button'; b.addEventListener('click', fn); return b; };
const tourFind = (n) => { const tg = NEWS_TARGETS[n.show]; const node = tg && document.querySelector(tg.selector); return node ? {node, reveal: !!tg.reveal} : null; };
// Puts the bubble next to the highlighted element; runs again when the window size changes.
let tourLive = null, tourResizeTimer = 0;
const tourPlace = () => {
  if (!tourLive) return;
  const {node, bub, arrow} = tourLive, r = node.getBoundingClientRect();
  const w = Math.min(300, window.innerWidth - 16);
  bub.style.width = w + 'px';
  const bh = bub.offsetHeight, below = r.bottom + 14 + bh < window.innerHeight;
  const left = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), window.innerWidth - w - 8);
  bub.style.top = Math.max(window.scrollY + 8, (below ? r.bottom + 14 : r.top - 14 - bh) + window.scrollY) + 'px';
  bub.style.left = left + 'px';
  arrow.style.left = Math.min(w - 28, Math.max(14, r.left + r.width / 2 - left - 7)) + 'px';
  arrow.style.top = below ? '-8px' : 'auto'; arrow.style.bottom = below ? 'auto' : '-8px';
  arrow.style.borderWidth = below ? '1px 0 0 1px' : '0 1px 1px 0';
};
window.addEventListener('resize', () => {
  if (!tourLive) return;
  clearTimeout(tourResizeTimer);
  tourResizeTimer = setTimeout(() => { if (tourLive) { tourLive.node.scrollIntoView({block: 'center'}); tourPlace(); } }, 120);
});
const tourStep = (steps, i) => {
  tourClear();
  const n = steps[i], hit = tourFind(n);
  if (!hit) return;
  tourStyle();
  if (hit.reveal) tourPin(hit.node);
  hit.node.scrollIntoView({block: 'center', behavior: 'smooth'});
  hit.node.classList.add('tour-spot');
  const token = tourToken;
  setTimeout(() => {
    if (token !== tourToken) return;
    const bub = el('div', 'rounded-2xl bg-warm-sf text-warm-tx'); bub.id = 'tour-bubble'; bub.setAttribute('role', 'dialog');
    const arrow = el('span', 'bg-warm-sf'); arrow.id = 'tour-arrow';
    const x = el('button', 'text-warm-mu', '✕'); x.type = 'button'; x.setAttribute('aria-label', T.newsClose);
    x.style.cssText = 'position:absolute;top:8px;inset-inline-end:12px'; x.addEventListener('click', tourClear);
    const last = i === steps.length - 1;
    const nav = el('div', 'mt-3 flex items-center justify-between gap-2');
    const btns = el('div', 'flex gap-2');
    if (i > 0) btns.append(tourButton('border border-warm-ln text-warm-tx', T.tourPrev, () => tourStep(steps, i - 1)));
    btns.append(tourButton('bg-warm-ac text-warm-on', last ? T.tourDone : T.tourNext, () => last ? tourClear() : tourStep(steps, i + 1)));
    const count = el('span', 'text-warm-mu', f(T.tourOf, {i: i + 1, n: steps.length})); count.style.fontSize = '11px';
    nav.append(count, btns);
    bub.append(el('div', 'mb-1 pe-5 text-sm font-bold text-warm-ac', n.title), el('div', 'text-sm leading-relaxed text-warm-tx/90', n.text), nav, x, arrow);
    document.body.append(bub);
    tourLive = {node: hit.node, bub, arrow};
    tourPlace();
  }, 450);
  setTimeout(() => { if (token === tourToken) tourPlace(); }, 1100);
};
const startTour = (notes) => {
  const steps = notes.filter(n => n && n.show && tourFind(n)).slice(0, TOUR_MAX);
  if (!steps.length) { toast(false, T.tourMissing); return; }
  setNews(false);
  const token = tourToken;
  setTimeout(() => { if (token === tourToken) tourStep(steps, 0); }, 150);
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') tourClear(); });
const tag = () => el('span', 'rounded-full bg-warm-ac px-2 py-0.5 text-[10px] font-bold text-warm-on', T.newsNew);
const drawNews = () => {
  const body = $('news-body');
  body.replaceChildren();
  if (!newsData) { body.append(el('p', 'text-sm text-warm-mu', T.newsOffline)); return; }
  const seen = new Set(newsData.seen);
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
    const notes = r.notes[UI] || r.notes.en;
    for (const n of notes) ul.append(noteNode(n));
    // Only the newest two releases get the tour: older ones point at screens that may have changed.
    if (idx < 2 && notes.some(n => n && n.show && NEWS_TARGETS[n.show])) {
      const li = el('li', 'list-none flex justify-end px-1 pt-2');
      const b = el('button', 'inline-flex items-center gap-2 rounded-xl bg-warm-ac px-4 py-2 text-xs font-bold text-warm-on transition hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac');
      b.type = 'button'; b.insertAdjacentHTML('afterbegin', EYE); b.append(el('span', '', T.tourBtn));
      b.addEventListener('click', () => startTour(notes));
      li.append(b); ul.append(li);
    }
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

  // Updates: a bar under the title bar (available, downloading, ready, failed); the manual check lives in Settings.
  const checkBtn = $('check-update');
  const UPDATE_TEXT = {
    checking: [true, T.updChecking],
    none: [true, T.updNone],
    unavailable: [true, T.updUnavailable],
    error: [false, T.updError]
  };
  const updBar = $('update-bar'), updText = $('update-text'), updDot = $('update-dot');
  const updWhy = $('update-why');
  const WHY_TEXT = { offline: T.updWhyOffline, timeout: T.updWhyTimeout, disk: T.updWhyDisk, corrupt: T.updWhyCorrupt };
  const updProg = $('update-progress'), updFill = $('update-progress-fill');
  const updInstall = $('update-install'), updDismiss = $('update-dismiss');
  const busyModal = $('update-busy-modal');
  let updErrTimer, idleTimer;
  // The bar's own display class would override the hidden attribute, so toggle classes instead.
  const setShown = (el, on, cls) => { el.classList.toggle('hidden', !on); el.classList.toggle(cls, on); };
  const applyBar = (s) => {
    clearTimeout(updErrTimer);
    const failed = s.status === 'error', ready = s.status === 'downloaded', loading = s.status === 'downloading';
    setShown(updBar, failed || ready || loading, 'flex');
    if (!(failed || ready || loading)) return;
    const pct = loading && typeof s.percent === 'number' ? Math.max(0, Math.min(100, Math.round(s.percent))) : null;
    updText.textContent = failed ? T.updBarFailed : ready ? f(T.updBarReady, {v: s.version}) : pct === null ? f(T.updBarNew, {v: s.version}) : f(T.updBarDownloading, {v: s.version, p: pct});
    const why = failed ? WHY_TEXT[s.reason] : undefined;
    updWhy.textContent = why || '';
    setShown(updWhy, !!why, 'inline');
    updDot.classList.toggle('bg-warm-ac', !failed);
    updDot.classList.toggle('bg-rose-400', failed);
    setShown(updProg, pct !== null, 'block');
    updFill.style.width = (pct === null ? 0 : pct) + '%';
    setShown(updInstall, ready, 'inline-flex');
    setShown(updDismiss, failed, 'inline-flex');
    // A failed update is not blocking: the message goes away by itself.
    if (failed) updErrTimer = setTimeout(() => setShown(updBar, false, 'flex'), 10000);
  };
  const applyUpdate = (s) => {
    applyBar(s);
    const out = $('update-result');
    if (!out) return;
    if (s.status === 'downloading') show('update-result', true, f(T.updDownloading, {v: s.version}));
    else if (s.status === 'downloaded') show('update-result', true, f(T.updReady, {v: s.version}));
    else if (UPDATE_TEXT[s.status]) show('update-result', ...UPDATE_TEXT[s.status]);
    else out.textContent = '';
    checkBtn.disabled = s.status === 'checking';
  };
  // Installing restarts the app, so a running translation is asked about first.
  const jobRunning = async () => { try { return (await (await fetch('/api/status')).json()).running > 0; } catch { return false; } };
  const setBusy = (on) => { setShown(busyModal, on, 'flex'); };
  const installNow = () => { clearInterval(idleTimer); window.desktop.updater.install(); };
  updInstall.addEventListener('click', async () => { if (await jobRunning()) setBusy(true); else installNow(); });
  $('update-busy-now').addEventListener('click', () => { setBusy(false); installNow(); });
  $('update-busy-wait').addEventListener('click', () => {
    setBusy(false);
    updInstall.disabled = true;
    toast(true, T.updBusyWaiting);
    idleTimer = setInterval(async () => { if (!(await jobRunning())) installNow(); }, 5000);
  });
  busyModal.addEventListener('click', (e) => { if (e.target === busyModal) setBusy(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setBusy(false); });
  updDismiss.addEventListener('click', () => { clearTimeout(updErrTimer); setShown(updBar, false, 'flex'); });
  window.desktop.updater.state().then(applyBar);
  window.desktop.updater.onState(applyUpdate);
  // The button reacts at once (the check itself can take a few seconds).
  checkBtn.addEventListener('click', () => {
    checkBtn.disabled = true;
    show('update-result', true, T.updChecking);
    window.desktop.updater.check().then(applyUpdate).catch(() => { checkBtn.disabled = false; show('update-result', false, T.updError); });
  });
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
} else if ($('check-update')) {
  // The desktop link did not load: say so instead of a button that does nothing.
  $('check-update').addEventListener('click', () => show('update-result', false, T.updNoBridge));
}
for (const [btnId, fieldId] of [['copy', 'manifest'], ['copy-d', 'manifest-d']]) {
  const copyBtn = $(btnId);
  if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard.writeText($(fieldId).value); toast(true, ${JSON.stringify(t(lang, 'copied'))}); });
}`;
}
