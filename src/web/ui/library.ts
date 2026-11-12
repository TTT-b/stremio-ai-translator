import { btn, btnDanger, result } from './components';
import type { UiCtx } from './context';

/** The "my subtitles" screen (the list itself is drawn by the page script). */
export function renderLibrary(c: UiCtx): string {
  const { tt } = c;
  return `<div id="lib" class="hidden w-full max-w-[640px] lg:max-w-[1040px] xl:max-w-[1280px] flex-col gap-4">
<div class="flex items-start justify-between gap-3"><div><h1 class="text-[26px] font-extrabold text-warm-tx">${tt('libTitle')}</h1><div id="lib-total" class="mt-1 text-[13px] text-warm-mu"></div></div>
<button type="button" id="lib-back" class="${btn} !py-2">${tt('libBack')}</button></div>
<p class="text-sm text-warm-mu">${tt('libSub')}</p>
<div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warm-ln bg-warm-sf px-3.5 py-2.5">
<div class="flex min-w-0 flex-wrap items-center gap-3"><button type="button" id="lib-all" class="${btn} !py-1.5 !text-[13px]">${tt('libSelectAll')}</button><span id="lib-size" class="text-xs text-warm-mu"></span></div>
</div>
<div id="lib-search" class="relative">
<input id="lib-q" type="text" autocomplete="off" spellcheck="false" placeholder="${tt('libSearchPh')}" aria-label="${tt('libSearchPh')}" class="w-full rounded-2xl border-[1.5px] border-[#5a4d3a] bg-[#0b0a07] px-3.5 py-2.5 pe-10 text-sm text-warm-tx shadow-[inset_0_2px_6px_rgba(0,0,0,0.6)] placeholder:text-[#7d7366] focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">
<button type="button" id="lib-q-clear" hidden title="${tt('libSearchClear')}" aria-label="${tt('libSearchClear')}" class="absolute end-2 top-1/2 -translate-y-1/2 cursor-pointer rounded-full px-2 py-0.5 text-warm-mu hover:text-warm-tx">✕</button>
<div id="lib-sug" hidden class="absolute inset-x-0 top-full z-20 mt-1 max-h-72 overflow-auto rounded-2xl border border-warm-ln bg-warm-sf p-1 shadow-lg"></div>
</div>
<div id="lib-only" class="hidden flex-wrap items-center gap-2 text-xs text-warm-mu"><span id="lib-only-t"></span><button type="button" id="lib-only-all" class="cursor-pointer rounded-full border border-warm-ln px-2.5 py-0.5 font-semibold text-warm-tx hover:bg-warm-bg/60">${tt('libSearchShowAll')}</button></div>
<span class="${result}" id="lib-result"></span>
<div id="lib-list" class="flex min-w-0 flex-col gap-2.5"></div>
<div class="flex flex-wrap items-center justify-center gap-2 pt-2"><button type="button" id="lib-none" class="${btn} hidden !py-1.5 !text-xs">${tt('libSelectNone')}</button><button type="button" id="lib-del-all" class="${btnDanger} !py-1.5 !text-xs">${tt('libDeleteAll')}</button></div>
<p id="lib-empty" hidden class="rounded-2xl border border-dashed border-warm-ln p-6 text-center text-sm text-warm-mu">${tt('libEmpty')}</p>
</div>`;
}
