import { btn, escapeHtml, labelCls, result, selectField } from './components';
import type { UiCtx } from './context';

/** Plain inline marks (the page's CSP allows no images). Not the companies' logos. */
const ICONS: Record<string, string> = {
  // four-point sparkle
  gemini:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" class="text-warm-ac"><path d="M8 1c.5 3.6 2.4 5.5 7 7-4.6 1.5-6.5 3.4-7 7-.5-3.6-2.4-5.5-7-7 4.6-1.5 6.5-3.4 7-7z"/></svg>',
  // eight-ray burst
  anthropic:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" class="text-warm-ac"><path d="M8 1.5v13M1.5 8h13M3.4 3.4l9.2 9.2M12.6 3.4l-9.2 9.2"/></svg>',
  // hexagon with a centre knot
  openai:
    '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="text-warm-ac"><path d="M8 1.5l5.6 3.25v6.5L8 14.5l-5.6-3.25v-6.5z"/><circle cx="8" cy="8" r="1.8"/></svg>',
};

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
  return groupRaw(title, ICONS[provider] ?? '', body);
}
