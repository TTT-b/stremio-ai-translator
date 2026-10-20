import { execFile, spawn } from 'node:child_process';

/** Opens the Stremio app through its own link type (stremio://), the way a click on it would. */

export interface LaunchResult {
  ok: boolean;
  /** NOT_INSTALLED: no program on this computer handles stremio:// links. FAILED: it did not start. */
  code?: 'NOT_INSTALLED' | 'FAILED';
}

export interface LauncherRuntime {
  platform: NodeJS.Platform;
  /** Is a program registered for stremio:// links? (Windows only; elsewhere assumed yes.) */
  isRegistered(): Promise<boolean>;
  /** Hands stremio:// to the system and returns at once. */
  open(): Promise<void>;
}

const realRuntime: LauncherRuntime = {
  platform: process.platform,
  isRegistered: () =>
    new Promise((resolve) => {
      execFile('reg', ['query', 'HKCR\\stremio', '/ve'], { windowsHide: true }, (error) =>
        resolve(!error),
      );
    }),
  open: () =>
    new Promise((resolve, reject) => {
      const [cmd, args]: [string, string[]] =
        process.platform === 'win32'
          ? ['cmd.exe', ['/c', 'start', '', 'stremio://']]
          : process.platform === 'darwin'
            ? ['open', ['stremio://']]
            : ['xdg-open', ['stremio://']];
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    }),
};

export async function openStremio(runtime: LauncherRuntime = realRuntime): Promise<LaunchResult> {
  try {
    if (runtime.platform === 'win32' && !(await runtime.isRegistered())) {
      return { ok: false, code: 'NOT_INSTALLED' };
    }
    await runtime.open();
    return { ok: true };
  } catch {
    return { ok: false, code: 'FAILED' };
  }
}
