import { app, BrowserWindow, ipcMain } from 'electron';

import type { Database } from './database.ts';
import { createRouter, type Feature } from './features.ts';
import type { LocalGit } from './git.ts';
import { isAppPage } from './policy.ts';
import type { Service } from './services.ts';

/**
 * Answers each feature's requests over Electron's IPC, and runs each feature's `provide`, then
 * each one's `start`. A request reaches its handler only from Lo's own page and only once its
 * input matches the contract, and its handler is told which window asked. Pushes go to every
 * window. Returns what stops the features, as Lo quits.
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
    log: (message, ...error) => console.error(message, ...error),
  });
  const probing = Boolean(process.env.LO_PROBE);
  const probe = (line: string) => {
    if (probing) process.stderr.write(`probe ${Date.now()} main ${line}\n`);
  };
  if (probing) {
    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      if (now - last > 400) probe(`lag ${now - last}ms`);
      last = now;
    }, 200);
    setInterval(() => probe('tick'), 1000);
    app.on('browser-window-focus', () => probe('focus'));
    app.on('browser-window-blur', () => probe('blur'));
  }
  for (const channel of router.channels) {
    ipcMain.handle(channel, async (event, input: unknown) => {
      const from = Date.now();
      const noted = channel.startsWith('merge.');
      if (noted) probe(`recv ${channel}`);
      const reply = await router.answer(channel, event.senderFrame?.url, input, {
        windowId: BrowserWindow.fromWebContents(event.sender)?.id,
      });
      if (noted)
        probe(`reply ${channel} ${Date.now() - from}ms ${JSON.stringify(reply).slice(0, 160)}`);
      return reply;
    });
  }
  router.start();
  return () => router.stop();
}
