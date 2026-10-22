import { readFileSync } from 'node:fs';
import { dictFor, ERROR_MESSAGES, t, type StrKey, type UiLang } from './i18n';

/** Replaced at build time by scripts/build-electron.mjs; undefined when running from source. */
declare const __TAILWIND_CSS__: string | undefined;

export function escapeHtml(value: unknown): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export interface StatusPageData {
  nonce: string;
  aiConfigured: boolean;
  /** Provider detected from the saved key, e.g. "Google Gemini"; empty when none. */
  aiProviderLabel: string;
  aiModel: string;
  dualSubtitles: boolean;
  /** Use subtitle tracks stored inside the video file (default on). */
  embeddedSubtitles?: boolean; // creator only
  cleanSubtitles?: boolean;
  /** auto: translate right away. ask: wait for the user's OK first. */
  translationMode?: 'auto' | 'ask';
  /** Which subtitle source is asked first. */
  subtitleSource?: 'opensubtitles' | 'subdl';
  /** Developer test mode is on (made-up subtitles, pretend AI). */
  testMode?: boolean;
  jimakuKeyConfigured?: boolean;
  /** Creator only: shows the diagnostics-with-titles button. */
  creator?: boolean;
  /** Settings > Developers: the current values. */
  dev?: {
    soundCheck: 'background' | 'wait' | 'off';
    seasonPacks: boolean;
    preferTranslation: boolean;
    prefetchNext: boolean;
    embeddedWaitSec: number;
    embeddedMaxEtaSec: number;
    /** Every source, the ones in use first (in order), then the ones switched off. */
    sources: { id: 'subdl' | 'opensubtitles' | 'jimaku'; on: boolean; hasKey: boolean }[];
  };
  openSubtitlesKeyConfigured: boolean;
  subdlKeyConfigured?: boolean;
  openSubtitlesLoginConfigured: boolean;
  /** Not secret: shown so the user can see which account is configured. */
  openSubtitlesUsername: string;
  languages: { code: string; name: string }[];
  targetLanguage: string;
  manifestUrl: string;
  installUrl: string;
  stremioReady: boolean;
  rtlFix: boolean;
  /** True inside the Electron desktop window: renders the custom title bar. */
  desktop?: boolean;
  /** Language of the screens. Hebrew (right-to-left) unless set to English. */
  uiLang?: UiLang;
}

/** Locally built Tailwind CSS (npm run build:css), inlined so the page loads nothing external. */
const CSS = (
  typeof __TAILWIND_CSS__ === 'string'
    ? __TAILWIND_CSS__ // embedded by scripts/build-electron.mjs
    : readFileSync(new URL('./tailwind.generated.css', import.meta.url), 'utf8')
).replace(/<\/style/gi, '<\\/style');

/** Hebrew text for the API error codes (kept for callers and tests; see i18n.ts for both languages). */
export const ERROR_MESSAGES_HE = ERROR_MESSAGES.he;

/** Language name in the screen's language ("עברית" / "Hebrew"), falling back to the English name. */
function languageName(ui: UiLang, code: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames([ui], { type: 'language' }).of(code);
    return name && name !== code ? name : fallback;
  } catch {
    return fallback;
  }
}

// "Focus" design (1B): one centered card, warm dark palette (see tailwind.config.js), 16px radius.
// Hebrew screens are right-to-left, English ones left-to-right; the window title bar always stays
// left-to-right like Windows. Direction-sensitive styles use logical (start/end) classes.
const field =
  'w-full rounded-2xl border border-warm-ln bg-warm-bg px-3.5 py-2.5 text-sm text-warm-tx placeholder-warm-mu/70 outline-none transition focus:border-warm-ac focus:ring-2 focus:ring-warm-ac/25';
const selectField = (id: string, options: string): string =>
  `<div class="relative"><select class="${field} cursor-pointer appearance-none !pe-10" id="${id}">${options}</select><svg class="pointer-events-none absolute end-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-warm-mu" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8l5 5 5-5"/></svg></div>`;
const labelCls = 'mb-1.5 block text-[13px] font-semibold text-warm-tx';
const btn =
  'rounded-2xl border border-warm-ln bg-transparent px-4 py-2.5 text-sm font-semibold text-warm-tx transition hover:border-warm-ac/60 hover:bg-warm-bg active:translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac disabled:cursor-default disabled:opacity-60';
const btnPrimary =
  'rounded-2xl bg-warm-ac px-6 py-2.5 text-sm font-bold text-warm-on transition hover:brightness-110 active:brightness-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60 focus-visible:ring-offset-2 focus-visible:ring-offset-warm-sf disabled:cursor-default disabled:opacity-60';
const btnDanger =
  'rounded-2xl border border-rose-400/40 bg-rose-400/10 px-4 py-2.5 text-sm font-semibold text-rose-300 transition hover:bg-rose-600 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-rose-400/10 disabled:hover:text-rose-300';
/** Status line that always sits on its own row; reserves its height so nothing jumps. */
const result = 'block min-h-5 break-words text-sm font-medium';
const tile = 'rounded-2xl border border-warm-ln bg-warm-sf p-4';

/** App mark (speech bubble with subtitle lines), inline because the page's CSP allows no images. */
const logo =
  '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><rect x="1.5" y="2.5" width="13" height="9" rx="2.5" stroke="#e8b25c" stroke-width="1.5"/><path d="M5 11.5v2.5l3-2.5" stroke="#e8b25c" stroke-width="1.5" stroke-linejoin="round"/><path d="M4.5 6h4M4.5 8.5h6" stroke="#a3998c" stroke-width="1.3" stroke-linecap="round"/></svg>';

/** Texts used only by the desktop title bar and its dialogs (not sent to the script). */
const TITLE_BAR_KEYS = new Set<string>([
  'update',
  'updateTitle',
  'minimize',
  'maximize',
  'close',
  'exitTitle',
  'exitBody',
  'exitTray',
  'exitQuit',
  'newsUpdated',
  'newsTitle',
  'newsOk',
]);

const winBtn =
  'no-drag flex h-9 w-14 items-center justify-center text-warm-tx/80 transition hover:bg-warm-ln/70 hover:text-warm-tx focus:outline-none';

/** Tiny flags drawn as SVG (emoji flags do not show on Windows). */
const FLAG_IL =
  '<svg class="h-3.5 w-5 shrink-0 rounded-[2px]" viewBox="0 0 22 16" aria-hidden="true"><rect width="22" height="16" fill="#fff"/><rect y="2" width="22" height="2.2" fill="#0038b8"/><rect y="11.8" width="22" height="2.2" fill="#0038b8"/><path d="M11 5 13.5 9.4H8.5ZM11 11 8.5 6.6H13.5Z" fill="none" stroke="#0038b8" stroke-width="0.7"/></svg>';
const FLAG_EN =
  '<svg class="h-3.5 w-5 shrink-0 rounded-[2px]" viewBox="0 0 60 30" aria-hidden="true"><rect width="60" height="30" fill="#012169"/><path d="M0 0 60 30M60 0 0 30" stroke="#fff" stroke-width="6"/><path d="M0 0 60 30M60 0 0 30" stroke="#c8102e" stroke-width="2"/><path d="M30 0V30M0 15H60" stroke="#fff" stroke-width="10"/><path d="M30 0V30M0 15H60" stroke="#c8102e" stroke-width="6"/></svg>';

/** "gemini-3.5-flash-lite" becomes "Gemini 3.5 Flash Lite". */
export function prettyModel(id: string): string {
  const words = id
    .split(/[-_\s]+/)
    .filter((w) => w !== '')
    .reduce<string[]>((out, word) => {
      const last = out[out.length - 1];
      // "5-5" is version 5.5, not two numbers
      if (last !== undefined && /^\d+$/.test(last) && /^\d+$/.test(word)) {
        out[out.length - 1] = last + '.' + word;
      } else {
        out.push(word);
      }
      return out;
    }, []);
  return words
    .map((w) =>
      w.toLowerCase() === 'gpt'
        ? 'GPT'
        : /^\d/.test(w)
          ? w
          : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

/** The provider and model for the header line: "Google Gemini 3.5 Flash Lite". */
export function providerLine(providerLabel: string, model: string): string {
  const pretty = prettyModel(model);
  const lastWord = providerLabel.trim().split(/\s+/).pop() ?? '';
  if (lastWord !== '' && pretty.toLowerCase().startsWith(lastWord.toLowerCase() + ' ')) {
    return providerLabel + ' ' + pretty.slice(lastWord.length + 1);
  }
  return providerLabel === '' ? pretty : providerLabel + ' · ' + pretty;
}

export function renderStatusPage(d: StatusPageData): string {
  const lang: UiLang = d.uiLang ?? 'he';
  const dir = lang === 'he' ? 'rtl' : 'ltr';
  /** Text for HTML content and attributes. */
  const tt = (key: StrKey, vars?: Record<string, string | number>) =>
    escapeHtml(t(lang, key, vars));
  /** "Forward" arrow: points left in right-to-left screens. */
  const arrow = lang === 'he' ? '&larr;' : '&rarr;';
  const nudge =
    'transition-transform duration-200 rtl:group-hover:-translate-x-1 ltr:group-hover:translate-x-1';

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

  /** Custom title bar for the frameless desktop window (drag area + minimize / close-to-tray). */
  const titleBar = `<div dir="ltr" class="drag fixed inset-x-0 top-0 z-50 flex h-9 items-center justify-between border-b border-warm-ln bg-warm-sf">
<div class="flex items-center gap-2 pl-3 text-xs font-medium text-warm-mu">${logo}<span dir="${dir}">${tt('appTitle')}</span></div>
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

  /** Settings drawer footer (desktop only): app version and a manual update check, result on its own line below. */
  const updatesRow = `<div class="flex flex-col gap-3"><div class="flex items-center justify-between gap-3"><div><div class="text-xs text-warm-mu">${tt('version')}</div><div id="app-version" dir="ltr" class="font-mono text-base font-bold text-warm-tx"></div></div><button type="button" id="check-update" class="${btn} flex items-center gap-2 !px-5"><span aria-hidden="true">&#8635;</span>${tt('checkUpdates')}</button></div><span class="${result}" id="update-result"></span></div>`;

  /** Interface language: a button with the current flag and code, and a small menu. */
  const langMenu = () => {
    const option = (code: 'he' | 'en', flag: string, name: string) =>
      `<button type="button" role="option" data-ui="${code}" aria-selected="${lang === code}" class="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-warm-tx transition hover:bg-warm-bg focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">${flag}<span>${name}</span></button>`;
    return `<div class="js-lang-wrap relative"><button type="button" dir="ltr" class="js-lang-btn ${btn} flex items-center gap-1.5 !px-2.5 !py-2 !text-xs" aria-haspopup="listbox" aria-expanded="false" aria-label="${tt('uiLangLabel')}" title="${tt('uiLangLabel')}">${lang === 'he' ? FLAG_IL : FLAG_EN}<span dir="ltr" class="font-bold">${lang === 'he' ? 'HE' : 'EN'}</span><svg class="h-1.5 w-2.5 shrink-0" viewBox="0 0 10 6" aria-hidden="true"><path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="js-lang-menu absolute end-0 top-full z-50 mt-1 hidden min-w-[150px] rounded-xl border border-warm-ln bg-warm-sf p-1 shadow-lg shadow-black/40" role="listbox">${option('he', FLAG_IL, 'עברית')}${option('en', FLAG_EN, 'English')}</div></div>`;
  };

  /** Wizard steps: short label (progress bar), title and one-line explanation. */
  const STEPS = [1, 2, 3, 4, 5].map((n) => [
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
    secMaintenance: '&#129529;',
    secDev: '&#128295;',
    menuAbout: '&#8505;',
  };
  const group = (title: StrKey, body: string) =>
    `<details class="rounded-2xl border border-warm-ln"><summary class="flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-2xl px-4 py-3 text-sm font-bold text-warm-tx transition hover:bg-warm-bg/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac"><span class="flex items-center gap-2.5"><span aria-hidden="true" class="flex h-7 w-7 items-center justify-center rounded-lg bg-warm-ac/10 text-sm">${GROUP_ICON[title] ?? ''}</span>${tt(title)}</span><span aria-hidden="true" class="text-warm-ac">&#9662;</span></summary><div class="flex flex-col gap-3.5 border-t border-warm-ln p-4">${body}</div></details>`;
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

  const install = d.stremioReady
    ? `<a id="install" class="group inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-warm-ac px-6 py-3.5 text-base font-bold text-warm-on transition hover:brightness-110 active:brightness-95 focus:outline-none focus-visible:ring-4 focus-visible:ring-warm-ac/40" href="${escapeHtml(d.installUrl)}" target="_blank" rel="noopener noreferrer">
         <span>${tt('installBtn')}</span><span class="${nudge}" aria-hidden="true">${arrow}</span></a>
       <p class="text-xs text-warm-mu">${tt('installNote1')}</p>
       <p class="text-xs text-warm-mu">${tt('installOr')}</p>
       <div class="flex gap-2">
         <input id="manifest" readonly dir="ltr" class="${field} min-w-0 flex-1 font-mono text-[13px]" value="${escapeHtml(d.manifestUrl)}" aria-label="${tt('manifestAria')}">
         <button type="button" id="copy" class="${btn}">${tt('copy')}</button>
       </div>
       <p class="text-xs text-warm-mu">${tt('installNote2')}</p>`
    : `<p class="text-sm text-warm-mu">${tt('installNotReady')}
       <code dir="ltr" class="rounded bg-warm-bg px-1.5 py-0.5">${escapeHtml(d.installUrl)}</code></p>`;

  /** Short install box for the main screen, so the link is at hand without reopening the wizard. */
  const installCompact = d.stremioReady
    ? `<section class="${tile} flex flex-col gap-2.5"><div class="text-sm font-bold text-warm-tx">${tt('installTitle')}</div>
<div class="grid grid-cols-2 gap-2.5"><a id="install-d" class="${btn} text-center" href="${escapeHtml(d.installUrl)}" target="_blank" rel="noopener noreferrer">${tt('installBtn')}</a><button type="button" id="open-stremio" class="${btn}">${tt('openStremio')}</button></div>
<div class="flex gap-2"><input id="manifest-d" readonly dir="ltr" class="${field} min-w-0 flex-1 font-mono text-[13px]" value="${escapeHtml(d.manifestUrl)}" aria-label="${tt('manifestAria')}"><button type="button" id="copy-d" class="${btn}">${tt('copy')}</button></div></section>`
    : '';

  const testRow = (label: string, button: string, resultId: string, extra = '') =>
    `<div class="${extra}flex items-center justify-between gap-3 rounded-2xl border border-warm-ln px-3.5 py-2.5"><div class="min-w-0"><div class="text-sm font-semibold text-warm-tx">${label}</div><span class="${result} mt-0.5 !text-xs text-warm-mu" id="${resultId}"></span></div>${button}</div>`;
  const testBtn = (attr: string) =>
    `<button type="button" class="${btn} shrink-0 !py-2 !text-[13px]" ${attr}>${tt('testBtn')}</button>`;
  /** The three checks, used in the last wizard step and on the main screen (ids differ by prefix). */
  const checks = (rp: string, sampleId: string, outId: string) =>
    `<div class="grid grid-cols-2 gap-2.5">${testRow(tt('testAi'), testBtn(`data-test="ai" data-rp="${rp}"`), `${rp}ai`)}
${testRow(tt('testOs'), testBtn(`data-test="opensubtitles" data-rp="${rp}"`), `${rp}opensubtitles`)}
${testRow(tt('testSubdl'), testBtn(`data-test="subdl" data-rp="${rp}"`), `${rp}subdl`)}
${testRow(tt('testJimaku'), testBtn(`data-test="jimaku" data-rp="${rp}"`), `${rp}jimaku`)}
${testRow(tt('testSample'), testBtn(`id="${sampleId}" data-sample data-res="${rp}sample" data-out="${outId}"`), `${rp}sample`, 'col-span-2 ')}
<pre id="${outId}" hidden dir="auto" class="col-span-2 max-h-40 overflow-auto whitespace-pre-wrap rounded-2xl border border-warm-ln bg-warm-bg p-3 text-xs"></pre></div>`;

  // The script only needs the texts it writes itself; the title-bar texts live in the markup.
  const clientDict = Object.fromEntries(
    Object.entries(dictFor(lang)).filter(([key]) => !TITLE_BAR_KEYS.has(key)),
  );

  const keyPh = (configured: boolean) => (configured ? tt('savedPh') : tt('pasteKeyPh'));

  // Settings > Developers
  const dev = d.dev ?? {
    soundCheck: 'background' as const,
    seasonPacks: true,
    preferTranslation: false,
    prefetchNext: false,
    embeddedWaitSec: 15,
    embeddedMaxEtaSec: 60,
    sources: [
      { id: 'subdl' as const, on: true, hasKey: d.subdlKeyConfigured === true },
      { id: 'opensubtitles' as const, on: true, hasKey: true },
      { id: 'jimaku' as const, on: true, hasKey: d.jimakuKeyConfigured === true },
    ],
  };
  const soundOptions = (['background', 'wait', 'off'] as const)
    .map(
      (m) =>
        `<option value="${m}"${dev.soundCheck === m ? ' selected' : ''}>${tt(m === 'background' ? 'devSoundBackground' : m === 'wait' ? 'devSoundWait' : 'devSoundOff')}</option>`,
    )
    .join('');
  const SOURCE_NAME = {
    subdl: 'devSrcSubdl',
    opensubtitles: 'devSrcOs',
    jimaku: 'devSrcJimaku',
  } as const;
  const RECOMMENDED = { subdl: 1, opensubtitles: 2, jimaku: 3 } as const;
  const orderRows = dev.sources
    .map(
      (s) =>
        `<li data-src="${s.id}" class="flex items-center gap-2 rounded-xl border border-warm-ln px-3 py-2"><label class="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-sm font-semibold text-warm-tx"><input type="checkbox" class="h-4 w-4 accent-warm-ac"${s.on ? ' checked' : ''}><span>${tt(SOURCE_NAME[s.id])}</span><span class="rounded-full bg-warm-ac/15 px-2 py-0.5 text-[11px] font-bold text-warm-ac">${tt('devRec', { n: RECOMMENDED[s.id] })}</span>${s.hasKey ? '' : `<span class="rounded-full bg-warm-ln px-2 py-0.5 text-[11px] font-bold text-warm-mu">${tt('devNoKey')}</span>`}</label><button type="button" data-move="-1" class="${btn} !px-2.5 !py-1 !text-xs" aria-label="${tt('devMoveUp')}">&#9650;</button><button type="button" data-move="1" class="${btn} !px-2.5 !py-1 !text-xs" aria-label="${tt('devMoveDown')}">&#9660;</button></li>`,
    )
    .join('');
  const redoOptions = (['subdl', 'opensubtitles', 'jimaku'] as const)
    .map((id) => `<option value="${id}">${tt(SOURCE_NAME[id])}</option>`)
    .join('');

  const devSection = group(
    'secDev',
    `<p class="text-xs text-warm-mu">${tt('devNote')}</p>
<div><label class="${labelCls}" for="dev-sound">${tt('devSoundLabel')}</label>${selectField('dev-sound', soundOptions)}<p class="mt-1 text-xs text-warm-mu">${tt('devSoundHint')}</p></div>
<div><label class="${labelCls}" for="dev-emb-wait">${tt('devEmbWaitLabel')}</label><input class="${field}" id="dev-emb-wait" type="number" inputmode="numeric" min="0" max="120" dir="ltr" value="${dev.embeddedWaitSec}"><p class="mt-1 text-xs text-warm-mu">${tt('devEmbWaitHint')}</p></div>
<div><label class="${labelCls}" for="dev-emb-eta">${tt('devEmbEtaLabel')}</label><input class="${field}" id="dev-emb-eta" type="number" inputmode="numeric" min="0" max="600" dir="ltr" value="${dev.embeddedMaxEtaSec}"><p class="mt-1 text-xs text-warm-mu">${tt('devEmbEtaHint')}</p></div>
<div class="flex flex-col divide-y divide-warm-ln overflow-hidden rounded-2xl border border-warm-ln">${toggle('dev-packs', dev.seasonPacks, 'devPacksLabel', 'devPacksHint', true)}
${toggle('dev-prefetch', dev.prefetchNext, 'devPrefetchLabel', 'devPrefetchHint', true)}
${toggle('dev-translate', dev.preferTranslation, 'devTranslateLabel', 'devTranslateHint', true)}</div>
<div class="flex flex-col gap-2.5 border-t border-warm-ln pt-3.5"><div class="text-sm font-bold text-warm-tx">${tt('devOrderTitle')}</div><p class="text-xs text-warm-mu">${tt('devOrderHint')}</p>
<ul id="dev-order" class="flex flex-col gap-2">${orderRows}</ul>
<button type="button" id="dev-order-reset" class="${btn} !py-1.5 !text-[13px]">${tt('devOrderReset')}</button></div>
<div class="flex flex-col gap-2.5 border-t border-warm-ln pt-3.5"><div class="text-sm font-bold text-warm-tx">${tt('devRedoTitle')}</div><p class="text-xs text-warm-mu">${tt('devRedoHint')}</p>
<div><label class="${labelCls}" for="dev-redo-item">${tt('devRedoItem')}</label>${selectField('dev-redo-item', '')}</div>
<div><label class="${labelCls}" for="dev-redo-src">${tt('devRedoSource')}</label>${selectField('dev-redo-src', redoOptions)}</div>
<button type="button" id="dev-redo-btn" class="${btn}">${tt('devRedoBtn')}</button><span class="${result} text-center" id="dev-redo-result"></span></div>
<div class="flex flex-col gap-2.5 border-t border-warm-ln pt-3.5"><div class="text-sm font-bold text-warm-tx">${tt('testTitle')}</div><p class="text-xs text-warm-mu">${tt('testDesc')}</p>
${toggle('d-test', d.testMode === true, 'testOn')}
<div id="test-run" class="${d.testMode ? 'flex' : 'hidden'} flex-col gap-2"><button type="button" id="test-run-btn" class="${btn}">${tt('testRun')}</button></div></div>`,
  );

  return `<!doctype html>
<html lang="${lang}" dir="${dir}" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${tt('appTitle')}</title>
<style nonce="${escapeHtml(d.nonce)}">${CSS}</style></head>
<body class="min-h-screen bg-warm-bg font-sans text-warm-tx antialiased">
${d.desktop ? titleBar : ''}
<main class="mx-auto flex min-h-screen w-full flex-col items-center px-4 pb-10 sm:px-10 ${d.desktop ? 'pt-[76px]' : 'pt-10'}">

<div id="wizard" class="${startStep ? 'flex' : 'hidden'} w-full max-w-[520px] flex-col items-center">
<div class="mb-3 flex w-full items-center justify-end gap-2"><button type="button" class="js-news ${btn} relative !px-3 !py-2 !border-transparent" aria-label="${tt('newsBell')}" title="${tt('newsBell')}"><span class="text-base leading-none" aria-hidden="true">&#128276;</span><span class="js-news-badge absolute -top-1 -end-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-warm-ac px-1 text-[10px] font-bold text-warm-on"></span></button>${langMenu()}</div>
<ol id="w-bars" class="mb-7 flex w-full gap-1.5" aria-label="${tt('setupProgress')}">${STEPS.map(
    (s, i) =>
      `<li class="h-[5px] flex-1 rounded-full bg-warm-ln transition-colors" data-bar="${i + 1}" title="${escapeHtml(s[0])}"><span class="sr-only">${escapeHtml(s[0])}</span></li>`,
  ).join('')}</ol>
<section class="flex min-h-[540px] w-full flex-col gap-5 rounded-[22px] border border-warm-ln bg-warm-sf p-8" aria-live="polite">
<div><div id="w-stepof" class="mb-2 text-xs font-semibold tracking-wide text-warm-ac">${tt('stepOf', { n: 1 })}</div><h2 id="w-title" class="text-[26px] font-bold leading-tight text-warm-tx">${escapeHtml(STEPS[0]?.[1] ?? '')}</h2><p id="w-sub" class="mt-2 text-sm leading-relaxed text-warm-mu">${escapeHtml(STEPS[0]?.[2] ?? '')}</p></div>

<div data-pane="1" class="flex flex-col gap-2">
<label class="${labelCls}" for="k-ai">${tt('keyAiLabel')}</label>
<input class="${field}" id="k-ai" type="password" autocomplete="off" placeholder="${d.aiConfigured ? tt('savedPh') : tt('keyAiPh')}">
<p class="text-xs text-warm-mu">${tt('keyAiHelp')}${d.aiConfigured ? ` ${tt('savedProvider', { p: d.aiProviderLabel || t(lang, 'configured') })}` : ''}</p>
<div class="mt-1 flex flex-wrap gap-2">${keyLink('https://aistudio.google.com/apikey', t(lang, 'getGemini'), true)}${keyLink('https://platform.claude.com/settings/keys', t(lang, 'getClaude'))}${keyLink('https://platform.openai.com/api-keys', t(lang, 'getOpenAI'))}</div>
</div>

<div data-pane="2" class="hidden flex-col gap-3.5">
<div><label class="${labelCls}" for="k-os">${tt('osKeyLabel')}</label>
<input class="${field}" id="k-os" type="password" autocomplete="off" placeholder="${keyPh(d.openSubtitlesKeyConfigured)}"></div>
<div class="grid grid-cols-2 gap-3">
<div><label class="${labelCls}" for="k-user">${tt('username')}</label>
<input class="${field}" id="k-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? tt('savedPh') : tt('osUserPh')}"></div>
<div><label class="${labelCls}" for="k-pass">${tt('password')}</label>
<input class="${field}" id="k-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? tt('savedPh') : tt('osPassPh')}"></div>
</div>
<div class="flex flex-wrap gap-2">${keyLink('https://www.opensubtitles.com/en/users/sign_up', t(lang, 'createOsAccount'), true)}${keyLink('https://www.opensubtitles.com/consumers', t(lang, 'getOsKey'), true)}</div>
<div class="mt-1 border-t border-warm-ln pt-3.5"><label class="${labelCls}" for="k-subdl">${tt('subdlKeyLabel')}</label>
<input class="${field}" id="k-subdl" type="password" autocomplete="off" placeholder="${keyPh(d.subdlKeyConfigured ?? false)}">
<p class="mt-1 mb-2 text-xs text-warm-mu">${tt('subdlHint')}</p>
<div class="flex flex-wrap gap-2">${keyLink('https://subdl.com/panel/api', t(lang, 'getSubdlKey'), true)}</div></div>
</div>

<div data-pane="3" class="hidden flex-col gap-4">
<div><label class="${labelCls}" for="lang">${tt('langLabel')}</label>${selectField('lang', langOptions)}</div>
${dualSwitch('dual', d.dualSubtitles, true)}
</div>

<div data-pane="4" class="hidden flex-col gap-2.5">
${checks('r-', 'sample', 'sample-out')}
</div>

<div data-pane="5" class="hidden flex-col gap-3.5">${install}</div>

<div class="mt-auto"><span class="${result} mb-2 text-center" id="w-result"></span>
<div class="flex items-center justify-between gap-3"><button type="button" id="w-back" class="invisible rounded-lg py-2.5 text-sm font-semibold text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">${tt('back')}</button><button type="button" id="w-next" class="${btnPrimary} min-w-[150px] text-center">${tt('next')} ${arrow}</button></div></div>
</section>
</div>

<div id="dash" class="${startStep ? 'hidden' : 'flex'} w-full max-w-[560px] flex-col gap-[18px] lg:max-w-[1040px] xl:max-w-[1280px]">
<div class="flex flex-wrap items-center justify-between gap-3"><div><h1 class="text-[26px] font-extrabold text-warm-tx">${tt('dashTitle')}</h1>${d.testMode ? `<div class="mt-1.5 inline-block rounded-full bg-amber-400/15 px-2.5 py-0.5 text-xs font-bold text-amber-300">${tt('testBanner')}</div>` : ''}<div class="mt-1 text-[13px] text-warm-mu">${d.aiConfigured ? `${tt('providerLine')} <span dir="ltr">${escapeHtml(providerLine(d.aiProviderLabel, d.aiModel))}</span>` : tt('noKeyYet')}</div></div>
<div class="flex flex-wrap items-center gap-2 max-sm:w-full sm:justify-end">${langMenu()}<button type="button" class="js-news ${btn} relative !px-3 !py-2" aria-label="${tt('newsBell')}" title="${tt('newsBell')}"><span class="text-base leading-none" aria-hidden="true">&#128276;</span><span class="js-news-badge absolute -top-1 -end-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-warm-ac px-1 text-[10px] font-bold text-warm-on"></span></button><button type="button" id="open-library" class="${btn} !py-2">${tt('mySubs')}</button><button type="button" id="open-settings" class="${btn} flex items-center gap-2 !py-2"><span class="text-base leading-none" aria-hidden="true">&#9881;</span>${tt('settings')}</button></div></div>
<div class="flex flex-col gap-[18px] lg:grid lg:grid-cols-2 lg:items-start lg:gap-5"><div class="flex flex-col gap-[18px]">
<section id="st-upgrade" class="${tile} hidden flex-col gap-3 !border-warm-ac/60" role="status"><div><div class="text-sm font-bold text-warm-tx">${tt('upgradeTitle')}</div><div id="st-upgrade-text" class="mt-0.5 text-xs text-warm-mu"></div></div><div dir="ltr" class="flex justify-start"><button type="button" id="st-upgrade-close" class="${btn} !px-4 !py-1.5 !text-[13px]">${tt('toastOk')}</button></div></section>
<section class="flex flex-col gap-3.5 rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-xl shadow-black/20">
<div class="flex flex-wrap items-center justify-between gap-3"><div class="flex items-center gap-2.5 text-sm font-semibold"><span id="st-dot" class="h-2.5 w-2.5 rounded-full bg-warm-mu"></span><span id="st-state">${tt('stWaiting')}</span></div><div class="flex items-center gap-2"><button type="button" id="sync-now-btn" class="${btn} whitespace-nowrap !px-3 !py-1.5 !text-[13px]" title="${tt('syncNowHint')}">${tt('syncNowBtn')}</button><button type="button" id="resume-btn" class="${btn} whitespace-nowrap !px-3 !py-1.5 !text-[13px]" title="${tt('resumeHint')}">${tt('resumeBtn')}</button></div></div>
<div id="st-progress-text" class="text-[26px] font-extrabold leading-tight text-warm-tx">${tt('noSub')}</div>
<div class="h-2.5 overflow-hidden rounded-full bg-warm-bg" role="progressbar" aria-label="${tt('progressAria')}" aria-valuemin="0" aria-valuemax="100"><div id="st-progress" class="h-full w-0 rounded-full bg-warm-ac transition-[width] duration-500"></div></div>
<div id="st-now" class="hidden flex-col gap-2 rounded-xl border border-warm-ln bg-warm-bg px-3 py-2.5" role="status"><div class="text-xs text-warm-mu">${tt('nowLabel')}</div><div id="st-now-name" class="text-sm font-bold text-warm-tx"></div><div id="st-now-status" class="text-xs text-warm-mu"></div><div class="flex flex-wrap gap-2"><button type="button" id="st-now-yes" class="${btnPrimary} hidden !px-4 !py-1.5 !text-[13px]">${tt('qTranslate')}</button><button type="button" id="st-now-skip" class="${btnPrimary} hidden !px-4 !py-1.5 !text-[13px]">${tt('qSkip')}</button><button type="button" id="st-now-cancel" class="${btn} !px-4 !py-1.5 !text-[13px]">${tt('qCancel')}</button></div></div>
<div id="st-delivered" class="hidden text-xs text-warm-ok" role="status"></div>
<div id="st-sync" class="hidden flex-col gap-1.5 rounded-xl border border-warm-ln bg-warm-bg px-3 py-2" role="status"><div id="st-sync-text" class="text-[13px] text-warm-tx"></div><div id="st-sync-bar" class="flex items-center gap-3"><div class="h-3 flex-1 overflow-hidden rounded-full bg-warm-ln" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div id="st-sync-fill" class="h-full w-0 rounded-full bg-warm-ok transition-[width] duration-500"></div></div><div class="flex flex-col items-end"><div id="st-sync-pct" dir="ltr" class="min-w-[3.5rem] text-end text-xl font-extrabold text-warm-ok">0%</div><div id="st-sync-eta" class="whitespace-nowrap text-[11px] text-warm-mu"></div></div><button type="button" id="st-sync-stop" class="${btn} whitespace-nowrap !px-3 !py-1.5 !text-[13px]">${tt('syncStopBtn')}</button></div><div id="st-sync-ok-row" dir="ltr" class="flex justify-start"><button type="button" id="st-sync-ok" class="${btn} !px-4 !py-1.5 !text-[13px]">${tt('toastOk')}</button></div></div>
</section>
<section id="st-queue" class="${tile} hidden flex-col gap-2.5"><h2 class="text-sm font-bold text-warm-tx">${tt('qTitle')}</h2><ul id="st-queue-list" class="flex flex-col gap-2"></ul></section>
<div class="grid gap-3.5">
<div class="${tile} flex items-end justify-between gap-3"><div><div class="text-xs text-warm-mu">${tt('stLines')}</div><div id="st-lines" class="mt-1 text-[26px] font-extrabold">0</div></div><div class="text-end"><div class="text-xs text-warm-mu">${tt('stSize')}</div><div id="st-size" dir="ltr" class="mt-1 text-[26px] font-extrabold">0 KB</div></div></div>
<div id="st-quota" class="${tile} hidden"><div class="flex items-baseline justify-between gap-3"><div class="flex items-center gap-2 text-xs text-warm-mu"><span>${tt('stQuota')}</span>${srcBadge('opensubtitles')}</div><div id="st-quota-text" class="text-sm font-bold" dir="ltr"></div></div><div class="mt-2 h-2 overflow-hidden rounded-full bg-warm-bg" role="progressbar" aria-label="${tt('stQuota')}" aria-valuemin="0" aria-valuemax="100"><div id="st-quota-bar" class="h-full w-0 rounded-full bg-warm-ok transition-[width] duration-500"></div></div><div id="st-quota-hint" class="mt-1.5 hidden text-xs text-warm-mu"></div></div>
<div id="st-subdl" class="${tile}"><div class="flex items-baseline justify-between gap-3"><div class="flex items-center gap-2 text-xs text-warm-mu"><span>${tt('stSubdl')}</span>${srcBadge('subdl')}</div><div id="st-subdl-text" class="text-sm font-bold ${d.subdlKeyConfigured ? '' : 'text-warm-mu'}" dir="auto">${d.subdlKeyConfigured ? '0' : tt('stSubdlNoKey')}</div></div><div id="st-subdl-nokey" class="mt-1.5 text-xs text-warm-mu ${d.subdlKeyConfigured ? 'hidden' : ''}">${tt('stSubdlNoKeyHint')}<div class="mt-2">${keyLink('https://subdl.com/panel/api', t(lang, 'getSubdlKey'))}</div></div><div id="st-subdl-info" class="${d.subdlKeyConfigured ? '' : 'hidden'}"><div class="mt-1.5 text-xs text-warm-mu">${tt('stSubdlHint')}</div><div class="mt-2">${keyLink('https://subdl.com/panel/api', t(lang, 'stSubdlPanel'))}</div></div></div>
</div>
</div><div class="flex flex-col gap-[18px]">
<div class="${tile} flex items-center justify-between gap-3"><div class="min-w-0 flex-1"><label class="text-xs text-warm-mu" for="q-lang">${tt('stTarget')}</label><select class="${field} mt-1" id="q-lang">${langOptions}</select></div><label class="flex shrink-0 cursor-pointer flex-col items-center gap-1.5"><span class="text-xs text-warm-mu">${tt('stDual')}</span><input type="checkbox" id="q-dual" class="peer sr-only"${d.dualSubtitles ? ' checked' : ''}><span class="relative h-[23px] w-10 shrink-0 rounded-full bg-warm-ln transition peer-checked:bg-warm-ac peer-focus-visible:ring-2 peer-focus-visible:ring-warm-ac/60 after:absolute after:start-[3px] after:top-[3px] after:h-[17px] after:w-[17px] after:rounded-full after:bg-white after:transition rtl:peer-checked:after:-translate-x-[17px] ltr:peer-checked:after:translate-x-[17px]"></span></label></div>
<section class="${tile} flex flex-col gap-2.5"><div><div class="text-sm font-bold text-warm-tx">${tt('checksTitle')}</div><div class="mt-0.5 text-xs text-warm-mu">${tt('checksSub')}</div></div>
${checks('dr-', 'dsample', 'dsample-out')}
</section>
${installCompact}
<div class="flex items-center gap-2.5 text-[13px] text-warm-mu"><span class="text-warm-ok" aria-hidden="true">&#10003;</span>${tt('keepRunning')}</div></div></div>
</div>

<div id="lib" class="hidden w-full max-w-[640px] lg:max-w-[1040px] xl:max-w-[1280px] flex-col gap-4">
<div class="flex items-start justify-between gap-3"><div><h1 class="text-[26px] font-extrabold text-warm-tx">${tt('libTitle')}</h1><div id="lib-total" class="mt-1 text-[13px] text-warm-mu"></div></div>
<button type="button" id="lib-back" class="${btn} !py-2">${tt('libBack')}</button></div>
<p class="text-sm text-warm-mu">${tt('libSub')}</p>
<div class="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warm-ln bg-warm-sf px-3.5 py-2.5">
<div class="flex items-center gap-3"><button type="button" id="lib-all" class="${btn} !py-1.5 !text-[13px]">${tt('libSelectAll')}</button><span id="lib-size" class="text-xs text-warm-mu"></span></div>
<div id="lib-sel-bar" class="hidden items-center gap-2"><span id="lib-sel-count" class="text-[13px] font-semibold text-warm-tx"></span><button type="button" id="lib-none" class="${btn} !py-1.5 !text-[13px]">${tt('libSelectNone')}</button><button type="button" id="lib-del-sel" class="${btnDanger} !py-1.5 !text-[13px]" disabled>${tt('libDeleteSel')}</button></div>
</div>
<span class="${result}" id="lib-result"></span>
<div id="lib-list" class="flex flex-col gap-2.5"></div>
<div class="flex justify-center pt-2"><button type="button" id="lib-del-all" class="${btnDanger} !py-1.5 !text-xs">${tt('libDeleteAll')}</button></div>
<p id="lib-empty" hidden class="rounded-2xl border border-dashed border-warm-ln p-6 text-center text-sm text-warm-mu">${tt('libEmpty')}</p>
</div>

<p class="mt-auto max-w-[560px] px-1 pt-8 text-center text-xs text-warm-mu/80">${tt('privacy')}</p>
</main>

<div id="del-modal" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="del-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="del-title" class="text-lg font-bold text-warm-tx"></h2>
<p class="mt-1 text-sm text-warm-mu">${tt('libConfirmNote')}</p>
<div class="mt-5 grid gap-2">
<button type="button" id="del-yes" class="${btnDanger}">${tt('libDelete')}</button>
<button type="button" id="del-no" class="px-4 py-2 text-sm text-warm-mu transition hover:text-warm-tx focus:outline-none">${tt('cancel')}</button>
</div></div></div>

<div id="news-panel" class="fixed inset-0 z-[60] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="news-panel-title">
<div class="flex max-h-[85vh] w-full max-w-lg flex-col gap-3 rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<div class="flex items-center justify-between"><h2 id="news-panel-title" class="text-lg font-bold text-warm-tx">${tt('newsBell')}</h2><button type="button" id="news-panel-close" class="rounded-lg px-2 text-lg text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac" aria-label="${tt('newsClose')}">&#10005;</button></div>
<div id="news-body" class="flex flex-col gap-2.5 overflow-auto pe-1"></div>
</div></div>

<div id="drawer" class="${d.desktop ? 'top-9' : 'top-0'} fixed inset-x-0 bottom-0 z-40 hidden justify-start bg-black/45" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
<div class="flex h-full w-[420px] max-w-full flex-col gap-[18px] overflow-auto border-e border-warm-ln bg-warm-sf p-[26px]">
<div class="flex items-center justify-between"><h2 id="drawer-title" class="text-xl font-bold">${tt('settingsTitle')}</h2><button type="button" id="close-settings" class="rounded-lg px-2 text-lg text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac" aria-label="${tt('closeSettings')}">&#10005;</button></div>
<div class="flex flex-col gap-3" id="groups">
${group(
  'secKeys',
  `<ul class="grid gap-2 text-sm">
<li class="flex items-center justify-between gap-3"><span>${tt('rowAi')}</span>${badge(d.aiConfigured, escapeHtml(d.aiProviderLabel) || tt('configured'))}</li>
<li class="flex items-center justify-between gap-3"><span>${tt('rowOsKey')}</span>${badge(d.openSubtitlesKeyConfigured)}</li>
<li class="flex items-center justify-between gap-3"><span>${tt('rowSubdl')}</span>${badge(d.subdlKeyConfigured ?? false)}</li>
<li class="flex items-center justify-between gap-3"><span>${tt('rowJimaku')}</span>${badge(d.jimakuKeyConfigured ?? false)}</li>
<li class="flex items-center justify-between gap-3"><span>${tt('rowOsLogin')}${d.openSubtitlesUsername ? ` (<span class="font-mono" dir="ltr">${escapeHtml(d.openSubtitlesUsername)}</span>)` : ''}</span>${badge(d.openSubtitlesLoginConfigured)}</li>
</ul>
<div><label class="${labelCls}" for="d-ai">${tt('aiKeyLabel')}</label><input class="${field}" id="d-ai" type="password" autocomplete="off" placeholder="${keyPh(d.aiConfigured)}"></div>
<div><label class="${labelCls}" for="d-os">${tt('osKeyLabel')}</label><input class="${field}" id="d-os" type="password" autocomplete="off" placeholder="${keyPh(d.openSubtitlesKeyConfigured)}"></div>
<div class="grid grid-cols-2 gap-3"><div><label class="${labelCls}" for="d-user">${tt('username')}</label><input class="${field}" id="d-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? tt('keptPh') : tt('username')}"></div><div><label class="${labelCls}" for="d-pass">${tt('password')}</label><input class="${field}" id="d-pass" type="password" autocomplete="off" placeholder="${d.openSubtitlesLoginConfigured ? tt('keptPh') : tt('password')}"></div></div>
<div><label class="${labelCls}" for="d-subdl">${tt('subdlKeyLabel')}</label><input class="${field}" id="d-subdl" type="password" autocomplete="off" placeholder="${keyPh(d.subdlKeyConfigured ?? false)}"><p class="mt-1 text-xs text-warm-mu">${tt('subdlHint')}</p></div>
<div><label class="${labelCls}" for="d-jimaku">${tt('jimakuKeyLabel')}</label><input class="${field}" id="d-jimaku" type="password" autocomplete="off" placeholder="${keyPh(d.jimakuKeyConfigured ?? false)}"><p class="mt-1 text-xs text-warm-mu">${tt('jimakuHint')}</p></div>`,
)}
${group(
  'secTranslate',
  `<div><label class="${labelCls}" for="d-lang">${tt('langLabel')}</label>${selectField('d-lang', langOptions)}</div>
<div class="flex flex-col divide-y divide-warm-ln overflow-hidden rounded-2xl border border-warm-ln">${toggle('d-dual', d.dualSubtitles, 'dualLabel', undefined, true)}
${toggle('d-emb', d.embeddedSubtitles ?? true, 'embLabel', 'embHint', true)}
${toggle('d-clean', d.cleanSubtitles ?? true, 'cleanLabel', 'cleanHint', true)}
${toggle('d-ask', d.translationMode === 'ask', 'askLabel', 'askHint', true)}</div>
<div><label class="${labelCls}" for="d-src">${tt('srcLabel')}</label>${selectField('d-src', `<option value="opensubtitles"${d.subtitleSource === 'subdl' ? '' : ' selected'}>${tt('srcOs')}</option><option value="subdl"${d.subtitleSource === 'subdl' ? ' selected' : ''}>${tt('srcSubdl')}</option>`)}<p class="mt-1 text-xs text-warm-mu">${tt('srcHint')}</p></div>`,
)}
${group(
  'secMaintenance',
  `<p class="text-xs text-warm-mu">${tt('clearNote')}</p>
<div class="grid grid-cols-2 gap-2.5"><button type="button" id="clear-cache" class="${btn}">${tt('clearCache')}</button><button type="button" id="rerun" class="${btn}">${tt('rerun')}</button></div>
<span class="${result} text-center" id="clear-result"></span>
<div class="flex flex-col gap-2.5 border-t border-warm-ln pt-3.5"><p class="text-xs text-warm-mu">${tt('diagNote')}</p><button type="button" id="copy-diag" class="${btn}">${tt('diagBtn')}</button>${d.creator ? `<button type="button" id="copy-diag-titles" class="${btn}">Copy diagnostics + titles (creator)</button>` : ''}</div>`,
)}
${group('menuAbout', `<p class="text-xs text-warm-mu">${tt('aboutDesc')}</p>${d.desktop ? updatesRow : ''}${devSection}`)}
</div>
<div class="sticky -bottom-[26px] z-10 -mx-[26px] -mb-[26px] mt-auto grid gap-2 border-t border-warm-ln bg-warm-sf/95 px-[26px] pb-[26px] pt-4 backdrop-blur"><span class="${result} text-center" id="save-result"></span><button type="button" id="save" class="${btnPrimary} w-full !py-3">${tt('save')}</button></div>
</div></div>

<div id="ext-modal" class="no-drag fixed inset-0 z-[65] hidden items-center justify-center bg-black/60 px-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="ext-title">
<div class="w-full max-w-sm rounded-[22px] border border-warm-ln bg-warm-sf p-6 shadow-2xl shadow-black/60">
<h2 id="ext-title" class="text-lg font-bold text-warm-tx">${tt('extTitle')}</h2>
<p id="ext-body" class="mt-1 text-sm text-warm-mu">${tt('extBody')}</p>
<div id="ext-host" dir="ltr" class="mt-3 break-all rounded-xl border border-warm-ln bg-warm-bg px-3 py-2 font-mono text-[13px] text-warm-tx"></div>
<div class="mt-5 grid grid-cols-2 gap-2.5"><button type="button" id="ext-open" class="${btnPrimary}">${tt('extOpen')}</button><button type="button" id="ext-cancel" class="${btn}">${tt('cancel')}</button></div>
</div></div>
<div id="toast" role="status" aria-live="polite" class="pointer-events-none fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 translate-y-8 rounded-2xl border px-5 py-3 text-sm font-semibold opacity-0 shadow-2xl transition duration-300"></div>
<script nonce="${escapeHtml(d.nonce)}">
// Every response also carries its HTTP status, so the page can pick the matching message.
const post = (url, body) => fetch(url, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body||{})}).then(async r => ({...(await r.json()), status: r.status}));
const $ = (id) => document.getElementById(id);
const UI = ${JSON.stringify(lang)};
const T = ${JSON.stringify(clientDict)};
const f = (s, v) => s.replace(/\\{(\\w+)\\}/g, (m, k) => (k in v ? v[k] : m));
const ERRORS = ${JSON.stringify(ERROR_MESSAGES[lang])};
const FAILED = T.failed;
/** Text for a failed response: by error code when there is one, else the given fallback. */
const errText = (r, fallback) => (r.code && ERRORS[r.code]) || fallback;
const TONE = {ok:'text-warm-ok', bad:'text-rose-400', info:'text-warm-mu'};
let toastTimer;
// Links to other sites ask first, so a click never leaves the app by surprise.
const extModal = $('ext-modal');
let extUrl = '';
let extAction = null;
const closeExt = () => { extModal.classList.add('hidden'); extModal.classList.remove('flex'); extUrl = ''; extAction = null; };
// Opening another program asks first too: what to open, and the same OK / Cancel.
const askOpen = (title, body, host, action) => {
  $('ext-title').textContent = title; $('ext-body').textContent = body; $('ext-host').textContent = host;
  extAction = action;
  extModal.classList.remove('hidden'); extModal.classList.add('flex');
  $('ext-open').focus();
};
document.addEventListener('click', (e) => {
  const a = e.target instanceof Element ? e.target.closest('a[href]') : null;
  if (!a) return;
  let u;
  try { u = new URL(a.href, location.href); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || u.origin === location.origin || u.hostname === '127.0.0.1' || u.hostname === 'localhost') return;
  e.preventDefault();
  const url = u.href;
  extUrl = url;
  askOpen(T.extTitle, T.extBody, u.hostname, () => window.open(url, '_blank', 'noopener,noreferrer'));
}, true);
$('ext-open').addEventListener('click', () => { const run = extAction; closeExt(); if (run) run(); });
$('ext-cancel').addEventListener('click', closeExt);
extModal.addEventListener('click', (e) => { if (e.target === extModal) closeExt(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && extAction) closeExt(); });

const toast = (ok, msg) => {
  const t = $('toast');
  t.textContent = (ok ? '\u2714\uFE0E ' : '\u2716\uFE0E ') + msg;
  t.className = 'pointer-events-none fixed bottom-6 left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-2xl border px-5 py-3 text-sm font-semibold shadow-2xl transition duration-300 translate-y-0 opacity-100 ' +
    (ok ? 'border-warm-ok/50 bg-warm-sf text-warm-ok' : 'border-rose-400/50 bg-warm-sf text-rose-300');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('translate-y-0', 'opacity-100'); t.classList.add('translate-y-8', 'opacity-0'); }, 3500);
};
const show = (id, ok, msg) => {
  const el = $(id);
  const base = el.className.split(' ').filter(c => !Object.values(TONE).includes(c)).join(' ');
  el.textContent = msg ? (ok === null ? '' : ok ? '\\u2714\\uFE0E ' : '\\u2716\\uFE0E ') + msg : '';
  el.className = base + ' ' + (ok === null ? TONE.info : ok ? TONE.ok : TONE.bad);
};
const STEPS = ${JSON.stringify(STEPS)};
const ARROW = ${JSON.stringify(arrow === '&larr;' ? '←' : '→')};
// Booleans only: which keys the server already has. Updated as the wizard saves keys.
const have = ${JSON.stringify({
    ai: d.aiConfigured,
    osKey: d.openSubtitlesKeyConfigured,
    osLogin: d.openSubtitlesLoginConfigured,
  })};
const KEY_FIELDS = {aiApiKey:'ai', openSubtitlesApiKey:'os', subdlApiKey:'subdl', jimakuApiKey:'jimaku', openSubtitlesUsername:'user', openSubtitlesPassword:'pass'};
const readKeys = (prefix, only) => {
  const body = {};
  for (const [name, id] of Object.entries(KEY_FIELDS)) {
    if (only && !only.includes(name)) continue;
    const input = document.getElementById(prefix + id); if (!input) continue;
    const v = input.value.trim(); if (v) body[name] = v;
  }
  return body;
};
const clearKeys = (prefix) => { for (const id of Object.values(KEY_FIELDS)) { const input = document.getElementById(prefix + id); if (input) input.value = ''; } };
const KEY_ERRORS = {400: T.keyErr400, 401: T.keyErr401, 503: T.keyErr503};
const saveKeys = async (body, resultId) => {
  show(resultId, null, body.aiApiKey ? T.verifying : T.saving);
  try {
    const r = await post('/api/keys', body);
    const msg = r.ok
      ? (r.provider ? f(T.verified, {p: r.provider}) : T.saved)
      : KEY_ERRORS[r.status] || T.keyErrOther;
    show(resultId, r.ok, msg);
    if (!r.ok) toast(false, msg);
    if (r.ok && body.subdlApiKey) {
      subdlOn = true;
      $('st-subdl-nokey').classList.add('hidden'); $('st-subdl-info').classList.remove('hidden');
      $('st-subdl-text').classList.remove('text-warm-mu'); $('st-subdl-text').textContent = f(T.stSubdlCount, {n: 0});
    }
    if (r.ok && body.jimakuApiKey) jimakuOn = true;
    return r.ok;
  } catch { show(resultId, false, FAILED); toast(false, FAILED); return false; }
};
let subdlOn = ${d.subdlKeyConfigured ? 'true' : 'false'};
let jimakuOn = ${d.jimakuKeyConfigured ? 'true' : 'false'};
const saveSettings = async (lang, dual, ui, embedded, sync, ask, clean) => {
  const r = await post('/api/settings', {targetLanguage: lang, dualSubtitles: dual, ...(ui ? {uiLanguage: ui} : {}), ...(embedded === undefined ? {} : {embeddedSubtitles: embedded}), ...(sync === undefined ? {} : {preciseSync: sync}), ...(ask === undefined ? {} : {translationMode: ask ? 'ask' : 'auto'}), ...(clean === undefined ? {} : {cleanSubtitles: clean})});
  return {...r, message: r.ok ? T.settingsSaved : T.settingsInvalid};
};
const setUiLang = async (ui) => {
  const r = await post('/api/settings', {uiLanguage: ui});
  if (r.ok) location.reload();
};

// Three views share the page: wizard, main screen (dash) and the subtitle library.
const VIEWS = {wizard: $('wizard'), dash: $('dash'), lib: $('lib')};
const setView = (name) => {
  for (const [k, el] of Object.entries(VIEWS)) { el.classList.toggle('hidden', k !== name); el.classList.toggle('flex', k === name); }
  if (name === 'lib') loadLib();
};

// Wizard (design 1B "Focus"): one centered card, five steps, segmented progress bar.
let step = ${startStep || 1};
// True when the wizard was opened from the main screen, so the first step can offer a way out.
let fromDash = ${startStep ? 'false' : 'true'};
const next = $('w-next'), back = $('w-back');
const render = () => {
  $('w-stepof').textContent = f(T.stepOf, {n: step});
  $('w-title').textContent = STEPS[step - 1][1];
  $('w-sub').textContent = STEPS[step - 1][2];
  document.querySelectorAll('[data-pane]').forEach(p => { const on = Number(p.dataset.pane) === step; p.classList.toggle('hidden', !on); p.classList.toggle('flex', on); });
  document.querySelectorAll('[data-bar]').forEach(b => { const on = Number(b.dataset.bar) <= step; b.classList.toggle('bg-warm-ac', on); b.classList.toggle('bg-warm-ln', !on); });
  // Step 1 has nothing to go back to, unless the wizard was opened from the main screen: then it cancels.
  back.classList.toggle('invisible', step === 1 && !fromDash);
  back.textContent = step === 1 ? T.leaveWizard : T.back;
  next.textContent = step === 5 ? T.finish : T.next + ' ' + ARROW;
  show('w-result', null, '');
};
const go = (n) => { step = Math.max(1, Math.min(5, n)); render(); };
back.addEventListener('click', () => { if (step === 1) setView('dash'); else go(step - 1); });
document.querySelectorAll('.js-lang-wrap').forEach((wrap) => {
  const btn = wrap.querySelector('.js-lang-btn'), menu = wrap.querySelector('.js-lang-menu');
  const close = () => { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); };
  btn.addEventListener('click', (e) => { e.stopPropagation(); const open = menu.classList.toggle('hidden') === false; btn.setAttribute('aria-expanded', String(open)); });
  menu.querySelectorAll('[data-ui]').forEach((o) => o.addEventListener('click', () => { close(); if (o.dataset.ui !== UI) setUiLang(o.dataset.ui); }));
  document.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
});
next.addEventListener('click', async () => {
  next.disabled = true;
  try {
    if (step === 1) {
      const body = readKeys('k-', ['aiApiKey']);
      if (!body.aiApiKey && !have.ai) { show('w-result', false, T.pasteToContinue); return; }
      if (body.aiApiKey) { if (!(await saveKeys(body, 'w-result'))) return; have.ai = true; $('k-ai').value = ''; }
    } else if (step === 2) {
      const body = readKeys('k-', ['openSubtitlesApiKey', 'openSubtitlesUsername', 'openSubtitlesPassword', 'subdlApiKey']);
      const keyOk = have.osKey || !!body.openSubtitlesApiKey;
      const loginOk = have.osLogin || (!!body.openSubtitlesUsername && !!body.openSubtitlesPassword);
      if (!keyOk || !loginOk) { show('w-result', false, T.fillOs); return; }
      if (Object.keys(body).length) { if (!(await saveKeys(body, 'w-result'))) return; have.osKey = true; have.osLogin = true; clearKeys('k-'); }
    } else if (step === 3) {
      const r = await saveSettings($('lang').value, $('dual').checked);
      if (!r.ok) { show('w-result', false, r.message); return; }
    } else if (step === 5) {
      location.reload(); // the main screen is rendered with the freshly saved settings
      return;
    }
    go(step + 1);
  } catch { show('w-result', false, FAILED); }
  finally { next.disabled = false; }
});
render();

// Settings drawer.
const drawer = $('drawer');
document.querySelectorAll('#groups > details').forEach((g) => g.addEventListener('toggle', () => {
  if (g.open) document.querySelectorAll('#groups > details').forEach((o) => { if (o !== g) o.open = false; });
}));
const setDrawer = (open) => { drawer.classList.toggle('hidden', !open); drawer.classList.toggle('flex', open); };
$('open-settings').addEventListener('click', () => setDrawer(true));
$('close-settings').addEventListener('click', () => setDrawer(false));
drawer.addEventListener('click', (e) => { if (e.target === drawer) setDrawer(false); });
const quickSave = async () => {
  const lang = $('q-lang').value, dual = $('q-dual').checked;
  try {
    const r = await saveSettings(lang, dual);
    toast(r.ok, r.message);
    if (r.ok) { $('d-lang').value = lang; $('d-dual').checked = dual; }
  } catch { toast(false, FAILED); }
};
const openStremioBtn = $('open-stremio');
const openStremioNow = async () => {
  openStremioBtn.disabled = true;
  try {
    const r = await post('/api/open-stremio', {});
    toast(r.ok, r.ok ? T.openStremioOk : r.code === 'NOT_INSTALLED' ? T.openStremioMissing : FAILED);
  } catch { toast(false, FAILED); }
  setTimeout(() => { openStremioBtn.disabled = false; }, 2000);
};
if (openStremioBtn) openStremioBtn.addEventListener('click', () => askOpen(T.extStremioTitle, T.extStremioBody, 'Stremio', openStremioNow));
$('resume-btn').addEventListener('click', async () => {
  const btn = $('resume-btn');
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = T.resumeBusy;
  btn.classList.add('animate-pulse');
  setTimeout(() => { btn.disabled = false; btn.textContent = label; btn.classList.remove('animate-pulse'); }, 1500);
  try {
    const r = await post('/api/resume', {});
    toast(r.ok, r.ok ? T.resumeStarted : T.resumeNone);
  } catch { toast(false, FAILED); }
  refreshStatus();
});
$('sync-now-btn').addEventListener('click', async () => {
  const btn = $('sync-now-btn');
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; }, 1500);
  try {
    const r = await post('/api/sync-now', {});
    const why = {NO_SUBTITLE: T.syncNowNoSub, NO_VIDEO: T.syncNowNoVideo, BUSY: T.syncNowBusy};
    toast(r.ok, r.ok ? T.syncNowStarted : why[r.code] || FAILED);
  } catch { toast(false, FAILED); }
  dismissedUpgrade = 0;
  refreshStatus();
});
$('q-lang').addEventListener('change', quickSave);
$('q-dual').addEventListener('change', quickSave);
$('rerun').addEventListener('click', () => { setDrawer(false); fromDash = true; go(1); setView('wizard'); });
$('save').addEventListener('click', async () => {
  const saveBtn = $('save');
  saveBtn.disabled = true;
  try {
    const body = readKeys('d-');
    if (Object.keys(body).length && !(await saveKeys(body, 'save-result'))) return;
    const r = await saveSettings($('d-lang').value, $('d-dual').checked, undefined, $('d-emb').checked, undefined, $('d-ask').checked, $('d-clean').checked);
    show('save-result', r.ok, r.message);
    toast(r.ok, r.message);
    if (r.ok) { clearKeys('d-'); setTimeout(() => location.reload(), 1000); }
  } catch { show('save-result', false, FAILED); toast(false, FAILED); }
  finally { saveBtn.disabled = false; }
});

// Connection checks (wizard step 4 and the main screen).
const TEST_OK = {ai: T.testOkAi, opensubtitles: T.testOkOs, subdl: T.testOkSubdl, jimaku: T.testOkJimaku};
document.querySelectorAll('[data-test]').forEach(b => b.addEventListener('click', async () => {
  const name = b.dataset.test, id = b.dataset.rp + name;
  if (name === 'subdl' && !subdlOn) { show(id, false, T.testNoKeySubdl); return; }
  if (name === 'jimaku' && !jimakuOn) { show(id, false, T.testNoKeyJimaku); return; }
  show(id, null, T.testing);
  try { const r = await post('/api/test/' + name); show(id, r.ok, r.ok ? TEST_OK[name] : errText(r, FAILED)); }
  catch { show(id, false, FAILED); }
}));
document.querySelectorAll('[data-sample]').forEach(b => b.addEventListener('click', async () => {
  const id = b.dataset.res, out = $(b.dataset.out);
  show(id, null, T.translating);
  // The old result must not stay on screen while a new one is being made.
  out.textContent = T.translating;
  out.hidden = false;
  try {
    const r = await post('/api/dev/sample');
    const count = r.ok && /\\d+/.exec(r.message || '');
    show(id, r.ok, r.ok ? (count ? f(T.translatedN, {n: count[0]}) : T.translatedOk) : errText(r, FAILED));
    if (r.ok) { out.textContent = r.preview; out.hidden = false; } else { out.hidden = true; }
  } catch { show(id, false, FAILED); out.hidden = true; }
}));
$('d-src').addEventListener('change', async () => {
  try {
    // Choosing the first source here replaces any custom order set under Developers.
    const r = await post('/api/settings', {subtitleSource: $('d-src').value, sourceOrder: []});
    if (r.ok) document.querySelectorAll('[data-src-badge]').forEach((b) => { const first = b.dataset.srcBadge === $('d-src').value; b.textContent = first ? T.srcInUse : T.srcBackup; b.className = 'rounded-full px-2 py-0.5 text-[11px] font-bold ' + (first ? 'bg-warm-ac/15 text-warm-ac' : 'bg-warm-ln text-warm-mu'); });
    toast(r.ok, r.ok ? T.settingsSaved : FAILED);
  } catch { toast(false, FAILED); }
});
$('d-test').addEventListener('change', async () => {
  const on = $('d-test').checked;
  try {
    const r = await post('/api/settings', {testMode: on});
    if (!r.ok) throw new Error('save');
    $('test-run').classList.toggle('hidden', !on);
    $('test-run').classList.toggle('flex', on);
    toast(true, on ? T.testEnabled : T.testDisabled);
  } catch { $('d-test').checked = !on; toast(false, FAILED); }
});
$('test-run-btn').addEventListener('click', async () => {
  try {
    const r = await post('/api/test/run');
    toast(r.ok, r.ok ? T.testStarted : FAILED);
  } catch { toast(false, FAILED); }
});
// Settings > Developers: every control is saved as soon as it changes.
const devSave = async (patch) => {
  try { const r = await post('/api/settings', patch); toast(r.ok, r.ok ? T.settingsSaved : FAILED); return r.ok; }
  catch { toast(false, FAILED); return false; }
};
$('dev-sound').addEventListener('change', () => devSave({soundCheck: $('dev-sound').value}));
$('dev-packs').addEventListener('change', () => devSave({seasonPacks: $('dev-packs').checked}));
$('dev-prefetch').addEventListener('change', () => devSave({prefetchNext: $('dev-prefetch').checked}));
$('dev-translate').addEventListener('change', () => devSave({preferTranslation: $('dev-translate').checked}));
[['dev-emb-wait', 'embeddedWaitSec', 120], ['dev-emb-eta', 'embeddedMaxEtaSec', 600]].forEach(([id, key, max]) => $(id).addEventListener('change', () => {
  const n = Math.min(max, Math.max(0, Math.round(Number($(id).value))));
  if (Number.isFinite(n)) { $(id).value = String(n); devSave({[key]: n}); }
}));
const orderItems = () => [...document.querySelectorAll('#dev-order [data-src]')];
const saveOrder = (changed) => {
  const on = orderItems().filter((li) => li.querySelector('input').checked).map((li) => li.dataset.src);
  if (on.length === 0) { if (changed) changed.checked = true; toast(false, T.devOrderNone); return; }
  devSave({sourceOrder: on});
};
$('dev-order').addEventListener('change', (e) => saveOrder(e.target));
$('dev-order').addEventListener('click', (e) => {
  const b = e.target.closest('[data-move]'); if (!b) return;
  const li = b.closest('li'), dir = Number(b.dataset.move);
  const other = dir < 0 ? li.previousElementSibling : li.nextElementSibling;
  if (!other) return;
  if (dir < 0) other.before(li); else other.after(li);
  saveOrder();
});
$('dev-order-reset').addEventListener('click', async () => {
  if (await devSave({sourceOrder: [], subtitleSource: 'subdl'})) location.reload();
});
const loadRedoList = async () => {
  try {
    const j = await (await fetch('/api/library')).json();
    const sel = $('dev-redo-item');
    sel.textContent = '';
    for (const e of (j.items || [])) {
      const o = document.createElement('option');
      o.value = e.id;
      o.textContent = e.title + (e.kind === 'series' ? ' S' + String(e.season ?? 0).padStart(2, '0') + 'E' + String(e.episode ?? 0).padStart(2, '0') : '');
      sel.appendChild(o);
    }
    $('dev-redo-btn').disabled = sel.options.length === 0;
    if (sel.options.length === 0) show('dev-redo-result', null, T.devRedoNone);
  } catch { /* the list stays empty */ }
};
$('dev-order').closest('details').addEventListener('toggle', (e) => { if (e.target.open) loadRedoList(); });
$('dev-redo-btn').addEventListener('click', async () => {
  const id = $('dev-redo-item').value;
  if (!id) return;
  try {
    const r = await post('/api/dev/redo', {id, source: $('dev-redo-src').value});
    show('dev-redo-result', r.ok, r.ok ? T.devRedoStarted : (r.status === 400 ? T.devRedoNoKey : T.devRedoBusy));
    if (r.ok) refreshStatus();
  } catch { show('dev-redo-result', false, FAILED); }
});
$('copy-diag').addEventListener('click', async () => {
  try {
    const text = await (await fetch('/api/diagnostics')).text();
    await navigator.clipboard.writeText(text);
    toast(true, T.diagCopied);
  } catch { toast(false, FAILED); }
});
// creator only
$('copy-diag-titles')?.addEventListener('click', async () => {
  try {
    const base = await (await fetch('/api/diagnostics')).text();
    const titles = await (await fetch('/api/diagnostics-titles')).text();
    await navigator.clipboard.writeText(base + '\\n\\n' + titles);
    toast(true, T.diagCopied);
  } catch { toast(false, FAILED); }
});
$('clear-cache').addEventListener('click', async () => {
  try {
    const r = await post('/api/cache/clear');
    const size = r.ok && /\\(([^)]+)\\)/.exec(r.message || '');
    const msg = r.ok ? T.clearOk + (size ? ' (' + size[1] + ')' : '') : T.clearFail;
    show('clear-result', r.ok, msg);
    toast(r.ok, msg);
  } catch { show('clear-result', false, FAILED); toast(false, FAILED); }
});

// Live status.
const STATES = {
  waiting: [T.stWaiting, 'bg-warm-mu'],
  translating: [T.stTranslating, 'bg-warm-ac animate-pulse'],
  ratelimited: [T.stRate, 'bg-amber-400 animate-pulse'],
  idle: [T.stIdle, 'bg-warm-ok'],
  error: [T.stError, 'bg-rose-400']
};
const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; };
// The translation queue: waiting for the user's OK, waiting for a free slot, or running.
const queueAct = async (id, action) => { try { await post('/api/jobs/' + id + '/' + action); } catch { /* shown on the next refresh */ } refreshStatus(); };
const queueRows = new Map(); // id -> the line on screen, kept between refreshes so a click is never lost
const queueStatus = (it) => it.state === 'pending' ? T.qPending : it.state === 'queued' ? T.qQueued : it.skippable === 'local' ? T.qLocal : it.skippable === 'sync' ? T.qSync : (it.percent === null ? T.qRunning : f(T.qRunningPct, {p: it.percent}));
const buildQueueRow = (it) => {
  const li = el('li', 'flex flex-col gap-2 rounded-xl border p-3 ' + (it.state === 'pending' ? 'border-warm-ac/60 bg-warm-ac/10' : 'border-warm-ln bg-warm-bg/40'));
  const where = it.season !== undefined && it.episode !== undefined ? ' · ' + f(T.qSeasonEp, {s: it.season, e: it.episode}) : '';
  li.append(el('div', 'text-sm font-semibold text-warm-tx', it.title + where));
  const status = el('div', 'text-xs ' + (it.state === 'pending' ? 'text-warm-ac' : 'text-warm-mu'), queueStatus(it));
  li.append(status);
  let fill = null;
  if (it.state === 'running') {
    const bar = el('div', 'h-1.5 overflow-hidden rounded-full bg-warm-bg');
    fill = el('div', 'h-full rounded-full bg-warm-ac transition-[width] duration-500');
    bar.append(fill);
    li.append(bar);
  }
  const row = el('div', 'flex flex-wrap gap-2');
  if (it.state === 'pending') {
    const yes = el('button', 'rounded-xl bg-warm-ac px-4 py-1.5 text-[13px] font-bold text-warm-on transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60', T.qTranslate);
    yes.type = 'button';
    yes.addEventListener('click', () => queueAct(it.id, 'approve'));
    row.append(yes);
  }
  if (it.skippable) {
    const skip = el('button', 'rounded-xl bg-warm-ac px-4 py-1.5 text-[13px] font-bold text-warm-on transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac/60', T.qSkip);
    skip.type = 'button';
    skip.addEventListener('click', () => queueAct(it.id, 'skip'));
    row.append(skip);
  }
  const no = el('button', 'rounded-xl border border-warm-ln px-4 py-1.5 text-[13px] font-semibold text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac', T.qCancel);
  no.type = 'button';
  no.addEventListener('click', () => queueAct(it.id, 'cancel'));
  row.append(no);
  li.append(row);
  return {li, state: it.state, skippable: it.skippable, status, fill};
};
const renderQueue = (items) => {
  const box = $('st-queue');
  // The list is for two or more; a single job is described, with its buttons, in the main card.
  const shown = items.length >= 2;
  box.classList.toggle('hidden', !shown);
  box.classList.toggle('flex', shown);
  const list = $('st-queue-list');
  // Rebuild only when a line appears, disappears or changes kind; otherwise just update the numbers.
  const same = items.length === queueRows.size && items.every((it) => queueRows.get(it.id)?.state === it.state && queueRows.get(it.id)?.skippable === it.skippable);
  if (!same) {
    list.replaceChildren();
    queueRows.clear();
    for (const it of items) { const r = buildQueueRow(it); queueRows.set(it.id, r); list.append(r.li); }
  }
  for (const it of items) {
    const r = queueRows.get(it.id);
    r.status.textContent = queueStatus(it);
    if (r.fill) r.fill.style.width = (it.percent ?? 0) + '%';
  }
};
// The "better subtitle is ready" notice can be closed; it comes back only for a newer one.
let dismissedUpgrade = 0;
const NOTICE_MS = 60000;
try { dismissedUpgrade = Number(localStorage.getItem('upgradeDismissed')) || 0; } catch { /* no storage: it just shows again */ }
const dismissSyncNotices = () => {
  dismissedUpgrade = Date.now();
  try { localStorage.setItem('upgradeDismissed', String(dismissedUpgrade)); } catch { /* not saved */ }
  for (const id of ['st-upgrade', 'st-sync']) { $(id).classList.add('hidden'); $(id).classList.remove('flex'); }
};
$('st-upgrade-close').addEventListener('click', dismissSyncNotices);
$('st-sync-ok').addEventListener('click', dismissSyncNotices);
$('st-sync-stop').addEventListener('click', async () => {
  try { await post('/api/sync-stop', {}); } catch { toast(false, FAILED); }
  refreshStatus();
});
// One job: what it is and what it is doing, with Skip / Cancel, right in the main card.
let nowJob = '';
const renderNow = (items) => {
  const it = items.length === 1 ? items[0] : null;
  const row = $('st-now');
  row.classList.toggle('hidden', !it);
  row.classList.toggle('flex', !!it);
  if (!it) return;
  nowJob = it.id;
  const where = it.season !== undefined && it.episode !== undefined ? ' · ' + f(T.qSeasonEp, {s: it.season, e: it.episode}) : '';
  $('st-now-name').textContent = it.title + where;
  $('st-now-status').textContent = queueStatus(it);
  $('st-now-yes').classList.toggle('hidden', it.state !== 'pending');
  $('st-now-skip').classList.toggle('hidden', !it.skippable);
};
$('st-now-yes').addEventListener('click', () => queueAct(nowJob, 'approve'));
$('st-now-skip').addEventListener('click', () => queueAct(nowJob, 'skip'));
$('st-now-cancel').addEventListener('click', () => queueAct(nowJob, 'cancel'));
const refreshStatus = async () => {
  try {
    const r = await (await fetch('/api/status')).json();
    const st = STATES[r.state] || STATES.waiting;
    // After a failure, say why (quota, key, rate limit...) instead of the general advice.
    $('st-state').textContent = (r.state === 'error' && r.lastError && ERRORS[r.lastError]) || st[0];
    $('st-dot').className = 'h-2.5 w-2.5 rounded-full ' + st[1] + (r.running > 0 ? ' animate-pulse' : '');
    $('st-lines').textContent = String(r.linesTranslated);
    const kb = r.bytesTranslated / 1024;
    $('st-size').textContent = kb >= 1024 ? (kb / 1024).toFixed(1) + ' MB' : Math.round(kb) + ' KB';
    const p = r.progress;
    const stageText = { queued: T.stageQueued, local: T.stageLocal, search: T.stageSearch, translate: T.stageTranslate, sync: f(T.stageSync, {p: r.syncPercent || 0}) }[r.stage];
    $('st-progress-text').textContent = p ? (p.percent >= 100 && r.running === 0 ? f(T.progressDone, {t: p.total}) : f(T.progressText, {d: p.done, t: p.total, p: p.percent})) : (r.running > 0 && stageText) || T.noSub;
    $('st-progress').style.width = (p ? p.percent : 0) + '%'; // CSSOM, allowed by the nonce-only CSP
    // The sound check that goes on beside (or after) the translation, and how it ended.
    const nameOf = (x) => '⁨' + x.title + '⁩' + (x.season !== undefined && x.episode !== undefined ? (UI === 'he' ? ' עונה ' + x.season + ' פרק ' + x.episode : ' S' + x.season + 'E' + x.episode) : '');
    const bs = r.backgroundSync, ls = r.lastSync;
    const dl = r.lastDelivered;
    $('st-delivered').classList.toggle('hidden', !dl);
    if (dl) $('st-delivered').textContent = f(T.deliveredText, {name: nameOf(dl)});
    const syncBox = $('st-sync');
    // A finished notice goes away by itself after a minute. When an exact subtitle arrived after the
    // sound check, only that one is shown: the check's "kept" answer is no longer the whole story.
    const fresh = (x) => !!x && x.at > dismissedUpgrade && Date.now() - x.at < NOTICE_MS;
    const syncShown = !!bs || (fresh(ls) && !(r.upgrade && r.upgrade.at >= ls.at));
    syncBox.classList.toggle('hidden', !syncShown);
    syncBox.classList.toggle('flex', syncShown);
    $('st-sync-bar').classList.toggle('hidden', !bs);
    $('st-sync-ok-row').classList.toggle('hidden', !!bs);
    if (bs) {
      $('st-sync-text').textContent = bs.waiting ? f(T.syncWaitVideo, {name: nameOf(bs)}) : f(T.syncRunning, {p: bs.percent, name: nameOf(bs)});
      $('st-sync-fill').style.width = bs.percent + '%';
      $('st-sync-pct').textContent = bs.percent + '%';
      const eta = bs.waiting ? null : bs.etaSec;
      $('st-sync-eta').textContent = bs.waiting ? '' : eta === null || eta === undefined ? T.syncEtaWait : f(T.syncEta, {t: eta < 60 ? eta + (UI === 'he' ? ' שנ׳' : ' s') : Math.round(eta / 6) / 10 + (UI === 'he' ? ' דק׳' : ' min')});
    } else if (syncShown) {
      $('st-sync-text').textContent = ls.outcome === 'moved' ? f(T.syncMoved, {name: nameOf(ls), s: (Math.abs(ls.offsetMs || 0) / 1000).toFixed(1)}) : ls.outcome === 'inSync' ? f(T.syncInSync, {name: nameOf(ls)}) : ls.outcome === 'unavailable' ? f(T.syncUnavailable, {name: nameOf(ls)}) : f(T.syncKept, {name: nameOf(ls)});
    }
    const q = r.quota;
    $('st-quota').classList.toggle('hidden', !q);
    if (q) {
      const used = q.limit - q.left;
      const share = Math.min(100, Math.round((used / q.limit) * 100));
      $('st-quota-text').textContent = used + ' / ' + q.limit;
      $('st-quota-bar').style.width = share + '%';
      $('st-quota-bar').className = 'h-full rounded-full transition-[width] duration-500 ' + (share >= 90 ? 'bg-rose-400' : share >= 70 ? 'bg-amber-400' : 'bg-warm-ok');
      const hint = $('st-quota-hint');
      hint.textContent = q.left === 0 ? T.stQuotaOut : q.left < 10 ? f(T.stQuotaLow, {n: q.left}) : '';
      hint.classList.toggle('hidden', !hint.textContent);
    }
    if (subdlOn) $('st-subdl-text').textContent = f(T.stSubdlCount, {n: r.subdlDownloads || 0});
    // Always a normal button; it only lights up when there is something to continue.
    const up = r.upgrade;
    const upVisible = fresh(up);
    $('st-upgrade').classList.toggle('hidden', !upVisible);
    $('st-upgrade').classList.toggle('flex', upVisible);
    if (upVisible) {
      const where = up.season !== undefined && up.episode !== undefined ? (UI === 'he' ? ' עונה ' + up.season + ' פרק ' + up.episode : ' S' + up.season + 'E' + up.episode) : '';
      $('st-upgrade-text').textContent = f(T.upgradeText, {name: up.title + where});
    }
    $('resume-btn').classList.toggle('!border-warm-ac', !!r.resumable);
    $('resume-btn').classList.toggle('!text-warm-ac', !!r.resumable);
    renderQueue(r.queue || []);
    renderNow(r.queue || []);
  } catch { /* the app may be restarting */ }
};
refreshStatus();
setInterval(refreshStatus, 1500);

// Subtitle library: everything translated so far, grouped by title, with delete.
const sizeText = (b) => b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
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
  const row = el('div', 'flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-2 py-1.5 text-sm transition hover:bg-warm-bg');
  const pick = el('label', 'flex min-w-0 flex-1 cursor-pointer items-center gap-3');
  pick.append(checkbox(picked.has(e.id), false, e.title, (on) => setPicked([e.id], on)));
  const name = e.kind === 'series' ? f(T.libEpisode, {n: e.episode ?? '?'}) : (e.label || T.libSubtitle);
  pick.append(el('span', 'min-w-0 flex-1 truncate font-medium text-warm-tx', name));
  row.append(pick);
  const meta = el('span', 'flex shrink-0 items-center gap-3 text-xs text-warm-mu');
  const ltr = (text) => { const s = el('span', '', text); s.dir = 'ltr'; return s; };
  if (e.timing) {
    const tone = e.timing === 'exact' ? 'border-warm-ok text-warm-ok' : e.timing === 'speech' ? 'border-warm-ac text-warm-ac' : 'border-amber-400 text-amber-400';
    const badge = el('span', 'rounded-full border px-2 py-0.5 text-[11px] font-semibold ' + tone, e.timing === 'exact' ? T.libExact : e.timing === 'speech' ? T.libSpeech : T.libEstimated);
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
  const dl = el('a', 'shrink-0 rounded-lg border border-warm-ln px-2.5 py-1 text-xs font-semibold text-warm-mu transition hover:border-warm-ac/60 hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac', T.libSrt);
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
    const muxButton = (label, tip, format) => {
      const mux = el('button', dl.className, label);
      mux.type = 'button';
      mux.title = tip;
      mux.addEventListener('click', async () => {
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
        mux.disabled = true; mux.textContent = T.libMuxBusy;
        try {
          const r = await fetch('/api/library/' + e.id + '/mux', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload || {video, format})});
          const j = await r.json();
          if (j.ok) toast(true, f(T.libMuxDone, {name: j.name}));
          else toast(false, j.code === 'NO_FFMPEG' ? T.libMuxNoFfmpeg : (j.code === 'NOT_A_VIDEO' || j.code === 'BAD_PATH') ? T.libMuxBadFile : T.libMuxFail);
        } catch { toast(false, T.libMuxFail); }
        mux.disabled = false; mux.textContent = label;
      });
      return mux;
    };
    actions.append(muxButton(T.libMux, T.libMuxTip, 'mkv'), muxButton(T.libMuxMp4, T.libMuxMp4Tip, 'mp4'));
  }
  return row;
};
const section = (key, title, count, items, body) => {
  const d = el('details', 'rounded-2xl border border-warm-ln bg-warm-sf');
  d.open = openGroups.has(key);
  d.addEventListener('toggle', () => { if (d.open) openGroups.add(key); else openGroups.delete(key); });
  const s = el('summary', 'flex cursor-pointer list-none items-center gap-3 p-3.5');
  const ids = items.map(e => e.id), st = groupState(ids);
  s.append(checkbox(st.checked, st.partial, title, (on) => setPicked(ids, on)));
  s.append(el('span', 'min-w-0 flex-1 truncate text-sm font-bold text-warm-tx', title));
  s.append(el('span', 'shrink-0 text-xs text-warm-mu', count));
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
    if (libItems.length <= 3) for (const e of libItems) openGroups.add(e.kind === 'movie' ? 'm:' + e.titleKey : e.titleKey);
  } catch { libItems = []; show('lib-result', false, T.libLoadFail); }
  for (const id of [...picked]) if (!libItems.some(e => e.id === id)) picked.delete(id);
  drawLib();
};
$('open-library').addEventListener('click', () => setView('lib'));
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
});
// News and updates (the bell): messages from the author and the release notes of every version.
const newsPanel = $('news-panel');
const setNews = (open) => { newsPanel.classList.toggle('hidden', !open); newsPanel.classList.toggle('flex', open); };
let newsData = null;
const unseenIds = () => {
  if (!newsData) return [];
  const seen = new Set(newsData.seen);
  const ids = newsData.items.map(i => i.id).filter(id => !seen.has(id));
  const latest = newsData.releases[0];
  if (latest && !seen.has('release-' + latest.version)) ids.push('release-' + latest.version);
  return ids;
};
const drawBadge = () => {
  const n = unseenIds().length;
  document.querySelectorAll('.js-news-badge').forEach(b => { b.textContent = String(n); b.classList.toggle('hidden', n === 0); b.classList.toggle('inline-flex', n > 0); });
};
const loadNews = async () => {
  try { const r = await (await fetch('/api/news')).json(); newsData = r.ok ? r : null; } catch { newsData = null; }
  drawBadge();
};
// A release note: a plain bullet, or a short title card that opens to show its explanation.
const noteNode = (n) => {
  const li = el('li', typeof n === 'string' ? 'flex gap-2.5' : 'list-none');
  if (typeof n === 'string') {
    li.append(el('span', 'mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-warm-ac'), el('span', '', n));
    return li;
  }
  const d = el('details', 'group rounded-xl border border-warm-ln bg-warm-sf');
  const sum = el('summary', 'flex cursor-pointer list-none items-center justify-between gap-3 p-3 text-sm font-semibold text-warm-tx');
  sum.append(el('span', '', n.title), el('span', 'text-warm-mu transition group-open:rotate-180', '▾'));
  d.append(sum, el('p', 'px-3 pb-3 text-sm leading-relaxed text-warm-mu', n.text));
  li.append(d);
  return li;
};
const tag = () => el('span', 'rounded-full bg-warm-ac px-2 py-0.5 text-[10px] font-bold text-warm-on', T.newsNew);
const drawNews = () => {
  const body = $('news-body');
  body.replaceChildren();
  if (!newsData) { body.append(el('p', 'text-sm text-warm-mu', T.newsOffline)); return; }
  const seen = new Set(newsData.seen);
  if (!newsData.online) body.append(el('p', 'rounded-xl border border-warm-ln px-3 py-2 text-xs text-warm-mu', T.newsOffline));
  if (newsData.items.length) body.append(el('h3', 'text-xs font-bold uppercase tracking-wide text-warm-ac', T.newsFromCreator));
  for (const i of newsData.items) {
    const card = el('div', 'rounded-2xl border border-warm-ln bg-warm-bg p-3.5');
    const head = el('div', 'flex items-start justify-between gap-3');
    head.append(el('div', 'text-sm font-bold text-warm-tx', i.title[UI]));
    const meta = el('div', 'flex shrink-0 items-center gap-2 text-xs text-warm-mu');
    if (!seen.has(i.id)) meta.append(tag());
    const day = el('span', '', i.date); day.dir = 'ltr'; meta.append(day);
    head.append(meta);
    card.append(head, el('p', 'mt-1.5 whitespace-pre-line text-sm text-warm-tx/90', i.body[UI]));
    if (i.link) {
      const a = el('a', 'mt-2 inline-block text-xs font-semibold text-warm-ac hover:underline', T.newsLink);
      a.href = i.link; a.target = '_blank'; a.rel = 'noopener noreferrer';
      card.append(a);
    }
    body.append(card);
  }
  body.append(el('h3', 'mt-2 text-xs font-bold uppercase tracking-wide text-warm-ac', T.newsWhatsNew));
  // The newest three versions are listed; older ones stay behind a button so the list stays short.
  const VISIBLE = 3;
  const older = el('div', 'hidden flex-col gap-2.5');
  newsData.releases.forEach((r, idx) => {
    const d = el('details', 'rounded-2xl border border-warm-ln bg-warm-bg');
    d.open = idx === 0;
    const s = el('summary', 'flex cursor-pointer list-none items-center justify-between gap-3 p-3.5 text-sm font-bold text-warm-tx');
    s.append(el('span', '', f(T.newsVersion, {v: r.version})));
    if (idx === 0 && !seen.has('release-' + r.version)) s.append(tag());
    const ul = el('ul', 'space-y-1.5 px-3.5 pb-3.5 text-sm text-warm-tx/90');
    for (const n of (r.notes[UI] || r.notes.en)) ul.append(noteNode(n));
    d.append(s, ul);
    (idx < VISIBLE ? body : older).append(d);
  });
  const extra = newsData.releases.length - VISIBLE;
  if (extra > 0) {
    const more = el('button', 'rounded-2xl border border-warm-ln px-4 py-2 text-sm font-semibold text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac', f(T.newsOlder, {n: extra}));
    more.type = 'button';
    more.addEventListener('click', () => {
      const show = older.classList.contains('hidden');
      older.classList.toggle('hidden', !show); older.classList.toggle('flex', show);
      more.textContent = show ? T.newsHideOlder : f(T.newsOlder, {n: extra});
    });
    body.append(more, older);
  }
};
const openNews = async () => {
  await loadNews();
  drawNews();
  setNews(true);
  const ids = unseenIds();
  if (ids.length) {
    try { const r = await post('/api/news/seen', {ids}); if (r.ok) { newsData.seen.push(...ids); drawBadge(); } } catch { /* shown as new once more */ }
  }
};
document.querySelectorAll('.js-news').forEach(b => b.addEventListener('click', openNews));
$('news-panel-close').addEventListener('click', () => setNews(false));
newsPanel.addEventListener('click', (e) => { if (e.target === newsPanel) setNews(false); });
loadNews();
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { setDrawer(false); setDelModal(false); setNews(false); setSyncModal(false); } });
if (window.desktop) {
  window.desktop.setLanguage(UI);
  const maxIcon = $('win-max-icon');
  $('win-max').addEventListener('click', () => window.desktop.toggleMaximize());
  window.desktop.onMaximizeChange((m) => { maxIcon.setAttribute('width', m ? '7' : '9'); maxIcon.setAttribute('height', m ? '7' : '9'); maxIcon.setAttribute('y', m ? '2.5' : '.5'); });
  $('win-min').addEventListener('click', () => window.desktop.minimize());
  const modal = $('exit-modal');
  const setModal = (open) => { modal.classList.toggle('hidden', !open); modal.classList.toggle('flex', open); };
  $('win-close').addEventListener('click', () => setModal(true));
  $('exit-cancel').addEventListener('click', () => setModal(false));
  $('exit-tray').addEventListener('click', () => { setModal(false); window.desktop.hide(); });
  $('exit-quit').addEventListener('click', () => window.desktop.quit());
  modal.addEventListener('click', (e) => { if (e.target === modal) setModal(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setModal(false); });

  // Updates: top-bar button only when an update is downloaded; manual check lives in Settings.
  const updateBtn = $('update-btn');
  const checkBtn = $('check-update');
  const UPDATE_TEXT = {
    checking: [true, T.updChecking],
    none: [true, T.updNone],
    unavailable: [true, T.updUnavailable],
    error: [false, T.updError]
  };
  // The button's own display class would override the hidden attribute, so toggle classes instead.
  const showUpdateBtn = (on) => { updateBtn.classList.toggle('hidden', !on); updateBtn.classList.toggle('inline-flex', on); };
  const applyUpdate = (s) => {
    showUpdateBtn(s.status === 'downloaded');
    if (s.status === 'downloaded') updateBtn.title = f(T.updateInstallV, {v: s.version});
    const out = $('update-result');
    if (!out) return;
    if (s.status === 'downloading') show('update-result', true, f(T.updDownloading, {v: s.version}));
    else if (s.status === 'downloaded') show('update-result', true, f(T.updReady, {v: s.version}));
    else if (UPDATE_TEXT[s.status]) show('update-result', ...UPDATE_TEXT[s.status]);
    else out.textContent = '';
    checkBtn.disabled = s.status === 'checking';
  };
  window.desktop.updater.state().then((s) => showUpdateBtn(s.status === 'downloaded'));
  window.desktop.updater.onState(applyUpdate);
  updateBtn.addEventListener('click', () => window.desktop.updater.install());
  checkBtn.addEventListener('click', () => window.desktop.updater.check().then(applyUpdate));
  window.desktop.version().then((v) => { $('app-version').textContent = v; });

  // What's New: shown once, on the first launch after an update, in the screen's language.
  const news = $('news-modal');
  const closeNews = () => { news.classList.add('hidden'); news.classList.remove('flex'); window.desktop.whatsNew.dismiss(); };
  window.desktop.whatsNew.get(UI).then((w) => {
    if (!w) return;
    $('news-version').textContent = w.version;
    const list = $('news-list');
    for (const n of w.notes) list.append(noteNode(n));
    news.classList.remove('hidden');
    news.classList.add('flex');
  });
  $('news-close').addEventListener('click', closeNews);
}
for (const [btnId, fieldId] of [['copy', 'manifest'], ['copy-d', 'manifest-d']]) {
  const copyBtn = $(btnId);
  if (copyBtn) copyBtn.addEventListener('click', () => { navigator.clipboard.writeText($(fieldId).value); toast(true, ${JSON.stringify(t(lang, 'copied'))}); });
}
</script>
</body></html>`;
}
