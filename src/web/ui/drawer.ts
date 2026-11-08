import { btn, btnPrimary, escapeHtml, field, labelCls, result, selectField } from './components';
import type { UiCtx } from './context';
import { renderModelPicker } from './modelPicker';

/** Settings drawer: keys, translation, general, maintenance and about (with developer settings). */
export function renderDrawer(c: UiCtx): string {
  const { d, tt, passwordField, keyRow, toggle, group, langOptions, keyPh } = c;
  /** Settings drawer footer (desktop only): app version and a manual update check, result on its own line below. */
  const updatesRow = `<div class="flex flex-col gap-3"><div class="flex items-center justify-between gap-3"><div><div class="text-xs text-warm-mu">${tt('version')}</div><div id="app-version" dir="ltr" class="font-mono text-base font-bold text-warm-tx"></div></div><button type="button" id="check-update" class="${btn} flex items-center gap-2 !px-5"><span aria-hidden="true">&#8635;</span>${tt('checkUpdates')}</button></div><span class="${result}" id="update-result"></span></div>`;
  // Settings > Developers
  const dev = d.dev ?? {
    soundCheck: 'background' as const,
    seasonPacks: true,
    preferTranslation: false,
    prefetchNext: false,
    embeddedWaitSec: 15,
    embeddedMaxEtaSec: 180,
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

  return `<div id="drawer" class="${d.desktop ? 'top-9' : 'top-0'} fixed inset-x-0 bottom-0 z-40 hidden justify-start bg-black/45" role="dialog" aria-modal="true" aria-labelledby="drawer-title">
<div class="flex h-full w-[420px] max-w-full flex-col gap-[18px] overflow-auto border-e border-warm-ln bg-warm-bg p-[26px] shadow-2xl shadow-black/60">
<div class="flex items-center justify-between"><h2 id="drawer-title" class="text-xl font-bold">${tt('settingsTitle')}</h2><button type="button" id="close-settings" class="rounded-lg px-2 text-lg text-warm-mu transition hover:text-warm-tx focus:outline-none focus-visible:ring-2 focus-visible:ring-warm-ac" aria-label="${tt('closeSettings')}">&#10005;</button></div>
<div class="flex flex-col gap-3" id="groups">
${group(
  'secKeys',
  `<ul class="grid gap-2 text-sm">
${keyRow('aiApiKey', tt('rowAi'), d.aiConfigured, escapeHtml(d.aiProviderLabel) || tt('configured'))}
${keyRow('openSubtitlesApiKey', tt('rowOsKey'), d.openSubtitlesKeyConfigured)}
${keyRow('subdlApiKey', tt('rowSubdl'), d.subdlKeyConfigured ?? false)}
${keyRow('jimakuApiKey', tt('rowJimaku'), d.jimakuKeyConfigured ?? false)}
${keyRow('openSubtitlesLogin', `${tt('rowOsLogin')}${d.openSubtitlesUsername ? ` (<span class="font-mono" dir="ltr">${escapeHtml(d.openSubtitlesUsername)}</span>)` : ''}`, d.openSubtitlesLoginConfigured)}
</ul>
<div><label class="${labelCls}" for="d-ai">${tt('aiKeyLabel')}</label><input class="${field}" id="d-ai" type="password" autocomplete="off" placeholder="${keyPh(d.aiConfigured)}"></div>
<div><label class="${labelCls}" for="d-os">${tt('osKeyLabel')}</label><input class="${field}" id="d-os" type="password" autocomplete="off" placeholder="${keyPh(d.openSubtitlesKeyConfigured)}"></div>
<div class="grid grid-cols-2 gap-3"><div><label class="${labelCls}" for="d-user">${tt('username')}</label><input class="${field}" id="d-user" type="text" autocomplete="off" placeholder="${d.openSubtitlesUsername ? tt('keptPh') : tt('username')}"></div><div><label class="${labelCls}" for="d-pass">${tt('password')}</label>${passwordField('d-pass', d.openSubtitlesLoginConfigured ? tt('keptPh') : tt('password'))}</div></div>
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
${d.aiConfigured && d.aiProvider ? renderModelPicker(c) : ''}
${
  d.desktop
    ? group(
        'secGeneral',
        `<div class="flex flex-col divide-y divide-warm-ln overflow-hidden rounded-2xl border border-warm-ln">${toggle('d-startup', false, 'startupLabel', 'startupHint', true)}
${toggle('d-minimized', false, 'minimizedLabel', 'minimizedHint', true)}</div>
<p id="startup-note" class="hidden text-xs text-warm-mu">${tt('startupUnavailable')}</p>`,
      )
    : ''
}
${group(
  'secMaintenance',
  `<p class="text-xs text-warm-mu">${tt('clearNote')}</p>
<div class="grid grid-cols-2 gap-2.5"><button type="button" id="clear-cache" class="${btn}">${tt('clearCache')}</button><button type="button" id="rerun" class="${btn}">${tt('rerun')}</button></div>
<span class="${result} text-center" id="clear-result"></span>
<div class="flex flex-col gap-2.5 border-t border-warm-ln pt-3.5"><p class="text-xs text-warm-mu">${tt('diagNote')}</p><button type="button" id="copy-diag" class="${btn}">${tt('diagBtn')}</button></div>`,
)}
${group('menuAbout', `<p class="text-xs text-warm-mu">${tt('aboutDesc')}</p>${d.desktop ? updatesRow : ''}${d.devSettings ? devSection : devSection.replace('<details', '<details hidden')}`)}
</div>
<div class="sticky -bottom-[26px] z-10 -mx-[26px] -mb-[26px] mt-auto grid gap-2 border-t border-warm-ln bg-warm-bg/95 px-[26px] pb-[26px] pt-4 backdrop-blur"><span class="${result} text-center" id="save-result"></span><button type="button" id="save" class="${btnPrimary} w-full !py-3">${tt('save')}</button></div>
</div></div>`;
}
