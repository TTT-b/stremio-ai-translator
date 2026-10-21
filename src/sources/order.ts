import type { Settings } from '../config/settings';
import type { SourceId } from './ordered';

/** The recommended order: SubDL (no daily cap worth mentioning), OpenSubtitles, then Jimaku (Japanese). */
export const RECOMMENDED_ORDER: SourceId[] = ['subdl', 'opensubtitles', 'jimaku'];

/**
 * The sources to use, best first. A saved order wins (a source left out is not used); otherwise the
 * older "first source" choice decides, otherwise the recommended order.
 */
export function sourceOrderFrom(
  settings: Pick<Settings, 'sourceOrder' | 'subtitleSource'>,
): SourceId[] {
  if (settings.sourceOrder && settings.sourceOrder.length > 0) {
    return [...new Set(settings.sourceOrder)];
  }
  return settings.subtitleSource === 'opensubtitles'
    ? ['opensubtitles', 'subdl', 'jimaku']
    : RECOMMENDED_ORDER;
}
