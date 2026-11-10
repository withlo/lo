// The window's only way to main: `window.lo`, with `invoke` and `subscribe` and nothing else. The
// page can't reach Electron or Node through it: names are checked before anything is sent, and
// a listener gets only the pushed value, never Electron's event.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { Bridge } from '../ipc/bridge.ts';
import { channelName, isResult, type Result } from '../ipc/contract.ts';

const unavailable = (channel: unknown): Result<never> => ({
  ok: false,
  error: {
    code: 'unavailable',
    message: `There's no request named ${typeof channel === 'string' ? channel : 'like that'}.`,
  },
});

const bridge: Bridge = {
  async invoke(channel, input) {
    if (typeof channel !== 'string' || !channelName.test(channel)) return unavailable(channel);
    try {
      const reply: unknown = await ipcRenderer.invoke(channel, input);
      return isResult(reply) ? reply : unavailable(channel);
    } catch {
      // Electron rejects when no handler has the name. Its message isn't the page's business.
      return unavailable(channel);
    }
  },

  subscribe(topic, listener) {
    if (typeof topic !== 'string' || !channelName.test(topic)) {
      throw new TypeError(
        `There's no topic named ${typeof topic === 'string' ? topic : 'like that'}.`,
      );
    }
    if (typeof listener !== 'function') throw new TypeError('A subscription needs a listener.');
    const forward = (_event: IpcRendererEvent, value: unknown) => listener(value);
    ipcRenderer.on(topic, forward);
    return () => {
      ipcRenderer.removeListener(topic, forward);
    };
  },
};

contextBridge.exposeInMainWorld('lo', bridge);
