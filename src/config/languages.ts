export interface Language {
  code: string;
  name: string;
  rtl: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'he', name: 'Hebrew', rtl: true },
  { code: 'en', name: 'English', rtl: false },
  { code: 'ar', name: 'Arabic', rtl: true },
  { code: 'fa', name: 'Persian', rtl: true },
  { code: 'es', name: 'Spanish', rtl: false },
  { code: 'fr', name: 'French', rtl: false },
  { code: 'de', name: 'German', rtl: false },
  { code: 'it', name: 'Italian', rtl: false },
  { code: 'pt', name: 'Portuguese', rtl: false },
  { code: 'ru', name: 'Russian', rtl: false },
  { code: 'uk', name: 'Ukrainian', rtl: false },
  { code: 'pl', name: 'Polish', rtl: false },
  { code: 'nl', name: 'Dutch', rtl: false },
  { code: 'tr', name: 'Turkish', rtl: false },
  { code: 'el', name: 'Greek', rtl: false },
  { code: 'ro', name: 'Romanian', rtl: false },
  { code: 'hi', name: 'Hindi', rtl: false },
  { code: 'ja', name: 'Japanese', rtl: false },
  { code: 'ko', name: 'Korean', rtl: false },
  { code: 'zh', name: 'Chinese', rtl: false },
];

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code.toLowerCase());
}

/** Models offered on the config page. The first is the default. */
export const KNOWN_MODELS: readonly string[] = [
  'gemma-4-31b-it',
  'gemma-4-26b-a4b-it',
  'gemini-3.5-flash-lite',
  'gemini-3.8-flash',
];

export const DEFAULT_MODEL = KNOWN_MODELS[0] as string;
