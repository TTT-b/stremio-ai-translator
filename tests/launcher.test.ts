import { describe, expect, it } from 'vitest';
import { openStremio, type LauncherRuntime } from '../src/stremio/launcher';

const runtime = (over: Partial<LauncherRuntime> = {}): LauncherRuntime & { opened: number } => {
  const state = {
    opened: 0,
    platform: 'win32' as NodeJS.Platform,
    isRegistered: async () => true,
    open: async () => {
      state.opened++;
    },
    ...over,
  };
  return state;
};

describe('openStremio', () => {
  it('opens Stremio when something handles its links', async () => {
    const rt = runtime();
    expect(await openStremio(rt)).toEqual({ ok: true });
    expect(rt.opened).toBe(1);
  });

  it('says it is not installed instead of opening a "no app" box (Windows)', async () => {
    const rt = runtime({ isRegistered: async () => false });
    expect(await openStremio(rt)).toEqual({ ok: false, code: 'NOT_INSTALLED' });
    expect(rt.opened).toBe(0);
  });

  it('does not check the registry on other systems', async () => {
    const rt = runtime({ platform: 'darwin', isRegistered: async () => false });
    expect(await openStremio(rt)).toEqual({ ok: true });
  });

  it('reports a start that failed', async () => {
    const rt = runtime({
      open: async () => {
        throw new Error('spawn failed');
      },
    });
    expect(await openStremio(rt)).toEqual({ ok: false, code: 'FAILED' });
  });
});
