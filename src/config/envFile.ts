import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { AppError } from '../errors';

/** Pick a dotenv-safe quote style for a value, or throw if none can represent it. */
export function quoteEnvValue(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new AppError('CONFIGURATION_INVALID', 'value contains a line break');
  }
  if (value === '') return '';
  if (/^[A-Za-z0-9_.:/@+=-]+$/.test(value)) return value;
  for (const q of ["'", '`', '"']) {
    if (value.includes(q)) continue;
    if (q === '"' && value.includes('\\')) continue; // dotenv expands \n inside double quotes
    return `${q}${value}${q}`;
  }
  throw new AppError('CONFIGURATION_INVALID', 'value uses unsupported quote characters');
}

/**
 * Set KEY=value lines in a .env file, keeping every other line (comments, order) intact.
 * Written atomically. Never logs or returns the values.
 */
export function updateEnvFile(path: string, updates: Record<string, string>): void {
  const original = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original === '' ? [] : original.replace(/\r\n/g, '\n').split('\n');
  const pending = new Map(Object.entries(updates));

  const out = lines.map((line) => {
    const m = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    const key = m?.[1];
    if (key && pending.has(key)) {
      const value = pending.get(key) as string;
      pending.delete(key);
      return `${key}=${quoteEnvValue(value)}`;
    }
    return line;
  });
  for (const [key, value] of pending) {
    if (out.length > 0 && out[out.length - 1] === '') out.pop();
    out.push(`${key}=${quoteEnvValue(value)}`, '');
  }
  const text = out.join(eol);
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text.endsWith(eol) ? text : text + eol, 'utf8');
  renameSync(tmp, path);
}
