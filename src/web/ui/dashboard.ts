import { btn, escapeHtml, field, result, tile } from './components';
import { t } from '../i18n';
import type { UiCtx } from './context';
import { prettyModel } from './provider';

/** Main screen: live status, queue, quota, language, checks and the install box. */
export function renderDashboard(c: UiCtx): string {
  const { d, lang, tt, langMenu, langOptions, startStep } = c;
  /** Short install box for the main screen, so the link is at hand without reopening the wizard. */
  /** Small, even buttons for the cards on this screen. */
  const cb = `${btn} !rounded-lg !px-3 !py-1.5 !text-[13px] whitespace-nowrap`;
  const plainLink = (href: string, label: string) =>
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="${btn} block w-full !rounded-lg !px-2 !py-1.5 text-center !text-xs leading-snug">${escapeHtml(label)}</a>`;
  const installCompact = d.stremioReady
    ? `<section class="${tile} flex flex-col gap-2.5"><h2 class="text-sm font-bold text-warm-tx">${tt('installTitle')}</h2>
<div class="grid grid-cols-2 gap-2 sm:grid-cols-4"><a id="install-d" class="${cb} flex-1 text-center" href="${escapeHtml(d.installUrl)}" target="_blank" rel="noopener noreferrer">${tt('installBtn')}</a><button type="button" id="open-stremio" class="${cb} flex-1">${tt('openStremio')}</button></div>
<div class="flex gap-2"><input id="manifest-d" readonly dir="ltr" class="${field} min-w-0 flex-1 font-mono text-[13px]" value="${escapeHtml(d.manifestUrl)}" aria-label="${tt('manifestAria')}"><button type="button" id="copy-d" class="${cb}">${tt('copy')}</button></div></section>`
    : '';

  /** One equal-size check tile: name, result of the last test, details, test button at the bottom. */
  const svcTile = (name: string, title: string, body: string): string =>
    `<div data-check-row="${name}" class="flex min-h-[96px] flex-col gap-1.5 rounded-2xl border border-warm-ln bg-warm-bg/40 p-3.5"><div class="text-sm font-bold text-warm-tx">${title}</div><div class="flex flex-1 flex-col gap-1.5">${body}<span class="${result} !text-xs text-warm-mu" id="dr-${name}"></span></div><button type="button" class="${cb} w-full" data-test="${name}" data-rp="dr-">${tt('testBtn')}</button></div>`;

  return `<div id="dash" class="${startStep ? 'hidden' : 'flex'} w-full max-w-[560px] flex-col gap-[18px] mx-auto lg:max-w-[1040px] xl:max-w-[1280px]">
<div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="text-[26px] font-extrabold text-warm-tx"><span class="text-warm-ac">TTT</span> Sub</h1>${d.testMode ? `<div class="mt-1.5 inline-block rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">${tt('testBanner')}</div>` : ''}</div>
<div class="flex flex-wrap items-center gap-2 max-sm:w-full sm:justify-end"><button type="button" id="open-library" class="${btn} flex items-center gap-2 !py-2"><span class="text-base leading-none" aria-hidden="true">&#127916;</span>${tt('mySubs')}</button><button type="button" id="open-settings" class="${btn} flex items-center gap-2 !py-2"><span class="text-base leading-none" aria-hidden="true">&#9881;&#65039;</span>${tt('settings')}</button><button type="button" class="js-news ${btn} relative !px-3 !py-2" aria-label="${tt('newsBell')}" title="${tt('newsBell')}"><span class="text-base leading-none" aria-hidden="true">&#128276;</span><span class="js-news-badge absolute -top-1 -end-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-warm-ac px-1 text-[10px] font-bold text-warm-on"></span></button>${langMenu()}</div></div>
<div class="flex flex-col gap-[18px] lg:grid lg:grid-cols-2 lg:items-start lg:gap-5"><div class="flex flex-col gap-[18px]">
<section id="st-upgrade" class="${tile} hidden flex-col gap-3 !border-warm-ac/60" role="status"><div><div class="text-sm font-bold text-warm-tx">${tt('upgradeTitle')}</div><div id="st-upgrade-text" class="mt-0.5 text-xs text-warm-mu"></div></div><div dir="ltr" class="flex justify-start"><button type="button" id="st-upgrade-close" class="${btn} !px-4 !py-1.5 !text-[13px]">${tt('toastOk')}</button></div></section>
<section class="flex flex-col gap-3.5 rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-xl shadow-black/20">
<div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2.5 text-sm font-semibold"><span id="st-dot" class="h-2.5 w-2.5 rounded-full bg-warm-mu"></span><span id="st-state">${tt('stWaiting')}</span></div><div class="flex flex-wrap items-center gap-2"><button type="button" id="st-cancel-btn" class="${btn} hidden whitespace-nowrap !px-3 !py-1.5 !text-[13px]">${tt('qCancel')}</button><button type="button" id="st-skip-btn" class="${btn} hidden whitespace-nowrap !px-3 !py-1.5 !text-[13px]">${tt('qSkip')}</button><button type="button" id="resume-btn" class="${btn} hidden whitespace-nowrap !border-warm-ac !px-3 !py-1.5 !text-[13px] !text-warm-ac" title="${tt('resumeHint')}">${tt('resumeBtn')}</button><button type="button" id="sync-now-btn" class="${btn} hidden whitespace-nowrap !px-3 !py-1.5 !text-[13px]" title="${tt('syncNowHint')}">${tt('syncNowBtn')}</button></div></div>
<div id="st-now" class="hidden flex-col gap-0.5"><div id="st-now-title" class="text-[22px] font-extrabold leading-tight text-warm-tx"></div><div id="st-now-ep" class="text-base text-warm-tx"></div></div>
<div id="st-progress-text" class="text-[26px] font-extrabold leading-tight text-warm-tx">${tt('noSub')}</div>
<div class="h-2.5 overflow-hidden rounded-full bg-warm-bg" role="progressbar" aria-label="${tt('progressAria')}" aria-valuemin="0" aria-valuemax="100"><div id="st-progress" class="h-full w-0 rounded-full bg-warm-ac"></div></div>
<div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-warm-mu"><span id="st-progress-eta"></span><span id="st-total-eta" class="hidden font-semibold text-warm-tx"></span></div>
<div id="st-next" class="hidden items-center justify-between gap-3 border-t border-warm-ln pt-2.5 text-sm"><span class="text-warm-mu">${tt('qNext')}</span><span id="st-next-text" class="font-semibold text-warm-tx"></span></div>
<div class="flex items-center justify-between gap-3 text-xs text-warm-mu"><span>${tt('stLines')}: <b id="st-lines" class="text-warm-tx">0</b></span><span>${tt('stSize')}: <b id="st-size" dir="ltr" class="text-warm-tx">0 KB</b></span></div>
<div id="st-delivered" class="hidden text-xs text-warm-ok" role="status"></div>
<div id="st-chips" class="hidden flex-wrap items-center gap-2"><span id="st-chip-src" class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold"></span><span id="st-chip-via" class="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-bold"></span></div>
<div id="st-sync" class="hidden flex-col gap-1.5 rounded-xl border border-warm-ln bg-warm-bg px-3 py-2" role="status"><div id="st-sync-text" class="text-[13px] text-warm-tx"></div><div id="st-sync-bar" class="flex items-center gap-3"><div class="h-3 flex-1 overflow-hidden rounded-full bg-warm-ln" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="st-sync-fill" class="h-full w-0 rounded-full bg-warm-ok"></div></div><div class="flex flex-col items-end"><div id="st-sync-pct" dir="ltr" class="min-w-[3.5rem] text-end text-xl font-extrabold text-warm-ok">0%</div><div id="st-sync-eta" class="whitespace-nowrap text-[11px] text-warm-mu"></div></div></div><div id="st-sync-ok-row" dir="ltr" class="flex justify-start"><button type="button" id="st-sync-ok" class="${btn} !px-4 !py-1.5 !text-[13px]">${tt('toastOk')}</button></div></div>
</section>
<section id="st-queue" class="${tile} hidden flex-col gap-2.5"><h2 class="text-sm font-bold text-warm-tx">${tt('qTitle')}</h2><ul id="st-queue-list" class="flex flex-col gap-2"></ul></section>
<div class="${tile} flex items-center justify-between gap-3"><div class="min-w-0 flex-1"><label class="text-xs text-warm-mu" for="q-lang">${tt('stTarget')}</label><select class="${field} mt-1" id="q-lang">${langOptions}</select></div><label class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"><span class="text-xs text-warm-mu">${tt('stDual')}</span><input type="checkbox" id="q-dual" class="peer sr-only"${d.dualSubtitles ? ' checked' : ''}><span class="relative h-[23px] w-10 shrink-0 rounded-full bg-warm-ln transition peer-checked:bg-warm-ac peer-focus-visible:ring-2 peer-focus-visible:ring-warm-ac/60 after:absolute after:start-[3px] after:top-[3px] after:h-[17px] after:w-[17px] after:rounded-full after:bg-white after:transition rtl:peer-checked:after:-translate-x-[17px] ltr:peer-checked:after:translate-x-[17px]"></span></label></div>
</div><div class="flex flex-col gap-[18px]">
<section class="${tile} flex flex-col gap-3"><div class="flex items-center justify-between gap-3"><div><div class="text-sm font-bold text-warm-tx">${tt('checksTitle')}</div><div class="mt-0.5 text-xs text-warm-mu">${tt('checksSub')}</div></div><button type="button" id="checks-all" class="${cb} shrink-0">${tt('testAllBtn')}</button></div>
<div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
${svcTile('ai', tt('aiProviderTitle'), `<div class="text-xs text-warm-mu" dir="ltr">${d.aiConfigured ? escapeHtml(prettyModel(d.aiModel)) : tt('noKeyYet')}</div>`)}
${svcTile('opensubtitles', 'OpenSubtitles', `<div id="st-quota" class="hidden"><div id="st-quota-text" class="text-sm font-bold" dir="ltr"></div><div class="mt-1.5 h-2 overflow-hidden rounded-full bg-warm-bg" role="progressbar" aria-label="${tt('stQuota')}" aria-valuemin="0" aria-valuemax="100"><div id="st-quota-bar" class="h-full w-0 rounded-full bg-warm-ok transition-[width] duration-500"></div></div><div id="st-quota-hint" class="mt-1 hidden text-xs text-warm-mu"></div></div>`)}
${svcTile('subdl', 'SubDL', `<div id="st-subdl" class="flex flex-col gap-1"><div id="st-subdl-text" class="text-sm font-bold ${d.subdlKeyConfigured ? '' : 'text-warm-mu'}" dir="auto">${d.subdlKeyConfigured ? '0' : tt('stSubdlNoKey')}</div><div id="st-subdl-nokey" class="text-xs text-warm-mu ${d.subdlKeyConfigured ? 'hidden' : ''}">${plainLink('https://subdl.com/panel/api', t(lang, 'getSubdlKey'))}</div><div id="st-subdl-info" class="text-xs text-warm-mu ${d.subdlKeyConfigured ? '' : 'hidden'}">${plainLink('https://subdl.com/panel/api', t(lang, 'stSubdlPanel'))}</div></div>`)}
${svcTile('jimaku', 'Jimaku', '')}
</div>
</section>
${installCompact}
</div></div>
</div>`;
}
