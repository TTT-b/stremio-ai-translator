import { btnDanger, btnPrimary, logo, winBtn } from './components';
import type { UiCtx } from './context';

/** Custom title bar for the frameless desktop window, with the exit and "what is new" dialogs. */
export function renderTitleBar(c: UiCtx): string {
  const { dir, tt } = c;
  return `<div dir="ltr" class="drag fixed inset-x-0 top-0 z-50 flex h-9 items-center justify-between border-b border-warm-ln bg-warm-sf">
<div class="flex items-center gap-2 pl-3 text-xs font-medium text-warm-mu">${logo}<span dir="${dir}" class="font-bold text-warm-tx">${tt('appTitle')}</span><span dir="${dir}">${tt('appTagline')}</span></div>
<div class="flex items-center"><button type="button" id="update-btn" class="hidden no-drag mr-2 h-6 items-center gap-1.5 rounded-lg bg-warm-ac px-2.5 text-xs font-bold text-warm-on transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60" title="${tt('updateTitle')}"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M8 2v8m0 0L4.5 6.5M8 10l3.5-3.5M3 13h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${tt('update')}</span></button>
<button type="button" id="win-min" class="${winBtn}" aria-label="${tt('minimize')}"><svg width="14" height="14" viewBox="0 0 10 10" stroke-width="1.1"><path d="M0 5h10" stroke="currentColor"/></svg></button>
<button type="button" id="win-max" class="${winBtn}" aria-label="${tt('maximize')}"><svg width="14" height="14" viewBox="0 0 10 10" stroke-width="1.1" fill="none"><rect id="win-max-icon" x=".5" y=".5" width="9" height="9" stroke="currentColor"/></svg></button>
<button type="button" id="win-close" class="${winBtn} hover:!bg-rose-600 hover:!text-white" aria-label="${tt('close')}"><svg width="14" height="14" viewBox="0 0 10 10" stroke-width="1.1"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></button></div></div>
<div id="exit-modal" class="no-drag fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="exit-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="exit-title" class="text-lg font-bold text-warm-tx">${tt('exitTitle')}</h2>
<p class="mt-1 text-sm text-warm-mu">${tt('exitBody')}</p>
<div class="mt-5 grid gap-2">
<button type="button" id="exit-tray" class="${btnPrimary}">${tt('exitTray')}</button>
<button type="button" id="exit-quit" class="${btnDanger}">${tt('exitQuit')}</button>
<button type="button" id="exit-cancel" class="px-4 py-2 text-sm text-warm-mu transition hover:text-warm-tx focus:outline-none">${tt('cancel')}</button>
</div></div></div>
<div id="news-modal" class="no-drag fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="news-title">
<div class="w-full max-w-md rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<span class="inline-flex gap-1 rounded-full border border-warm-ac/40 bg-warm-ac/10 px-2.5 py-0.5 text-xs font-semibold text-warm-ac">${tt('newsUpdated')} <span id="news-version" dir="ltr"></span></span>
<h2 id="news-title" class="mt-3 text-lg font-bold text-warm-tx">${tt('newsTitle')}</h2>
<ul id="news-list" class="mt-3 space-y-2 text-sm text-warm-tx/90"></ul>
<button type="button" id="news-close" class="${btnPrimary} mt-6 w-full">${tt('newsOk')}</button>
</div></div>`;
}
