/** Preload for the sandboxed window: exposes only minimize, maximize/restore, hide-to-tray and quit. */
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  minimize: () => ipcRenderer.send('window:minimize'),
  toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
  onMaximizeChange: (cb: (maximized: boolean) => void) =>
    ipcRenderer.on('window:maximized', (_e, maximized: boolean) => cb(maximized)),
  hide: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('window:quit'),
});
