// Lo's main process: it starts the app, owns the window and decides what the window may do.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, dialog, session, type Session } from 'electron';

import { startBackground, type Background } from './background.ts';
import { openDatabase } from './database.ts';
import { backgroundSettings, dataFolder, devServer } from './environment.ts';
import { loadFeatures, type Feature } from './features.ts';
import { cacheFolder, createGit, curlProxy, gitSettings } from './git.ts';
import { serveFeatures } from './ipc.ts';
import { migrate } from './migrations.ts';
import { windowUrl } from './policy.ts';
import { registerScheme, secureContents, secureSession } from './security.ts';
import { StartupError } from './startup.ts';
import { openWindow } from './window.ts';

/** The window's build output, next to this file's. */
const windowFiles = fileURLToPath(new URL('../window', import.meta.url));

// Every feature folder with a main side, and every feature's migrations. No file lists them.
const features = loadFeatures(
  import.meta.glob<Feature>('../features/*/main/index.ts', { eager: true, import: 'default' }),
);
const migrations = import.meta.glob<string>('../features/*/migrations/*.sql', {
  eager: true,
  query: '?raw',
  import: 'default',
});

// Everything up to the lock runs before `ready`, as Electron requires.
app.enableSandbox();
registerScheme();

const env = process.env;
const folder = dataFolder({ packaged: app.isPackaged, appData: app.getPath('appData'), env });
if (folder) app.setPath('userData', folder);
const dev = devServer({ packaged: app.isPackaged, env });
const backgroundOptions = backgroundSettings({ packaged: app.isPackaged, env });
const gitOptions = gitSettings({ packaged: app.isPackaged, env });
const cacheRoot = cacheFolder({
  packaged: app.isPackaged,
  platform: process.platform,
  home: app.getPath('home'),
  env,
});

// One Lo per data folder. A second launch hands over to the first and quits.
if (app.requestSingleInstanceLock()) {
  start();
} else {
  app.quit();
}

function start(): void {
  let windowSession: Session | undefined;
  let background: Background | undefined;
  let window: BrowserWindow | undefined;
  // Only main runs git. It looks for git once the window is up, and stops every git as Lo quits.
  const git = createGit({
    settings: gitOptions,
    root: cacheRoot,
    env,
    platform: process.platform,
    // The route Lo's own requests take: `net.fetch`'s, in the default session.
    proxy: async (address) => curlProxy(await session.defaultSession.resolveProxy(address)),
    log: (line) => console.error(`git: ${line}`),
  });
  let gitStopped = false;

  /** Shows the window, opening it if it's closed. Nothing opens until its session is secured. */
  const show = (): BrowserWindow | undefined => {
    if (!windowSession) return undefined;
    if (!window) {
      window = openWindow(windowSession, dev?.href ?? windowUrl);
      background?.attach(window.webContents);
      window.once('closed', () => (window = undefined));
    }
    if (window.isMinimized()) window.restore();
    window.focus();
    return window;
  };

  app.on('web-contents-created', (_event, contents) => secureContents(contents, dev));
  app.on('second-instance', show);
  app.on('activate', show);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  // Lo quits once every git has stopped, so none is left running.
  app.on('will-quit', (event) => {
    if (gitStopped) return;
    event.preventDefault();
    void git.stop().finally(() => {
      gitStopped = true;
      // Not from inside this event: Electron ignores a quit asked for while it handles one.
      setImmediate(() => app.quit());
    });
  });

  app
    .whenReady()
    .then(async () => {
      // The window gets a session of its own, so its restrictions never reach requests main
      // makes for itself.
      const secured = session.fromPartition('persist:window');
      await secureSession(secured, windowFiles, dev);
      // Every feature's tables are ready before any of its handlers can be asked anything.
      const database = openDatabase(join(app.getPath('userData'), 'lo.db'));
      migrate(database, migrations);
      app.once('will-quit', () => database.close());
      serveFeatures(features, database, git, dev);
      background = startBackground(backgroundOptions);
      app.once('will-quit', () => background?.stop());
      windowSession = secured;
      // Once the window is up, Lo looks for git, then opens its cache and cleans it up: none of
      // it holds the window up.
      show()?.once('ready-to-show', () => {
        git.check().catch((error: unknown) => console.error("Lo couldn't look for git:", error));
      });
    })
    .catch((error: unknown) => {
      if (error instanceof StartupError) {
        console.error(`Lo couldn't start. ${error.message}`);
        // Someone who opened Lo from the Dock or a menu sees no terminal.
        if (app.isPackaged) dialog.showErrorBox("Lo couldn't start", error.message);
      } else {
        console.error("Lo couldn't start:", error);
      }
      app.exit(1);
    });
}
