export interface Language {
  code: string;
  /** ISO 639-2 code, as Stremio expects in subtitle lang. */
  iso3: string;
  name: string;
  rtl: boolean;
}

export const LANGUAGES: readonly Language[] = [
  { code: 'he', iso3: 'heb', name: 'Hebrew', rtl: true },
  { code: 'en', iso3: 'eng', name: 'English', rtl: false },
  { code: 'ar', iso3: 'ara', name: 'Arabic', rtl: true },
  { code: 'fa', iso3: 'per', name: 'Persian', rtl: true },
  { code: 'es', iso3: 'spa', name: 'Spanish', rtl: false },
  { code: 'fr', iso3: 'fre', name: 'French', rtl: false },
  { code: 'de', iso3: 'ger', name: 'German', rtl: false },
  { code: 'it', iso3: 'ita', name: 'Italian', rtl: false },
  { code: 'pt', iso3: 'por', name: 'Portuguese', rtl: false },
  { code: 'ru', iso3: 'rus', name: 'Russian', rtl: false },
  { code: 'uk', iso3: 'ukr', name: 'Ukrainian', rtl: false },
  { code: 'pl', iso3: 'pol', name: 'Polish', rtl: false },
  { code: 'nl', iso3: 'dut', name: 'Dutch', rtl: false },
  { code: 'tr', iso3: 'tur', name: 'Turkish', rtl: false },
  { code: 'el', iso3: 'gre', name: 'Greek', rtl: false },
  { code: 'ro', iso3: 'rum', name: 'Romanian', rtl: false },
  { code: 'hi', iso3: 'hin', name: 'Hindi', rtl: false },
  { code: 'ja', iso3: 'jpn', name: 'Japanese', rtl: false },
  { code: 'ko', iso3: 'kor', name: 'Korean', rtl: false },
  { code: 'zh', iso3: 'chi', name: 'Chinese', rtl: false },
];

export function findLanguage(code: string): Language | undefined {
  return LANGUAGES.find((l) => l.code === code.toLowerCase());
}

/** Models offered on the config page. The first is the default. */
export const KNOWN_MODELS: readonly string[] = ['gemini-3.5-flash-lite', 'gemini-3.8-flash'];

export const DEFAULT_MODEL = KNOWN_MODELS[0] as string;
