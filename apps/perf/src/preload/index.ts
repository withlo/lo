// The window's only way to main: `window.perf`, which fetches the pull request and connects the
// page to the background process. Electron's MessagePort reaches the page through
// `window.postMessage`, since the bridge can't pass one.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('perf', {
  pull: (): Promise<unknown> => ipcRenderer.invoke('perf:pull'),
  connect: (): void => {
    ipcRenderer.once('perf:port', (event) => window.postMessage('perf:port', '*', event.ports));
    ipcRenderer.send('perf:connect');
  },
});
