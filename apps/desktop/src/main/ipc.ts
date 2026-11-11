import { BrowserWindow, ipcMain } from 'electron';

import type { Database } from './database.ts';
import { createRouter, type Feature } from './features.ts';
import type { LocalGit } from './git.ts';
import { isAppPage } from './policy.ts';
import type { Service } from './services.ts';

/**
 * Answers each feature's requests over Electron's IPC, and runs each feature's `provide`, then
 * each one's `start`. A request reaches its handler only from Lo's own page and only once its
 * input matches the contract. Pushes go to every window. Returns what stops the features, as Lo
 * quits.
 */
export function serveFeatures(
  features: readonly Feature[],
  services: readonly Service<unknown>[],
  database: Database,
  git: LocalGit,
  dev?: URL,
): () => Promise<void> {
  const router = createRouter(features, {
    database,
    git,
    services,
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
  return () => router.stop();
}
