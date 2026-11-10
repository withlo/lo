// Lo's main process: it starts the app, owns the window and decides what the window may do.

import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, session, type Session } from 'electron';

import { dataFolder, devServer } from './environment.ts';
import { windowUrl } from './policy.ts';
import { registerScheme, secureContents, secureSession } from './security.ts';
import { openWindow } from './window.ts';

/** The window's build output, next to this file's. */
const windowFiles = fileURLToPath(new URL('../window', import.meta.url));

// Everything up to the lock runs before `ready`, as Electron requires.
app.enableSandbox();
registerScheme();

const env = process.env;
const folder = dataFolder({ packaged: app.isPackaged, appData: app.getPath('appData'), env });
if (folder) app.setPath('userData', folder);
const dev = devServer({ packaged: app.isPackaged, env });

// One Lo per data folder. A second launch hands over to the first and quits.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}

function start(): void {
  let windowSession: Session | undefined;
  let window: BrowserWindow | undefined;

  /** Shows the window, opening it if it's closed. Nothing opens until its session is secured. */
  const show = () => {
    if (!windowSession) return;
    if (!window) {
      window = openWindow(windowSession, dev?.href ?? windowUrl);
      window.once('closed', () => (window = undefined));
    }
    if (window.isMinimized()) window.restore();
    window.focus();
  };

  app.on('web-contents-created', (_event, contents) => secureContents(contents, dev));
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });

  app
    .whenReady()
    .then(async () => {
      // The window gets a session of its own, so its restrictions never reach requests main
      // makes for itself.
      const secured = session.fromPartition('persist:window');
      await secureSession(secured, windowFiles, dev);
      windowSession = secured;
      show();
    })
    .catch((error: unknown) => {
      console.error("Lo couldn't start:", error);
      app.exit(1);
    });
}
