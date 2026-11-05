export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// "Focus" design (1B): one centered card, warm dark palette (see tailwind.config.js), 16px radius.
// Hebrew screens are right-to-left, English ones left-to-right; the window title bar always stays
// left-to-right like Windows. Direction-sensitive styles use logical (start/end) classes.
export const field =
  'w-full rounded-2xl border border-warm-ln bg-warm-bg px-3.5 py-2.5 text-sm text-warm-tx placeholder-warm-mu/70 outline-none transition focus:border-warm-ac focus:ring-2 focus:ring-warm-ac/25';
export const selectField = (id: string, options: string): string =>
  `<div class="relative"><select class="${field} cursor-pointer appearance-none !pe-10" id="${id}">${options}</select><svg class="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-mu" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg></div>`;
export const labelCls = 'mb-1.5 block text-[13px] font-semibold text-warm-tx';
export const btn =
  'rounded-2xl border border-warm-ln bg-transparent px-4 py-2.5 text-sm font-semibold text-warm-tx transition hover:border-warm-ac/60 hover:bg-warm-bg active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac disabled:cursor-default disabled:opacity-60';
export const btnPrimary =
  'rounded-2xl bg-warm-ac px-6 py-2.5 text-sm font-bold text-warm-on transition hover:brightness-110 active:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-sf disabled:cursor-default disabled:opacity-60';
export const btnDanger =
  'rounded-2xl border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-rose-400/10 disabled:hover:text-rose-300';
/** Status line that always sits on its own row; reserves its height so nothing jumps. */
export const result = 'block min-h-5 break-words text-sm font-medium';
export const tile = 'rounded-2xl border border-warm-ln bg-warm-sf p-4';

/** App mark (speech bubble with subtitle lines), inline because the page's CSP allows no images. */
export const logo =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="2.5" stroke="#e8b25c" stroke-width="1.5"/><path d="M5 11.5v2.5l3-2.5" stroke="#e8b25c" stroke-width="1.5" stroke-linejoin="round"/><path d="M4.5 6h4M4.5 8.5h6" stroke="#a3998c" stroke-width="1.3" stroke-linecap="round"/></svg>';

export const winBtn =
  'no-drag flex h-9 w-14 items-center justify-center text-warm-tx/80 transition hover:bg-warm-ln/70 hover:text-warm-tx focus:outline-none';

/** Tiny flags drawn as SVG (emoji flags do not show on Windows). */
export const FLAG_IL =
  '<svg class="h-3.5 w-5 shrink-0 rounded-[2px]" viewBox="0 0 22 16" aria-hidden="true"><rect width="22" height="16" fill="#fff"/><rect y="2" width="22" height="2.2" fill="#0038b8"/><rect y="11.8" width="22" height="2.2" fill="#0038b8"/><path d="M11 5 13.5 9.4H8.5ZM11 11 8.5 6.6H13.5Z" fill="none" stroke="#0038b8" stroke-width="0.7"/></svg>';
export const FLAG_EN =
  '<svg class="h-3.5 w-5 shrink-0 rounded-[2px]" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0 60 30M60 0 0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10"/><path d="M30 0V30M0 15H60" stroke="#c8102e" stroke-width="6"/></svg>';
