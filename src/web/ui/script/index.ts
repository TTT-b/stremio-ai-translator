import { escapeHtml } from '../components';
import type { UiCtx } from '../context';
import { scriptCore } from './core';
import { scriptWizard } from './wizard';
import { scriptDrawer } from './drawer';
import { scriptStatus } from './status';
import { scriptLibrary } from './library';
import { scriptNews } from './news';

/** The page's inline script: one <script> with the page's nonce, built from its parts in order. */
export function renderScript(c: UiCtx): string {
  return [
    `<script nonce="${escapeHtml(c.d.nonce)}">`,
    scriptCore(c),
    scriptWizard(c),
    scriptDrawer(c),
    scriptStatus(c),
    scriptLibrary(c),
    scriptNews(c),
    '</script>',
  ].join('\n');
}
