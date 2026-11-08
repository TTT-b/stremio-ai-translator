import type { UiCtx } from '../context';

/** The subtitle library. */
export function scriptLibrary(_c: UiCtx): string {
  return `// Subtitle library: everything translated so far, grouped by title, with delete.
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
  const row = el('div', 'flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 text-sm transition hover:bg-warm-bg' + (picked.has(e.id) ? ' bg-warm-ac/[0.07]' : ''));
  const pick = el('label', 'flex min-w-[8rem] flex-1 cursor-pointer items-center gap-3');
  pick.append(checkbox(picked.has(e.id), false, e.title, (on) => setPicked([e.id], on)));
  const name = e.kind === 'series' ? f(T.libEpisode, {n: e.episode ?? '?'}) : (e.label || T.libSubtitle);
  pick.append(el('span', 'min-w-0 flex-1 truncate font-medium text-warm-tx', name));
  row.append(pick);
  const meta = el('span', 'flex min-w-0 max-w-full flex-wrap items-center gap-x-3 gap-y-1 text-xs text-warm-mu');
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
  const d = el('details', 'group rounded-2xl border border-warm-ln bg-warm-sf');
  d.open = openGroups.has(key);
  d.addEventListener('toggle', () => { if (d.open) openGroups.add(key); else openGroups.delete(key); });
  const s = el('summary', 'flex cursor-pointer list-none items-center gap-3 rounded-2xl p-3.5 transition hover:bg-warm-bg/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac [&::-webkit-details-marker]:hidden');
  const ids = items.map(e => e.id), st = groupState(ids);
  s.append(checkbox(st.checked, st.partial, title, (on) => setPicked(ids, on)));
  s.append(el('span', 'min-w-0 flex-1 truncate text-sm font-bold text-warm-tx', title));
  s.append(el('span', 'shrink-0 text-xs text-warm-mu', count));
  const chev = el('span', 'inline-block text-warm-ac transition-transform duration-200 group-open:rotate-180', '▾');
  chev.setAttribute('aria-hidden', 'true');
  s.append(chev);
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
  } catch { libItems = []; show('lib-result', false, T.libLoadFail); }
  for (const id of [...picked]) if (!libItems.some(e => e.id === id)) picked.delete(id);
  drawLib();
};
// Every series starts closed each time the screen is opened; the user opens the one they want.
$('open-library').addEventListener('click', () => { openGroups.clear(); setView('lib'); });
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
});`;
}
