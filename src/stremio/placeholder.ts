import { serializeSubtitle } from '../subtitles/serialize';
import type { Cue } from '../subtitles/types';

/** A tiny valid SRT shown while the real subtitle is not available. */
export function placeholderSrt(message: string): string {
  const text = message.replace(/\r?\n/g, ' ').replace(/-->/g, '->').trim();
  return `1\n00:00:00,500 --> 01:00:00,000\n${text}\n`;
}

/** Ask mode: shown in the player while the translation waits for the user's OK in the app. */
export function pendingMessage(lang: 'he' | 'en'): string {
  return lang === 'he'
    ? 'התקבל. פתח את מתרגם הכתוביות ולחץ "תרגם", ואז בחר שוב את הכתובית'
    : 'Received. Open the subtitle translator and press Translate, then reselect this subtitle';
}

export const CANCELLED_MESSAGE = 'Translation cancelled';

/** What the job is doing, as the player shows it while the subtitle is not ready. */
export function progressMessage(lang: 'he' | 'en', stage: string | undefined): string {
  const again =
    lang === 'he' ? 'בחר שוב את הכתוביות בסוף התהליך' : 'reselect the subtitles when it finishes';
  const he: Record<string, string> = {
    queued: 'ממתין בתור',
    local: 'בודק אם יש כתוביות בתוך הסרט',
    search: 'מחפש כתוביות',
    sync: 'מסנכרן את הכתוביות',
  };
  const en: Record<string, string> = {
    queued: 'Waiting in the queue',
    local: 'Checking for subtitles inside the video',
    search: 'Searching for subtitles',
    sync: 'Syncing the subtitles',
  };
  // No percentage: Stremio loads this text once, so a number would stay frozen on the screen.
  const translating = lang === 'he' ? 'מתרגם את הכתוביות' : 'Translating the subtitles';
  const line =
    stage === 'translate' ? translating : ((lang === 'he' ? he : en)[stage ?? ''] ?? translating);
  return `${line} - ${again}`;
}

/** The line shown after a partial subtitle, from its last line to the end of the movie. */
export function partialNotice(lang: 'he' | 'en', stopped: boolean): string {
  if (lang === 'he') {
    return stopped
      ? 'התרגום נעצר. בחר שוב את הכתוביות כדי לנסות שוב'
      : 'התרגום ממשיך ברקע. בחר שוב את הכתוביות בעוד כמה דקות';
  }
  return stopped
    ? 'Translation stopped. Reselect the subtitles to try again'
    : 'Translation continues in the background. Reselect the subtitles in a few minutes';
}

/** The translated first part plus one note line that runs to the end of the movie. */
export function withPartialNotice(
  cues: Cue[],
  untilMs: number,
  lang: 'he' | 'en',
  stopped: boolean,
): string {
  const startMs = cues[cues.length - 1]?.endMs ?? 0;
  const note: Cue = {
    index: (cues[cues.length - 1]?.index ?? 0) + 1,
    startMs,
    endMs: Math.max(untilMs, startMs + 1000),
    text: partialNotice(lang, stopped),
  };
  return serializeSubtitle({ format: 'srt', cues: [...cues, note] });
}
