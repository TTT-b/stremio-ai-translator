import { readFileSync, writeFileSync } from 'node:fs';

/** What the app remembers about starting with Windows (the Windows login item itself lives in the OS). */
export interface StartupPrefs {
  /** Start with only the tray icon, without opening the window. */
  minimized: boolean;
}

/** Added to the command line of the login item so the app knows it should not open its window. */
export const HIDDEN_FLAG = '--hidden';

const DEFAULT_PREFS: StartupPrefs = { minimized: true };

export function readStartupPrefs(file: string): StartupPrefs {
  try {
    const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
    const minimized = (data as { minimized?: unknown }).minimized;
    return { minimized: typeof minimized === 'boolean' ? minimized : DEFAULT_PREFS.minimized };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function writeStartupPrefs(file: string, prefs: StartupPrefs): void {
  writeFileSync(file, JSON.stringify(prefs));
}

export function loginItemArgs(minimized: boolean): string[] {
  return minimized ? [HIDDEN_FLAG] : [];
}

/**
 * Every command line the login item may have been saved with. Windows only reports an item as
 * enabled when asked with the same arguments it was saved with, so reading it back must try both.
 */
export const LOGIN_ITEM_ARG_VARIANTS: readonly (readonly string[])[] = [
  loginItemArgs(true),
  loginItemArgs(false),
];

/** True when this launch came from the login item set to start minimized. */
export function launchedHidden(argv: readonly string[]): boolean {
  return argv.includes(HIDDEN_FLAG);
}

/** What the page may ask for. Anything that is not a boolean is refused. */
export function parseStartupRequest(
  input: unknown,
): { openAtLogin: boolean; minimized: boolean } | null {
  if (typeof input !== 'object' || input === null) return null;
  const { openAtLogin, minimized } = input as Record<string, unknown>;
  if (typeof openAtLogin !== 'boolean' || typeof minimized !== 'boolean') return null;
  return { openAtLogin, minimized };
}
