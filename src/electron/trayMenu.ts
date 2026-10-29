/** Texts and time formatting for the tray (the icon near the clock) menu. */
export type TrayLang = 'he' | 'en';

export interface TrayStatus {
  running: number;
  paused: boolean;
  /** Seconds until the subtitle is complete, sound check included; null when not known. */
  totalEtaSec: number | null;
}

export const TRAY_LABELS = {
  he: {
    open: 'פתח את המתרגם',
    pause: 'השהה תרגום',
    resume: 'המשך תרגום',
    eta: 'זמן עד תרגום מלא',
    etaNote: 'כולל סנכרון הקול',
    estimating: 'מחשב...',
    paused: 'מושהה',
    startup: 'הפעל עם Windows',
    quit: 'כבה את האפליקציה',
  },
  en: {
    open: 'Open the translator',
    pause: 'Pause translation',
    resume: 'Resume translation',
    eta: 'Time until fully translated',
    etaNote: 'including the sound sync',
    estimating: 'estimating...',
    paused: 'paused',
    startup: 'Start with Windows',
    quit: 'Turn off the app',
  },
} as const;

const SECONDS_PER_MINUTE = 60;

/** "about 40 s" under a minute, "about 2:10 min" above it. */
export function formatEta(sec: number, lang: TrayLang): string {
  const total = Math.max(0, Math.round(sec));
  if (total < SECONDS_PER_MINUTE) return lang === 'he' ? `כ-${total} שנ׳` : `about ${total} s`;
  const minutes = Math.floor(total / SECONDS_PER_MINUTE);
  const seconds = String(total % SECONDS_PER_MINUTE).padStart(2, '0');
  return lang === 'he' ? `כ-${minutes}:${seconds} דק׳` : `about ${minutes}:${seconds} min`;
}

/** The value shown next to "time until fully translated", or null when nothing is being translated. */
export function etaValue(status: TrayStatus | null, lang: TrayLang): string | null {
  if (!status || status.running === 0) return null;
  const labels = TRAY_LABELS[lang];
  if (status.paused) return labels.paused;
  return status.totalEtaSec === null ? labels.estimating : formatEta(status.totalEtaSec, lang);
}
