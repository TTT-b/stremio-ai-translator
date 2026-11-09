import { btn, btnDanger, btnPrimary } from './components';
import type { UiCtx } from './context';

/** Delete, unsaved-changes and news dialogs. */
export function renderConfirmModals(c: UiCtx): string {
  const { tt } = c;
  return `<div id="del-modal" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="del-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="del-title" class="text-lg font-bold text-warm-tx"></h2>
<p class="mt-1 text-sm text-warm-mu">${tt('libConfirmNote')}</p>
<div class="mt-5 grid gap-2">
<button type="button" id="del-yes" class="${btnDanger}">${tt('libDelete')}</button>
<button type="button" id="del-no" class="px-4 py-2 text-sm text-warm-mu transition hover:text-warm-tx focus:outline-none">${tt('cancel')}</button>
</div></div></div>

<div id="nostream-modal" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="nostream-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="nostream-title" class="text-lg font-bold text-warm-tx">${tt('libNoStreamTitle')}</h2>
<p class="mt-1 text-sm text-warm-mu">${tt('libNoStreamBody')}</p>
<ol class="mt-3 list-decimal space-y-1 ps-5 text-sm text-warm-tx"><li>${tt('libNoStreamStep1')}</li><li>${tt('libNoStreamStep2')}</li><li>${tt('libNoStreamStep3')}</li></ol>
<div class="mt-5 grid gap-2">
<button type="button" id="nostream-open" class="${btnPrimary}">${tt('openStremio')}</button>
<button type="button" id="nostream-file" class="${btn}">${tt('libHaveFile')}</button>
<button type="button" id="nostream-cancel" class="px-4 py-2 text-sm text-warm-mu transition hover:text-warm-tx focus:outline-none">${tt('cancel')}</button>
</div></div></div>

<div id="unsaved-modal" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="unsaved-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="unsaved-title" class="text-lg font-bold text-warm-tx">${tt('unsavedTitle')}</h2>
<p class="mt-1 text-sm text-warm-mu">${tt('unsavedBody')}</p>
<div class="mt-5 grid gap-2">
<button type="button" id="unsaved-save" class="${btnPrimary}">${tt('unsavedSave')}</button>
<button type="button" id="unsaved-discard" class="${btnDanger}">${tt('unsavedDiscard')}</button>
<button type="button" id="unsaved-stay" class="px-4 py-2 text-sm text-warm-mu transition hover:text-warm-tx focus:outline-none">${tt('unsavedStay')}</button>
</div></div></div>

<div id="news-panel" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="news-panel-title">
<div class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<div class="flex items-center justify-between"><h2 id="news-panel-title" class="text-lg font-bold text-warm-tx">${tt('newsBell')}</h2><button type="button" id="news-panel-close" class="rounded-lg px-2 text-lg text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac" aria-label="${tt('newsClose')}">&#10005;</button></div>
<div id="news-body" class="flex flex-col gap-2.5 overflow-auto pe-1"></div>
</div></div>`;
}

/** Open-in-browser confirmation dialog and the toast. */
export function renderExtModal(c: UiCtx): string {
  const { tt } = c;
  return `<div id="ext-modal" class="no-drag fixed inset-0 z-[65] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ext-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="ext-title" class="text-lg font-bold text-warm-tx">${tt('extTitle')}</h2>
<p id="ext-body" class="mt-1 text-sm text-warm-mu">${tt('extBody')}</p>
<div id="ext-host" dir="ltr" class="mt-3 break-all rounded-xl border border-warm-ln bg-warm-bg px-3 py-2 font-mono text-[13px] text-warm-tx"></div>
<div class="mt-5 grid grid-cols-2 gap-2.5"><button type="button" id="ext-open" class="${btnPrimary}">${tt('extOpen')}</button><button type="button" id="ext-cancel" class="${btn}">${tt('cancel')}</button></div>
</div></div>
<div id="toast" role="status" aria-live="polite" class="pointer-events-none fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 translate-y-8 rounded-2xl border px-5 py-3 text-sm font-semibold opacity-0 shadow-2xl transition duration-300"></div>`;
}
