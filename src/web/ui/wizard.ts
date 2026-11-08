import { btn, btnPrimary, escapeHtml, field, labelCls, result, selectField } from './components';
import { t } from '../i18n';
import type { UiCtx } from './context';

/** First-run setup wizard: keys, languages, checks, install and (desktop) startup. */
export function renderWizard(c: UiCtx): string {
  const {
    d,
    lang,
    tt,
    passwordField,
    arrow,
    nudge,
    keyLink,
    langMenu,
    STEPS,
    toggle,
    dualSwitch,
    langOptions,
    startStep,
    checks,
    keyPh,
  } = c;
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

  return `<div id="wizard" class="${startStep ? 'flex' : 'hidden'} w-full max-w-[520px] flex-col items-center">
<div class="mb-3 flex w-full items-center justify-end gap-2"><button type="button" class="js-news ${btn} relative !px-3 !py-2 !border-transparent" aria-label="${tt('newsBell')}" title="${tt('newsBell')}"><span class="text-base leading-none" aria-hidden="true">&#128276;</span><span class="js-news-badge absolute -top-1 -end-1 hidden h-4 min-w-4 items-center justify-center rounded-full bg-warm-ac px-1 text-[10px] font-bold text-warm-on"></span></button>${langMenu()}</div>
<ol id="w-bars" class="mb-7 flex w-full gap-1.5" aria-label="${tt('setupProgress')}">${STEPS.map(
    (s, i) =>
      `<li class="h-[5px] flex-1 rounded-full bg-warm-ln transition-colors" data-bar="${i + 1}" title="${escapeHtml(s[0])}"><span class="sr-only">${escapeHtml(s[0])}</span></li>`,
  ).join('')}</ol>
<section class="flex min-h-[540px] w-full flex-col gap-5 rounded-[22px] border border-warm-ln bg-warm-sf p-8" aria-live="polite">
<div><div id="w-stepof" class="mb-2 text-xs font-semibold tracking-wide text-warm-ac">${tt('stepOf', { n: 1, total: STEPS.length })}</div><h2 id="w-title" class="text-[26px] font-bold leading-tight text-warm-tx">${escapeHtml(STEPS[0]?.[1] ?? '')}</h2><p id="w-sub" class="mt-2 text-sm leading-relaxed text-warm-mu">${escapeHtml(STEPS[0]?.[2] ?? '')}</p></div>

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
${passwordField('k-pass', d.openSubtitlesLoginConfigured ? tt('savedPh') : tt('osPassPh'))}</div>
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

${d.desktop ? `<div data-pane="6" class="hidden flex-col gap-3">${toggle('w-startup', true, 'startupLabel', 'startupHint')}${toggle('w-minimized', true, 'minimizedLabelWizard', 'minimizedHint')}</div>` : ''}

<div class="mt-auto"><span class="${result} mb-2 text-center" id="w-result"></span>
<div class="flex items-center justify-between gap-3"><button type="button" id="w-back" class="invisible rounded-2xl border border-warm-ln px-5 py-3 text-sm font-semibold text-warm-tx transition hover:border-warm-mu hover:bg-warm-sf focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac">${tt('back')}</button><button type="button" id="w-next" class="${btnPrimary} min-w-[150px] text-center">${tt('next')} ${arrow}</button></div></div>
</section>
</div>`;
}
