// The window's only way to main: `window.lo`, with `invoke` and `subscribe` and nothing else, the
// port to the background process, and the code port to main. The page can't reach Electron or
// Node through them: names are checked before anything is sent, and a listener gets only the
// pushed value, never Electron's event.

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

import type { Bridge } from '../ipc/bridge.ts';
import { channelName, isResult, type Result } from '../ipc/contract.ts';
import { codeHandOver, handOver, isCodeHandOver, isHandOver } from '../ipc/jobs.ts';
import { REDUCE_MOTION } from '../ipc/motion.ts';

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

// Every move off from the first frame, when main asks, as it does for tests: the motion switch
// that the stylesheet and `setMotion` in `@lo/ui` read, set on `<html>` before the page's own code
// runs. The page's script is a module, which runs once the document is parsed, so the switch is
// there by then even when `<html>` isn't yet.
function reduceMotion(): void {
  document.documentElement.setAttribute('data-lo-motion', 'reduce');
}
if (process.argv.includes(REDUCE_MOTION)) {
  const root: HTMLElement | null = document.documentElement;
  if (root) reduceMotion();
  else document.addEventListener('readystatechange', reduceMotion, { once: true });
}

// News of the background process from main: a port to it, sent each time the page loads and after
// each restart, or word that it stopped. A MessagePort can't cross the bridge, so it all goes to
// the page as a window message.
ipcRenderer.on(handOver, (event, message: unknown) => {
  if (isHandOver(message)) window.postMessage(message, window.location.origin, event.ports);
});

// The code port, a port of main's own for what code features ask of it, sent each time the page
// loads. It goes to the page as the background's does.
ipcRenderer.on(codeHandOver, (event, message: unknown) => {
  if (isCodeHandOver(message)) window.postMessage(message, window.location.origin, event.ports);
});
