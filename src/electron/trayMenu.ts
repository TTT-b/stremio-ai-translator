/** Texts and time formatting for the tray (the icon near the clock) menu. */
export type TrayLang = 'he' | 'en';

export interface TrayStatus {
  running: number;
  paused: boolean;
  /** Seconds until the subtitle is complete, sound check included; null when not known. */
  totalEtaSec: number | null;
  /** The state word of the status card: waiting, translating, ratelimited, idle or error. */
  state: string;
  /** How far the current translation is, 0..100, or null. */
  percent: number | null;
  /** The episode being worked on, for the first line of the menu and the tooltip. */
  title: string | null;
  season: number | null;
  episode: number | null;
  /** When a subtitle was last handed over or upgraded (ms), or null. */
  readyAt: number | null;
  /** Code of the latest failure while the state is error. */
  lastError: string | null;
}

export type TrayDot = 'gray' | 'yellow' | 'green' | 'red';

/** How long the green "ready" dot stays. */
export const READY_DOT_MS = 60_000;

export interface TrayIndicator {
  dot: TrayDot;
  tooltip: string;
  /** First, disabled line of the menu; null when nothing is going on. */
  menuLine: string | null;
}

const INDICATOR_TEXT = {
  he: {
    waiting: 'ממתין לסרט',
    translating: 'מתרגם',
    ready: 'הכתובית מוכנה · בחר אותה שוב בסטרימיו',
    error: 'שגיאה',
    limited: 'מגבלת שימוש, ממתין',
    paused: 'מושהה',
    menuTranslating: 'מתרגם',
  },
  en: {
    waiting: 'waiting for a video',
    translating: 'translating',
    ready: 'subtitle ready · select it again in Stremio',
    error: 'error',
    limited: 'usage limit, waiting',
    paused: 'paused',
    menuTranslating: 'Translating',
  },
} as const;

function episodeText(status: TrayStatus, lang: TrayLang): string {
  if (status.season === null || status.episode === null) return '';
  return lang === 'he' ? `פרק ${status.episode}` : `E${status.episode}`;
}

/** The colour of the dot on the tray icon, its tooltip and the first line of the menu. */
export function trayIndicator(
  status: TrayStatus | null,
  lang: TrayLang,
  now: number,
): TrayIndicator {
  const text = INDICATOR_TEXT[lang];
  const name = 'TTT Sub';
  if (!status) return { dot: 'gray', tooltip: name, menuLine: null };
  const where = episodeText(status, lang);
  const pct = status.percent === null ? '' : `${status.percent}%`;
  const detail = [where, pct].filter(Boolean).join(' · ');
  const bracket = [where, pct ? `(${pct})` : ''].filter(Boolean).join(' ');
  if (status.state === 'error') {
    return { dot: 'red', tooltip: `${name}: ${text.error}`, menuLine: null };
  }
  if (status.state === 'ratelimited') {
    return { dot: 'red', tooltip: `${name}: ${text.limited}`, menuLine: null };
  }
  if (status.paused && status.running > 0) {
    return { dot: 'yellow', tooltip: `${name}: ${text.paused}`, menuLine: text.paused };
  }
  if (status.state === 'translating' || status.running > 0) {
    const tail = detail ? ` · ${detail}` : '';
    return {
      dot: 'yellow',
      tooltip: `${name}: ${text.translating}${tail}`,
      menuLine: bracket ? `${text.menuTranslating}: ${bracket}` : text.menuTranslating,
    };
  }
  if (status.readyAt !== null && now - status.readyAt < READY_DOT_MS) {
    return { dot: 'green', tooltip: `${name}: ${text.ready}`, menuLine: null };
  }
  return { dot: 'gray', tooltip: `${name}: ${text.waiting}`, menuLine: null };
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
export function etaValue(
  status: Pick<TrayStatus, 'running' | 'paused' | 'totalEtaSec'> | null,
  lang: TrayLang,
): string | null {
  if (!status || status.running === 0) return null;
  const labels = TRAY_LABELS[lang];
  if (status.paused) return labels.paused;
  return status.totalEtaSec === null ? labels.estimating : formatEta(status.totalEtaSec, lang);
}
