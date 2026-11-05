import { readFileSync } from 'node:fs';
import { ERROR_MESSAGES, type UiLang } from './i18n';
import { escapeHtml } from './ui/components';
import { createUiCtx } from './ui/context';
import { renderDashboard } from './ui/dashboard';
import { renderDrawer } from './ui/drawer';
import { renderLibrary } from './ui/library';
import { renderConfirmModals, renderExtModal } from './ui/modals';
import { renderScript } from './ui/script';
import { renderTitleBar } from './ui/titleBar';
import { renderWizard } from './ui/wizard';

/** Replaced at build time by scripts/build-electron.mjs; undefined when running from source. */
declare const __TAILWIND_CSS__: string | undefined;

export { escapeHtml };
export { prettyModel, providerLine } from './ui/provider';

export interface StatusPageData {
  nonce: string;
  aiConfigured: boolean;
  /** Provider detected from the saved key, e.g. "Google Gemini"; empty when none. */
  aiProviderLabel: string;
  aiModel: string;
  /** Provider id ("gemini", "anthropic", "openai"); picks the model section's title and icon. */
  aiProvider?: string;
  /** Gemini only: continue on a fallback model when the chosen one is overloaded. */
  autoSwitchModel?: boolean;
  dualSubtitles: boolean;
  /** Use subtitle tracks stored inside the video file (default on). */
  embeddedSubtitles?: boolean;
  cleanSubtitles?: boolean;
  /** auto: translate right away. ask: wait for the user's OK first. */
  translationMode?: 'auto' | 'ask';
  /** Which subtitle source is asked first. */
  subtitleSource?: 'opensubtitles' | 'subdl';
  /** Developer test mode is on (made-up subtitles, pretend AI). */
  testMode?: boolean;
  jimakuKeyConfigured?: boolean;
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
  /** Show Settings > About > Developer settings (off for everyone but the author: SHOW_DEV_SETTINGS=1). */
  devSettings?: boolean;
  /** Language of the screens. Hebrew (right-to-left) unless set to English. */
  uiLang?: UiLang;
}

/** Locally built Tailwind CSS (npm run build:css), inlined so the page loads nothing external. */
const CSS = (
  typeof __TAILWIND_CSS__ === 'string'
    ? __TAILWIND_CSS__ // embedded by scripts/build-electron.mjs
    : readFileSync(new URL('./tailwind.generated.css', import.meta.url), 'utf8')
).replace(/<\/style/gi, '<\\/style');

/** Everything that can be clicked shows the hand cursor (a disabled control shows the arrow). */
const POINTER_CSS =
  'select,button,summary,[role=button],[role=option],label[for],input[type=checkbox],input[type=range]{cursor:pointer}button:disabled,input:disabled,select:disabled{cursor:default}';

/** Hebrew text for the API error codes (kept for callers and tests; see i18n.ts for both languages). */
export const ERROR_MESSAGES_HE = ERROR_MESSAGES.he;

export function renderStatusPage(d: StatusPageData): string {
  const c = createUiCtx(d);
  const { lang, dir, tt } = c;

  return `<!doctype html>
<html lang="${lang}" dir="${dir}" class="dark"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<title>${tt('appTitle')}</title>
<style nonce="${escapeHtml(d.nonce)}">${CSS}${POINTER_CSS}</style></head>
<body class="min-h-screen bg-warm-bg font-sans text-warm-tx antialiased">
${d.desktop ? renderTitleBar(c) : ''}
<main class="mx-auto flex min-h-screen w-full flex-col items-center px-4 pb-10 sm:px-10 ${d.desktop ? 'pt-[76px]' : 'pt-10'}">

${renderWizard(c)}

${renderDashboard(c)}

${renderLibrary(c)}

<p class="mt-auto max-w-[560px] px-1 pt-8 text-center text-xs text-warm-mu/80">${tt('privacy')}</p>
</main>

${renderConfirmModals(c)}

${renderDrawer(c)}

${renderExtModal(c)}
${renderScript(c)}
</body></html>`;
}
