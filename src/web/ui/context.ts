import type { StatusPageData } from '../html';
import { btn, escapeHtml, field, FLAG_EN, FLAG_IL, result } from './components';
import { t, type StrKey } from '../i18n';
import type { UiLang } from '../i18n';

/** Language name in the screen's language ("עברית" / "Hebrew"), falling back to the English name. */
function languageName(ui: UiLang, code: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: 'language' }).of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

/** The helpers every screen shares, built once per page from its data. */
export function createUiCtx(d: StatusPageData) {
  const lang: UiLang = d.uiLang ?? 'he';
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  /** Text for HTML content and attributes. */
  const tt = (key: StrKey, vars?: Record<string, string | number>) =>
    escapeHtml(t(lang, key, vars));
  /** A password input with an eye button that shows or hides what was typed. */
  const passwordField = (id: string, placeholder: string): string =>
    `<div class="relative"><input class="${field} !pe-11" id="${id}" type="password" autocomplete="off" placeholder="${placeholder}"><button type="button" data-reveal="${id}" aria-pressed="false" aria-label="${tt('showPassword')}" title="${tt('showPassword')}" class="absolute end-2 top-1/2 hidden h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-warm-mu transition hover:text-warm-tx focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/40"><svg class="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/><path data-slash class="hidden" d="M4 4l16 16"/></svg></button></div>`;
  /** "Forward" arrow: points left in right-to-left screens. */
  const arrow = lang === 'he' ? '&larr;' : '&rarr;';
  const nudge =
    'transition-transform duration-200 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1';

  const askBtn = (extra: string) =>
    `rounded-lg border px-2 py-0.5 font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac ${extra}`;
  /** Green "configured" chip with a small x; the x swaps it for a confirm question (script/drawer.ts). */
  const keyChip = (field: string, yes = tt('configured'), askExtra = '') =>
    `<span data-rm-normal class="inline-flex items-center"><span class="inline-flex items-center gap-1.5 rounded-full border border-warm-ok/40 bg-warm-ok/10 py-0.5 ps-2.5 pe-1 text-xs font-semibold text-warm-ok"><span class="h-1.5 w-1.5 rounded-full bg-warm-ok"></span>${yes}<button type="button" data-rm title="${tt('removeKeyAria')}" aria-label="${tt('removeKeyAria')}" class="ms-0.5 flex h-6 w-6 items-center justify-center rounded-full text-[11px] leading-none transition hover:bg-rose-400/20 hover:text-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">&#10005;</button></span></span><span data-rm-ask class="hidden items-center gap-2 text-xs ${askExtra}"><span class="text-warm-mu">${tt('removeKeyAsk')}</span><button type="button" data-rm-yes="${field}" class="${askBtn('border-rose-400/50 text-rose-300 hover:bg-rose-400/10')}">${tt('removeKeyYes')}</button><button type="button" data-rm-no class="${askBtn('border-warm-ln text-warm-mu hover:text-warm-tx')}">${tt('removeKeyNo')}</button></span>`;
  const keyRow = (field: string, label: string, ok: boolean, yes = tt('configured')) =>
    `<li data-key-row class="flex items-center justify-between gap-3"><span>${label}</span>${ok ? keyChip(field, yes) : badge(false)}</li>`;
  const badge = (ok: boolean, yes = tt('configured'), no = tt('missing')) =>
    `<span class="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
      ok
        ? 'border-warm-ok/40 bg-warm-ok/10 text-warm-ok'
        : 'border-rose-400/40 bg-rose-400/10 text-rose-300'
    }"><span class="h-1.5 w-1.5 rounded-full ${ok ? 'bg-warm-ok' : 'bg-rose-400'}"></span>${ok ? yes : no}</span>`;

  /** Pill-style button that opens a provider page in the default browser (handled by the Electron main process). */
  const keyLink = (href: string, label: string, free = false) =>
    `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="group inline-flex items-center gap-2 rounded-full border border-warm-ln px-3 py-1 text-xs font-semibold text-warm-mu transition hover:border-warm-ac/60 hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">${escapeHtml(label)}${
      free
        ? `<span class="rounded-full bg-warm-ok/15 px-2 py-0.5 text-[10px] font-bold text-warm-ok">${tt('free')}</span>`
        : ''
    }<span class="${nudge}" aria-hidden="true">${arrow}</span></a>`;

  /** Interface language: a button with the current flag and code, and a small menu. */
  const langMenu = () => {
    const option = (code: 'he' | 'en', flag: string, name: string) =>
      `<button type="button" role="option" data-ui="${code}" aria-selected="${lang === code}" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-warm-tx transition hover:bg-warm-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">${flag}<span>${name}</span></button>`;
    return `<div class="js-lang-wrap relative"><button type="button" dir="ltr" class="js-lang-btn ${btn} flex items-center gap-1.5 !px-2.5 !py-2 !text-xs" aria-haspopup="listbox" aria-expanded="false" aria-label="${tt('uiLangLabel')}" title="${tt('uiLangLabel')}">${lang === 'he' ? FLAG_IL : FLAG_EN}<span dir="ltr" class="font-bold">${lang === 'he' ? 'HE' : 'EN'}</span><svg class="h-1.5 w-2.5 shrink-0" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="js-lang-menu absolute end-0 top-full z-50 mt-1 hidden min-w-[150px] rounded-xl border border-warm-ln bg-warm-sf p-1 shadow-lg shadow-black/40" role="listbox">${option('he', FLAG_IL, 'עברית')}${option('en', FLAG_EN, 'English')}</div></div>`;
  };
  /** Wizard steps: short label (progress bar), title and one-line explanation. */
  const STEPS = Array.from({ length: d.desktop ? 6 : 5 }, (_, i) => i + 1).map((n) => [
    t(lang, `step${n}Label` as StrKey),
    t(lang, `step${n}Title` as StrKey),
    t(lang, `step${n}Sub` as StrKey),
  ]);
  /** Switch (a styled checkbox, so it works with the keyboard and screen readers). */
  const toggle = (id: string, checked: boolean, label: StrKey, hint?: StrKey, plain = false) =>
    `<label class="flex cursor-pointer min-h-14 items-center gap-3.5 ${plain ? 'p-4 transition hover:bg-warm-bg/40' : 'rounded-2xl border border-warm-ln p-4 transition hover:border-warm-ac/50'}"><input type="checkbox" id="${id}" class="peer sr-only"${checked ? ' checked' : ''}><span class="relative h-[23px] w-10 shrink-0 rounded-full bg-warm-ln transition peer-checked:bg-warm-ac peer-focus-visible:ring-2 peer-focus-visible:ring-warm-ac/60 after:absolute after:start-[3px] after:top-[3px] after:h-[17px] after:w-[17px] after:rounded-full after:bg-white after:transition rtl:peer-checked:after:-translate-x-[17px] ltr:peer-checked:after:translate-x-[17px]"></span><span><span class="block text-sm font-semibold text-warm-tx">${tt(label)}</span>${
      hint ? `<span class="mt-0.5 block text-xs text-warm-mu">${tt(hint)}</span>` : ''
    }</span></label>`;
  /** Marks which source is asked first ("in use") and which is the backup. */
  const srcBadge = (src: 'opensubtitles' | 'subdl') => {
    const first = (d.subtitleSource === 'subdl' ? 'subdl' : 'opensubtitles') === src;
    return `<span data-src-badge="${src}" class="rounded-full px-2 py-0.5 text-[11px] font-bold ${first ? 'bg-warm-ac/15 text-warm-ac' : 'bg-warm-ln text-warm-mu'}">${tt(first ? 'srcInUse' : 'srcBackup')}</span>`;
  };
  /** A settings category: closed until the user opens it (opening one closes the others). */
  const GROUP_ICON: Partial<Record<StrKey, string>> = {
    secKeys: '&#128273;',
    secTranslate: '&#127760;',
    secGeneral: '&#9881;',
    secMaintenance: '&#129529;',
    secDev: '&#128295;',
    menuAbout: '&#8505;',
  };
  const groupRaw = (titleHtml: string, iconHtml: string, body: string) =>
    `<details class="group rounded-2xl border border-warm-ln bg-warm-sf"><summary class="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-warm-tx transition hover:bg-warm-bg/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac [&::-webkit-details-marker]:hidden"><span class="flex items-center gap-2.5"><span aria-hidden="true" class="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-warm-ac/10 text-sm">${iconHtml}</span>${titleHtml}</span><span aria-hidden="true" class="inline-block text-warm-ac transition-transform duration-200 group-open:rotate-180">&#9662;</span></summary><div class="flex flex-col gap-3.5 border-t border-warm-ln p-4">${body}</div></details>`;
  const group = (title: StrKey, body: string) => groupRaw(tt(title), GROUP_ICON[title] ?? '', body);
  const dualSwitch = (id: string, checked: boolean, withHint: boolean) =>
    toggle(id, checked, 'dualLabel', withHint ? 'dualHint' : undefined);

  const langOptions = d.languages
    .map(
      (l) =>
        `<option value="${escapeHtml(l.code)}"${l.code === d.targetLanguage ? ' selected' : ''}>${escapeHtml(languageName(lang, l.code, l.name))} (${escapeHtml(l.code)})</option>`,
    )
    .join('');
  const keysDone = d.aiConfigured && d.openSubtitlesKeyConfigured && d.openSubtitlesLoginConfigured;
  // First visit (or a key is missing): the wizard opens at the first incomplete step.
  const startStep = keysDone ? 0 : d.aiConfigured ? 2 : 1;
  const testRow = (label: string, button: string, resultId: string, extra = '', rowName = '') =>
    `<div${rowName ? ` data-check-row="${rowName}"` : ''} class="${extra}flex items-center justify-between gap-3 rounded-2xl border border-warm-ln px-3.5 py-2.5"><div class="min-w-0"><div class="text-sm font-semibold text-warm-tx">${label}</div><span class="${result} mt-0.5 !text-xs text-warm-mu" id="${resultId}"></span></div>${button}</div>`;
  const testBtn = (attr: string) =>
    `<button type="button" class="${btn} shrink-0 !py-2 !text-[13px]" ${attr}>${tt('testBtn')}</button>`;
  /** The three checks, used in the last wizard step and on the main screen (ids differ by prefix). */
  const checks = (rp: string, sampleId: string, outId: string) =>
    `<div class="grid grid-cols-2 gap-2.5">${testRow(tt('testAi'), testBtn(`data-test="ai" data-rp="${rp}"`), `${rp}ai`)}
${testRow(tt('testOs'), testBtn(`data-test="opensubtitles" data-rp="${rp}"`), `${rp}opensubtitles`)}
${testRow(tt('testSubdl'), testBtn(`data-test="subdl" data-rp="${rp}"`), `${rp}subdl`, d.subdlKeyConfigured ? '' : 'hidden ', 'subdl')}
${testRow(tt('testJimaku'), testBtn(`data-test="jimaku" data-rp="${rp}"`), `${rp}jimaku`, d.jimakuKeyConfigured ? '' : 'hidden ', 'jimaku')}
${testRow(tt('testSample'), testBtn(`id="${sampleId}" data-sample data-res="${rp}sample" data-out="${outId}"`), `${rp}sample`, 'col-span-2 ')}
<pre id="${outId}" hidden dir="auto" class="col-span-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-warm-ln bg-warm-bg p-3 text-xs"></pre></div>`;
  const keyPh = (configured: boolean) => (configured ? tt('savedPh') : tt('pasteKeyPh'));
  return {
    d,
    lang,
    dir,
    tt,
    passwordField,
    arrow,
    nudge,
    keyRow,
    keyChip,
    badge,
    keyLink,
    langMenu,
    STEPS,
    toggle,
    srcBadge,
    group,
    groupRaw,
    dualSwitch,
    langOptions,
    startStep,
    checks,
    keyPh,
  };
}

export type UiCtx = ReturnType<typeof createUiCtx>;
