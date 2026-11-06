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

/** Shown in the player while the subtitle is being made. Stremio loads it once, so no percentage. */
export function waitingMessage(lang: 'he' | 'en'): string {
  return lang === 'he'
    ? 'TTT Sub: מתרגם... בסיום בחר שוב את הכתובית'
    : 'TTT Sub: Translating... when it is done, select the subtitle again';
}

/** Shown in the player when the job failed. The reason is in the app, not here. */
export function failureMessage(lang: 'he' | 'en', code: string): string {
  if (code === 'SOURCE_SUBTITLE_NOT_FOUND') {
    return lang === 'he'
      ? 'TTT Sub: לא נמצאה כתובית לפרק הזה'
      : 'TTT Sub: No subtitle found for this episode';
  }
  return lang === 'he'
    ? 'TTT Sub: משהו השתבש. פתח את האפליקציה לפרטים'
    : 'TTT Sub: Something went wrong. Open the app for details';
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
