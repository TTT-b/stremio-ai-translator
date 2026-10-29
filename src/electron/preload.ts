/** Preload for the sandboxed window: exposes only window controls, the Stremio install link, update controls and the What's New popup. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  onMaximizeChange: (cb: (maximized: boolean) => void) =>
    ipcRenderer.on('window:maximized', (_e, maximized: boolean) => cb(maximized)),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
  openStremio: (url: string) => ipcRenderer.send('app:open-stremio', url),
  pickVideo: (name: string): Promise<string | null> => ipcRenderer.invoke('video:pick', name),
  saveVideo: (name: string, format?: 'mkv' | 'mp4'): Promise<string | null> =>
    ipcRenderer.invoke('video:save', name, format),
  version: (): Promise<string> => ipcRenderer.invoke('app:version'),
  updater: {
    state: (): Promise<unknown> => ipcRenderer.invoke('updater:state'),
    check: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
    install: () => ipcRenderer.send('updater:install'),
    onState: (cb: (state: unknown) => void) =>
      ipcRenderer.on('updater:state', (_e, state: unknown) => cb(state)),
  },
  setLanguage: (lang: string) => ipcRenderer.send('app:set-language', lang),
  startup: {
    get: (): Promise<unknown> => ipcRenderer.invoke('startup:get'),
    set: (openAtLogin: boolean, minimized: boolean): Promise<unknown> =>
      ipcRenderer.invoke('startup:set', { openAtLogin, minimized }),
  },
  whatsNew: {
    get: (lang: string): Promise<unknown> => ipcRenderer.invoke('whatsnew:get', lang),
    dismiss: () => ipcRenderer.send('whatsnew:dismiss'),
  },
});
