import type { UiCtx } from '../context';

/** Live status and the translation queue. */
export function scriptStatus(_c: UiCtx): string {
  return `// Live status.
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
`;
}
