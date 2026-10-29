import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  HIDDEN_FLAG,
  launchedHidden,
  LOGIN_ITEM_ARG_VARIANTS,
  loginItemArgs,
  parseStartupRequest,
  readStartupPrefs,
  writeStartupPrefs,
} from '../src/electron/loginItem';

const tmpFile = () => join(mkdtempSync(join(tmpdir(), 'login-')), 'startup.json');

describe('start-with-Windows preferences', () => {
  it('start minimized by default when nothing was saved', () => {
    expect(readStartupPrefs(tmpFile())).toEqual({ minimized: true });
  });

  it('remembers the choice', () => {
    const file = tmpFile();
    writeStartupPrefs(file, { minimized: false });
    expect(readStartupPrefs(file)).toEqual({ minimized: false });
  });

  it('falls back to the default for a damaged or wrong file', () => {
    const file = tmpFile();
    writeFileSync(file, '{not json');
    expect(readStartupPrefs(file)).toEqual({ minimized: true });
    writeFileSync(file, JSON.stringify({ minimized: 'no' }));
    expect(readStartupPrefs(file)).toEqual({ minimized: true });
  });
});

describe('the login item command line', () => {
  it('adds the hidden flag only when starting minimized', () => {
    expect(loginItemArgs(true)).toEqual([HIDDEN_FLAG]);
    expect(loginItemArgs(false)).toEqual([]);
  });

  it('reads the login item back with and without the hidden flag', () => {
    expect(LOGIN_ITEM_ARG_VARIANTS).toEqual([[HIDDEN_FLAG], []]);
  });

  it('knows it was started hidden only from that flag', () => {
    expect(launchedHidden(['app.exe', HIDDEN_FLAG])).toBe(true);
    expect(launchedHidden(['app.exe'])).toBe(false);
    expect(launchedHidden(['app.exe', '--hidden-ish'])).toBe(false);
  });
});

describe('what the page may ask for', () => {
  it('accepts two booleans', () => {
    expect(parseStartupRequest({ openAtLogin: true, minimized: false })).toEqual({
      openAtLogin: true,
      minimized: false,
    });
  });

  it('refuses anything else', () => {
    for (const bad of [
      null,
      undefined,
      'x',
      1,
      {},
      { openAtLogin: true },
      { openAtLogin: 1, minimized: 0 },
    ]) {
      expect(parseStartupRequest(bad)).toBeNull();
    }
  });
});
