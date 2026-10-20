import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import type { Config } from './env';
import { findLanguage } from './languages';

/** Non-secret settings editable on the config page. Stored in settings.json (gitignored). */
const settingsSchema = z.object({
  targetLanguage: z
    .string()
    .refine((v) => findLanguage(v) !== undefined, 'unsupported language')
    .optional(),
  dualSubtitles: z.boolean().optional(),
  embeddedSubtitles: z.boolean().optional(),
  cleanSubtitles: z.boolean().optional(),
  /** auto: translate right away. ask: wait for the user's OK in the app. */
  translationMode: z.enum(['auto', 'ask']).optional(),
  /** Language of the app's own screens. */
  uiLanguage: z.enum(['he', 'en']).optional(),
  /** Which subtitle source is asked first. subdl needs a SubDL key; OpenSubtitles is the backup. */
  subtitleSource: z.enum(['opensubtitles', 'subdl']).optional(),
  /** Developer test mode: made-up subtitles and a pretend AI, nothing leaves the computer. */
  testMode: z.boolean().optional(),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS_PATH = resolve(process.cwd(), 'settings.json');

export function readSettings(path = DEFAULT_SETTINGS_PATH): Settings {
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    const parsed = settingsSchema.safeParse(raw);
    return parsed.success ? parsed.data : {};
  } catch {
    return {};
  }
}

export function parseSettingsUpdate(input: unknown): Settings {
  return settingsSchema.parse(input);
}

export function writeSettings(settings: Settings, path = DEFAULT_SETTINGS_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf8');
  renameSync(tmp, path);
}

/** Environment config with settings.json overrides applied. */
export function effectiveConfig(config: Config, settings: Settings): Config {
  return {
    ...config,
    targetLanguage: settings.targetLanguage ?? config.targetLanguage,
    dualSubtitles: settings.dualSubtitles ?? config.dualSubtitles,
    embeddedSubtitles: settings.embeddedSubtitles ?? config.embeddedSubtitles,
    cleanSubtitles: settings.cleanSubtitles ?? config.cleanSubtitles,
    translationMode: settings.translationMode ?? config.translationMode,
  };
}
