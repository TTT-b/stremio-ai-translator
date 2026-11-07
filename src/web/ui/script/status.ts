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
// Cancel (and Skip, when a step can be skipped) sit with the other buttons and show only while there is a job.
let stopJob = '';
let stopSkippable = false;
let backgroundOn = false; // after the job finished, the search inside the video or the sound check still goes on
let searchOn = false;
const renderStop = (items, searching, listening) => {
  const it = items.find((x) => x.state === 'running') || items.find((x) => x.state === 'pending');
  stopJob = it ? it.id : '';
  stopSkippable = !!(it && it.skippable);
  searchOn = !!searching;
  backgroundOn = !!searching || !!listening;
  $('st-cancel-btn').classList.toggle('hidden', !(it || backgroundOn));
  $('st-skip-btn').classList.toggle('hidden', !(it || searchOn));
};
// The big "what is happening now" lines, and the one waiting after it.
const epText = (x) => x && x.season !== undefined && x.episode !== undefined ? f(T.qSeasonEp, {s: x.season, e: x.episode}) : '';
const renderNow = (items, bs, exact, dl) => {
  const cur = items.find((x) => x.state === 'running') || items.find((x) => x.state === 'pending');
  const who = cur || bs || exact || dl;
  $('st-now').classList.toggle('hidden', !who);
  $('st-now').classList.toggle('flex', !!who);
  if (who) { $('st-now-title').textContent = who.title; $('st-now-ep').textContent = epText(who); }
  const next = items.find((x) => x !== cur && (x.state === 'queued' || x.state === 'pending'));
  $('st-next').classList.toggle('hidden', !next);
  $('st-next').classList.toggle('flex', !!next);
  if (next) $('st-next-text').textContent = next.title + (epText(next) ? ' · ' + epText(next) : '');
  // When nothing is running, the name is already in the big lines.
  $('st-delivered').classList.toggle('hidden', !dl || !!who);
};
const backgroundAct = async (action) => { try { await post('/api/background/' + action); } catch { /* shown on the next refresh */ } refreshStatus(); };
// Cancel stops everything: the job, the search inside the video and the sound check.
$('st-cancel-btn').addEventListener('click', () => {
  if (backgroundOn) backgroundAct('stop');
  if (stopJob) queueAct(stopJob, 'cancel');
});
// Skip ends the current step (the search inside the video, the sound check); with no step left to skip,
// the last Skip cancels the episode, so the queue moves on to the next one.
$('st-skip-btn').addEventListener('click', () => {
  if (stopJob && stopSkippable) queueAct(stopJob, 'skip');
  else if (searchOn) backgroundAct('skip');
  else if (stopJob) queueAct(stopJob, 'cancel');
});
const refreshStatus = async () => {
  try {
    const r = await (await fetch('/api/status')).json();
    const st = STATES[r.state] || STATES.waiting;
    // After a failure, say why (quota, key, rate limit...) instead of the general advice.
    const fmtWait = (s) => s >= 3600 ? Math.floor(s / 3600) + ':' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + (UI === 'he' ? ' שע׳' : ' h') : s >= 60 ? Math.ceil(s / 60) + (UI === 'he' ? ' דק׳' : ' min') : s + (UI === 'he' ? ' שנ׳' : ' s');
    const autoWait = r.running === 0 && r.autoRetryInSec !== null && r.autoRetryInSec !== undefined ? f(T.stAutoRetry, {t: fmtWait(r.autoRetryInSec)}) : '';
    $('st-state').textContent = autoWait || (r.paused && r.running > 0 && T.stPaused) || (r.state === 'error' && r.lastError && ERRORS[r.lastError]) || st[0];
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
    // Sync to sound is offered once Stremio has taken a subtitle, unless the sound is being checked
    // now or the check already confirmed the timing of that subtitle.
    const timingConfirmed = !!ls && !!dl && ls.at >= dl.at && (ls.outcome === 'moved' || ls.outcome === 'inSync');
    $('sync-now-btn').classList.toggle('hidden', !dl || !!bs || timingConfirmed);
    // Chips: who gave the source subtitle, and whether it came from the cache or was translated now.
    const SVG = (d) => '<svg viewBox="0 0 24 24" class="h-3.5 w-3.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
    const ICON_WORLD = SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>');
    const ICON_DB = SVG('<ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/>');
    const ICON_LANG = SVG('<path d="M4 5h7M9 3v2c0 4-2 7-5 8M5 9c1 2 3 4 6 5M12 20l4-9 4 9M13.5 17h5"/>');
    const SRC_CHIPS = {
      opensubtitles: [T.chipSrcOs, 'border-sky-400/40 text-sky-300'],
      subdl: [T.chipSrcSubdl, 'border-violet-400/40 text-violet-300'],
      jimaku: [T.chipSrcJimaku, 'border-pink-400/40 text-pink-300'],
      video: [T.chipSrcVideo, 'border-teal-400/40 text-teal-300'],
    };
    const CHIP_BASE = 'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold ';
    const sc = dl && SRC_CHIPS[dl.source];
    $('st-chip-src').classList.toggle('hidden', !sc);
    if (sc) { $('st-chip-src').className = CHIP_BASE + sc[1]; $('st-chip-src').innerHTML = ICON_WORLD + '<span>' + sc[0] + '</span>'; }
    const viaChip = dl && (dl.via === 'cache' ? [T.chipCache, ICON_DB, 'border-amber-500/40 text-amber-300'] : dl.via === 'translated' ? [T.chipNew, ICON_LANG, 'border-warm-ok/40 text-warm-ok'] : dl.via === 'direct' ? [T.chipDirect, ICON_LANG, 'border-warm-ln text-warm-mu'] : null);
    $('st-chip-via').classList.toggle('hidden', !viaChip);
    if (viaChip) { $('st-chip-via').className = CHIP_BASE + viaChip[2]; $('st-chip-via').innerHTML = viaChip[1] + '<span>' + viaChip[0] + '</span>'; }
    $('st-chips').classList.toggle('hidden', !dl);
    $('st-chips').classList.toggle('flex', !!dl);
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
      $('st-sync-text').textContent = ls.outcome === 'moved' ? f(T.syncMoved, {name: nameOf(ls)}) : ls.outcome === 'inSync' ? f(T.syncInSync, {name: nameOf(ls)}) : ls.outcome === 'unavailable' ? f(T.syncUnavailable, {name: nameOf(ls)}) : f(T.syncKept, {name: nameOf(ls)});
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
    // Continue shows only when there is something it can do.
    const up = r.upgrade;
    const upVisible = fresh(up);
    $('st-upgrade').classList.toggle('hidden', !upVisible);
    $('st-upgrade').classList.toggle('flex', upVisible);
    if (upVisible) {
      const where = up.season !== undefined && up.episode !== undefined ? (UI === 'he' ? ' עונה ' + up.season + ' פרק ' + up.episode : ' S' + up.season + 'E' + up.episode) : '';
      $('st-upgrade-text').textContent = f(T.upgradeText, {name: up.title + where});
    }
    $('resume-btn').classList.toggle('hidden', !r.resumable);
    renderQueue(r.queue || []);
    renderStop(r.queue || [], r.exactComing, bs);
    renderNow(r.queue || [], bs, r.exactComing, dl);
  } catch { /* the app may be restarting */ }
};
refreshStatus();
setInterval(refreshStatus, 1500);
`;
}
