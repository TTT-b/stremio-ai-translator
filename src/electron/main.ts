/**
 * Desktop entry point (Electron main process). Runs the same local server as `npm start`
 * in-process and shows the status page in a native, frameless window. No console window.
 * Keys, settings, cache and logs live in the per-user app data folder, never next to the .exe.
 * Closing the window hides it to the tray so translations keep running; "Quit" really exits.
 */
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  Notification,
  shell,
  Tray,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logger } from 'pino';
import { isAppError } from '../errors';
import { startAddon, type RunningAddon } from '../startup';
import { zoomFor } from './zoom';
import { ICON_PNG_BASE64 } from './iconData';
import { isStremioInstallUrl } from './links';
import {
  launchedHidden,
  LOGIN_ITEM_ARG_VARIANTS,
  loginItemArgs,
  parseStartupRequest,
  readStartupPrefs,
  writeStartupPrefs,
} from './loginItem';
import { etaValue, TRAY_LABELS, type TrayStatus } from './trayMenu';
import { pickWhatsNew } from './whatsNew';

const TITLE = 'Stremio AI Subtitle Translator';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

let running: RunningAddon | undefined;
let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

/** Started by Windows with "start minimized": only the tray icon, no window. */
const startHidden = launchedHidden(process.argv);

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
    show: !startHidden,
    backgroundColor: '#15120e',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });
  win.removeMenu();
  // F11 toggles full screen; Esc leaves it.
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !win) return;
    if (input.key === 'F11') {
      event.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    } else if (input.key === 'Escape' && win.isFullScreen()) {
      event.preventDefault();
      win.setFullScreen(false);
    }
  });
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
  // A bigger window gets a bigger picture (text, buttons, cards), so any monitor size looks right.
  let appliedZoom = 1;
  const fitZoom = () => {
    if (!win || win.isDestroyed()) return;
    const [width, height] = win.getContentSize();
    const zoom = zoomFor(width ?? 0, height ?? 0);
    if (zoom !== appliedZoom) {
      appliedZoom = zoom;
      win.webContents.setZoomFactor(zoom);
    }
  };
  win.on('resize', fitZoom);
  win.webContents.on('did-finish-load', () => {
    appliedZoom = 0; // the page was reloaded: set it again
    fitZoom();
  });
  const sendMaximized = () => win?.webContents.send('window:maximized', win.isMaximized());
  win.on('maximize', sendMaximized);
  win.on('unmaximize', sendMaximized);
  win.on('closed', () => {
    win = undefined;
  });
  void win.loadURL(`${origin}/`);
}

let uiLang: 'he' | 'en' = 'en';

const startupPrefsFile = () => join(app.getPath('userData'), 'startup.json');

/** The Windows login item only exists for the installed app, not for `npm run desktop`. */
function startupState(): { available: boolean; openAtLogin: boolean; minimized: boolean } {
  const { minimized } = readStartupPrefs(startupPrefsFile());
  return {
    available: app.isPackaged,
    openAtLogin:
      app.isPackaged &&
      LOGIN_ITEM_ARG_VARIANTS.some(
        (args) => app.getLoginItemSettings({ args: [...args] }).openAtLogin,
      ),
    minimized,
  };
}

function applyStartup(openAtLogin: boolean, minimized: boolean): void {
  try {
    writeStartupPrefs(startupPrefsFile(), { minimized });
  } catch {
    /* not critical: the choice just is not remembered */
  }
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin, args: loginItemArgs(minimized) });
}

/** Live numbers for the tray menu, from the local server this app runs. Null if it does not answer. */
async function fetchTrayStatus(): Promise<TrayStatus | null> {
  if (!running) return null;
  try {
    const res = await fetch(`http://127.0.0.1:${running.port}/api/status`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = (await res.json()) as Partial<TrayStatus>;
    return {
      running: typeof body.running === 'number' ? body.running : 0,
      paused: body.paused === true,
      totalEtaSec: typeof body.totalEtaSec === 'number' ? body.totalEtaSec : null,
    };
  } catch {
    return null;
  }
}

async function setPausedFromTray(paused: boolean): Promise<void> {
  if (!running) return;
  try {
    await fetch(`http://127.0.0.1:${running.port}/api/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused }),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* the menu is rebuilt from the real state the next time it opens */
  }
}

/** Ask mode: tell the user a request arrived and wait for their OK in the app. */
function notifyPending(item: { title: string; season?: number; episode?: number }): void {
  if (!Notification.isSupported()) return;
  const where =
    item.season !== undefined && item.episode !== undefined
      ? uiLang === 'he'
        ? ` עונה ${item.season} פרק ${item.episode}`
        : ` S${item.season}E${item.episode}`
      : '';
  const body =
    uiLang === 'he'
      ? `התקבל: ${item.title}${where}. ללחוץ כאן כדי לבחור אם לתרגם.`
      : `Received: ${item.title}${where}. Click here to choose whether to translate.`;
  const note = new Notification({ title: TITLE, body, icon });
  note.on('click', showWindow);
  note.show();
}

/** A better subtitle (exact timing) replaced the shown one: the user has to pick it again in Stremio. */
function notifyUpgraded(item: { title: string; season?: number; episode?: number }): void {
  if (!Notification.isSupported()) return;
  const where =
    item.season !== undefined && item.episode !== undefined
      ? uiLang === 'he'
        ? ` עונה ${item.season} פרק ${item.episode}`
        : ` S${item.season}E${item.episode}`
      : '';
  const body =
    uiLang === 'he'
      ? `כתובית מדויקת מוכנה: ${item.title}${where}. בחר אותה שוב ב-Stremio.`
      : `An exact subtitle is ready: ${item.title}${where}. Select it again in Stremio.`;
  const note = new Notification({ title: TITLE, body, icon });
  note.on('click', showWindow);
  note.show();
}

/** Built fresh every time it opens, so the pause state and the time left are current. */
function buildTrayMenu(status: TrayStatus | null): Menu {
  const labels = TRAY_LABELS[uiLang];
  const eta = etaValue(status, uiLang);
  const startup = startupState();
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: labels.open, click: showWindow },
    { type: 'separator' },
    {
      label: status?.paused ? labels.resume : labels.pause,
      click: () => void setPausedFromTray(!status?.paused),
    },
  ];
  if (eta !== null) {
    items.push(
      { label: `${labels.eta}: ${eta}`, enabled: false },
      { label: labels.etaNote, enabled: false },
    );
  }
  if (startup.available) {
    items.push(
      { type: 'separator' },
      {
        label: labels.startup,
        type: 'checkbox',
        checked: startup.openAtLogin,
        click: (item) => applyStartup(item.checked, startup.minimized),
      },
    );
  }
  items.push({ type: 'separator' }, { label: labels.quit, click: () => app.quit() });
  return Menu.buildFromTemplate(items);
}

function createTray(): void {
  tray = new Tray(icon.resize({ width: 32, height: 32 }));
  tray.setToolTip(TITLE);
  tray.on('click', showWindow);
  tray.on('right-click', () => {
    void fetchTrayStatus().then((status) => tray?.popUpContextMenu(buildTrayMenu(status)));
  });
}

type UpdateState =
  | { status: 'idle' | 'checking' | 'none' | 'unavailable' }
  | { status: 'downloading' | 'downloaded'; version: string }
  | { status: 'error'; message: string };

let updateState: UpdateState = { status: 'idle' };

function setUpdateState(next: UpdateState): void {
  updateState = next;
  win?.webContents.send('updater:state', next);
}

function checkForUpdates(): void {
  if (!app.isPackaged) {
    setUpdateState({ status: 'unavailable' }); // updates only apply to the installed app
    return;
  }
  if (updateState.status === 'checking' || updateState.status === 'downloaded') return;
  setUpdateState({ status: 'checking' });
  autoUpdater.checkForUpdates().catch(() => undefined); // result arrives through the events below
}

function setupUpdater(logger: Logger): void {
  if (!app.isPackaged) return;
  autoUpdater.logger = null;
  autoUpdater.on('update-available', (info) => {
    setUpdateState({ status: 'downloading', version: info.version });
  });
  autoUpdater.on('update-not-available', () => setUpdateState({ status: 'none' }));
  autoUpdater.on('error', (err) => {
    logger.warn({ stage: 'CONFIG', error: err.message }, 'update check failed');
    setUpdateState({ status: 'error', message: 'Could not check for updates. Try again later.' });
  });
  autoUpdater.on('update-downloaded', (info) => {
    logger.info({ stage: 'CONFIG', version: info.version }, 'update downloaded');
    setUpdateState({ status: 'downloaded', version: info.version });
  });
  checkForUpdates();
  setInterval(checkForUpdates, UPDATE_CHECK_INTERVAL_MS).unref();
}

const seenFile = () => join(app.getPath('userData'), 'last-seen-version.json');

function readLastSeen(): string | undefined {
  try {
    const data: unknown = JSON.parse(readFileSync(seenFile(), 'utf8'));
    const v = (data as { version?: unknown }).version;
    return typeof v === 'string' ? v : undefined;
  } catch {
    return undefined;
  }
}

function writeLastSeen(version: string): void {
  try {
    writeFileSync(seenFile(), JSON.stringify({ version }));
  } catch {
    /* not critical: the popup could show once more */
  }
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
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('updater:state', () => updateState);
  ipcMain.handle('updater:check', () => {
    checkForUpdates();
    return updateState;
  });
  ipcMain.on('updater:install', () => {
    if (updateState.status !== 'downloaded') return;
    quitting = true; // let the window really close instead of hiding to the tray
    autoUpdater.quitAndInstall(false, true);
  });
  // First launch after an update: the page shows the release notes once, then confirms.
  ipcMain.handle(
    'whatsnew:get',
    (_e, lang: unknown) =>
      pickWhatsNew(readLastSeen(), app.getVersion(), lang === 'he' ? 'he' : 'en') ?? null,
  );
  // The page tells us its language so the tray menu matches it.
  ipcMain.on('app:set-language', (_e, lang: unknown) => {
    uiLang = lang === 'he' ? 'he' : 'en';
  });
  // "Start with Windows" and "start minimized": the page reads and sets them through these two.
  ipcMain.handle('startup:get', () => startupState());
  ipcMain.handle('startup:set', (_e, request: unknown) => {
    const parsed = parseStartupRequest(request);
    if (parsed) applyStartup(parsed.openAtLogin, parsed.minimized);
    return startupState();
  });
  ipcMain.on('whatsnew:dismiss', () => writeLastSeen(app.getVersion()));
  // Only our own add-on link may be handed to the operating system (opens Stremio desktop).
  // The "save video with subtitle" button: the user picks the video file they have on this computer.
  ipcMain.handle('video:pick', async (_e, name: unknown) => {
    const episode = typeof name === 'string' ? name.replace(/[\r\n]+/g, ' ').slice(0, 120) : '';
    if (!win) return null;
    const result = await dialog.showOpenDialog(win, {
      title:
        (uiLang === 'he'
          ? 'הסרטון לא נמצא ב-Stremio. בחר את קובץ הסרטון שבמחשב'
          : 'The video was not found in Stremio. Choose the video file on this computer') +
        (episode ? ' - ' + episode : ''),
      properties: ['openFile'],
      filters: [
        { name: 'Video', extensions: ['mkv', 'mp4', 'avi', 'mov', 'm4v', 'webm', 'ts', 'wmv'] },
      ],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  ipcMain.handle('video:save', async (_e, name: unknown, format: unknown) => {
    if (!win) return null;
    const ext = format === 'mp4' ? 'mp4' : 'mkv';
    const stem = (typeof name === 'string' ? name : 'video')
      .replace(/[\\/:*?"<>|\r\n]+/g, ' ')
      .trim()
      .slice(0, 120);
    const result = await dialog.showSaveDialog(win, {
      title: uiLang === 'he' ? 'איפה לשמור את הסרטון?' : 'Where to save the video?',
      defaultPath: join(app.getPath('videos'), `${stem || 'video'}.${ext}`),
      filters: [{ name: 'Video', extensions: [ext] }],
    });
    return result.canceled ? null : (result.filePath ?? null);
  });
  ipcMain.on('app:open-stremio', (_e, url: unknown) => {
    if (typeof url === 'string' && isStremioInstallUrl(url)) void shell.openExternal(url);
  });

  app.whenReady().then(async () => {
    try {
      if (!readLastSeen()) {
        // Upgrading from a build that predates this file (existing data) -> announce; fresh install -> nothing new.
        const userData = app.getPath('userData');
        const upgrading = ['.env', 'settings.json'].some((f) => existsSync(join(userData, f)));
        writeLastSeen(upgrading ? '0.0.0' : app.getVersion());
      }
      running = await startAddon(app.getPath('userData'), {
        onPending: notifyPending,
        onUpgraded: notifyUpgraded,
      });
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
