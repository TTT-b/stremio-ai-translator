/**
 * First module of the standalone .exe. Runs before anything reads .env or data/.
 * Files (.env, settings.json, data/, logs/) live next to the .exe, never inside it, and the
 * console stays open on a fatal error so a double-click user can read the message.
 */
import { dirname } from 'node:path';

process.chdir(dirname(process.execPath));

const realExit = process.exit.bind(process);
process.exit = ((code?: number) => {
  if (code && process.stdin.isTTY) {
    console.error('\nPress Enter to close this window.');
    process.stdin.once('data', () => realExit(code));
    return undefined as never;
  }
  return realExit(code);
}) as typeof process.exit;
