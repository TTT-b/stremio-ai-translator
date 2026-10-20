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
export function progressMessage(
  lang: 'he' | 'en',
  stage: string | undefined,
  percent: number | null,
): string {
  const again =
    lang === 'he' ? 'בחר שוב את הכתובית בעוד רגע' : 'reselect this subtitle in a moment';
  const he: Record<string, string> = {
    queued: 'ממתין בתור…',
    local: 'בודק אם יש כתובית בתוך הסרט…',
    search: 'מחפש כתובית…',
    sync: 'מסנכרן את התזמון לדיבור (כמה דקות, פעם אחת)…',
  };
  const en: Record<string, string> = {
    queued: 'Waiting in the queue…',
    local: 'Checking for a subtitle inside the video…',
    search: 'Searching for a subtitle…',
    sync: 'Syncing the timing to the speech (a few minutes, once)…',
  };
  const translating =
    lang === 'he'
      ? `מתרגם את הכתוביות…${percent === null ? '' : ` ${percent}%`}`
      : `Translating the subtitles…${percent === null ? '' : ` ${percent}%`}`;
  const line =
    stage === 'translate' ? translating : ((lang === 'he' ? he : en)[stage ?? ''] ?? translating);
  return `${line} — ${again}`;
}
