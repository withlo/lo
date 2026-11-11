// The window's only way to main: `window.perf`, which fetches the pull request, connects the page
// to the background process, loads a large file and copies a link. Electron's MessagePort reaches
// the page through `window.postMessage`, since the bridge can't pass one.

import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('perf', {
  pull: (): Promise<unknown> => ipcRenderer.invoke('perf:pull'),
  load: (file: number): Promise<unknown> => ipcRenderer.invoke('perf:load', file),
  copy: (text: string): Promise<unknown> => ipcRenderer.invoke('perf:copy', text),
  connect: (): void => {
    ipcRenderer.once('perf:port', (event) => window.postMessage('perf:port', '*', event.ports));
    ipcRenderer.send('perf:connect');
  },
});
