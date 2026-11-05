import { btn, escapeHtml, labelCls, result, selectField } from './components';
import type { UiCtx } from './context';

/** One generic "AI" mark for every provider (the page's CSP allows no images; not a company logo). */
const AI_ICON =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="text-warm-ac"><path d="M8 1c.5 3.6 2.4 5.5 7 7-4.6 1.5-6.5 3.4-7 7-.5-3.6-2.4-5.5-7-7 4.6-1.5 6.5-3.4 7-7z"/></svg>';

/** The model chooser: its title and icon follow the provider detected from the saved key. */
export function renderModelPicker(c: UiCtx): string {
  const { d, tt, groupRaw, toggle } = c;
  const provider = d.aiProvider ?? '';
  const isGemini = provider === 'gemini';
  const title = tt('modelTitle', { p: d.aiProviderLabel });
  const current = `<option value="${escapeHtml(d.aiModel)}" selected>${escapeHtml(d.aiModel)}</option>`;
  const body = `<div><label class="${labelCls}" for="d-model">${tt('modelLabel')}</label>
<div class="flex items-center gap-2"><div class="min-w-0 flex-1" dir="ltr">${selectField('d-model', current)}</div><button type="button" id="d-model-refresh" class="${btn} shrink-0">${tt('modelRefresh')}</button></div>
<span class="${result} mt-1 !text-xs text-warm-mu" id="d-model-result" data-provider="${escapeHtml(provider)}"></span>
<p class="mt-1 text-xs text-warm-mu">${tt('modelHint')}</p></div>${
    isGemini
      ? `<div class="overflow-hidden rounded-2xl border border-warm-ln">${toggle('d-auto-model', d.autoSwitchModel ?? true, 'modelAutoLabel', 'modelAutoHint', true)}</div>`
      : ''
  }`;
  return groupRaw(title, AI_ICON, body);
}
