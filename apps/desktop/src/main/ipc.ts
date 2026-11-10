import { BrowserWindow, ipcMain } from 'electron';

import { createRouter, type Feature } from './features.ts';
import { isAppPage } from './policy.ts';

/**
 * Answers each feature's requests over Electron's IPC, and runs each feature's `start`. A request
 * reaches its handler only from Lo's own page and only once its input matches the contract.
 * Pushes go to every window.
 */
export function serveFeatures(features: readonly Feature[], dev?: URL): void {
  const router = createRouter(features, {
    isAllowedSender: (address) => isAppPage(address, dev),
    send(channel, value) {
      for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel, value);
    },
    log: (message, error) => console.error(message, error),
  });
  for (const channel of router.channels) {
    ipcMain.handle(channel, (event, input: unknown) =>
      router.answer(channel, event.senderFrame?.url, input),
    );
  }
  router.start();
}
