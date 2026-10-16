/**
 * Desktop entry point (Electron main process). Runs the same local server as `npm start`
 * in-process and shows the status page in a native, frameless window. No console window.
 * Keys, settings, cache and logs live in the per-user app data folder, never next to the .exe.
 * Closing the window hides it to the tray so translations keep running; "Quit" really exits.
 */
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from 'electron';
import { autoUpdater } from 'electron-updater';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { isAppError } from '../errors';
import { startAddon, type RunningAddon } from '../startup';
import { ICON_PNG_BASE64 } from './iconData';
import { isStremioInstallUrl } from './links';

const TITLE = 'Stremio AI Subtitle Translator';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let running: RunningAddon | undefined;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

const icon = nativeImage.createFromDataURL(`data:image/png;base64,${ICON_PNG_BASE64}`);

function showWindow(): void {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createWindow(port: number): void {
  const origin = `http://127.0.0.1:${port}`;
  win = new BrowserWindow({
    width: 1000,
    height: 800,
    minWidth: 480,
    minHeight: 600,
    title: TITLE,
    icon,
    frame: false,
    backgroundColor: '#070b14',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  win.removeMenu();
  // The window may only show our own page; anything else opens in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url) || isStremioInstallUrl(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(origin)) {
      event.preventDefault();
      if (/^https:\/\//.test(url) || isStremioInstallUrl(url)) void shell.openExternal(url);
    }
  });
  // Any other close request (Alt+F4, taskbar) hides to the tray; only Quit really closes it.
  win.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      win?.hide();
    }
  });
  const sendMaximized = () => win?.webContents.send('window:maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  win.on('closed', () => {
    win = undefined;
  });
  void win.loadURL(`${origin}/`);
}

function createTray(): void {
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip(TITLE);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open UI', click: showWindow },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]),
  );
  tray.on('click', showWindow);
}

function setupUpdater(logger: Logger): void {
  if (!app.isPackaged) return; // updates only apply to the installed app
  autoUpdater.logger = null;
  autoUpdater.on('error', (err) => {
    logger.warn({ stage: 'CONFIG', error: err.message }, 'update check failed');
  });
  autoUpdater.on('update-downloaded', (info) => {
    logger.info({ stage: 'CONFIG', version: info.version }, 'update downloaded');
  });
  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch(() => undefined);
  };
  check();
  setInterval(check, UPDATE_CHECK_INTERVAL_MS).unref();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.on('before-quit', () => {
    quitting = true;
  });

  ipcMain.on('window:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
  ipcMain.on('window:toggle-maximize', (e) => {
    const w = BrowserWindow.fromWebContents(e.sender);
    if (!w) return;
    if (w.isMaximized()) w.unmaximize();
    else w.maximize();
  });
  // The page shows its own "Close the Translator?" modal and then asks for one of these.
  ipcMain.on('window:hide', (e) => BrowserWindow.fromWebContents(e.sender)?.hide());
  ipcMain.on('window:quit', () => app.quit());
  // Only our own add-on link may be handed to the operating system (opens Stremio desktop).
  ipcMain.on('app:open-stremio', (_e, url: unknown) => {
    if (typeof url === 'string' && isStremioInstallUrl(url)) void shell.openExternal(url);
  });

  app.whenReady().then(async () => {
    try {
      running = await startAddon(app.getPath('userData'));
      createWindow(running.port);
      createTray();
      setupUpdater(running.logger);
    } catch (err) {
      const message = isAppError(err) ? err.message : 'The add-on could not start.';
      dialog.showErrorBox(TITLE, message);
      app.exit(1);
    }
  });

  // Stay alive in the tray when the window is hidden or closed.
  app.on('window-all-closed', () => undefined);
  app.on('will-quit', () => {
    void running?.stop();
  });
}
