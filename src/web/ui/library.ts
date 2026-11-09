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
<span class="${result}" id="lib-result"></span>
<div id="lib-list" class="flex min-w-0 flex-col gap-2.5"></div>
<div class="flex flex-wrap items-center justify-center gap-2 pt-2"><button type="button" id="lib-none" class="${btn} hidden !py-1.5 !text-xs">${tt('libSelectNone')}</button><button type="button" id="lib-del-all" class="${btnDanger} !py-1.5 !text-xs">${tt('libDeleteAll')}</button></div>
<p id="lib-empty" hidden class="rounded-2xl border border-dashed border-warm-ln p-6 text-center text-sm text-warm-mu">${tt('libEmpty')}</p>
</div>`;
}
