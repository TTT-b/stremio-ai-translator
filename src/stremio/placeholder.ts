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

export const IN_PROGRESS_MESSAGE = 'Translation in progress — reselect this subtitle in a minute';

/** Shown while the video is being listened to for precise sync (the first time takes a few minutes). */
export const SYNC_IN_PROGRESS_MESSAGE =
  'Syncing the subtitle to the speech (a few minutes, once) - reselect this subtitle later';
