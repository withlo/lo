// Lo's main process: it starts the app, owns the window and decides what the window may do.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, dialog, session, type Session } from 'electron';

import { startBackground, type Background } from './background.ts';
import { openDatabase, type Database } from './database.ts';
import { backgroundSettings, dataFolder, devServer } from './environment.ts';
import { loadFeatures, type Feature } from './features.ts';
import { cacheFolder, createGit, curlProxy, GitStopped, gitSettings, onceUp } from './git.ts';
import { serveFeatures } from './ipc.ts';
import { migrate } from './migrations.ts';
import { windowUrl } from './policy.ts';
import { registerScheme, secureContents, secureSession } from './security.ts';
import { findServices } from './services.ts';
import { StartupError } from './startup.ts';
import { openWindow } from './window.ts';

/**
 * How long Lo waits for its features to stop as it quits, in milliseconds, before it closes the
 * database and quits all the same, so one that never finishes can't keep Lo open.
 */
const STOP_FEATURES_MS = 10_000;

/** The window's build output, next to this file's. */
const windowFiles = fileURLToPath(new URL('../window', import.meta.url));

// Every feature folder with a main side, every service features define, and every feature's
// migrations. No file lists them.
const features = loadFeatures(
  import.meta.glob<Feature>('../features/*/main/index.ts', { eager: true, import: 'default' }),
);
const services = findServices(
  import.meta.glob<Record<string, unknown>>('../features/*/service.ts', { eager: true }),
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
  let database: Database | undefined;
  let stopFeatures: (() => Promise<void>) | undefined;
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
  let stopped = false;

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
  /**
   * Stops what Lo runs, in order: its features, the last to start first, while the database is
   * open; then the database and the background process; then every git, so none is left running.
   */
  const stop = async (): Promise<void> => {
    if (stopFeatures) {
      const waited = new Promise<void>((resolve) => setTimeout(resolve, STOP_FEATURES_MS).unref());
      await Promise.race([stopFeatures(), waited]);
    }
    database?.close();
    background?.stop();
    await git.stop();
  };
  // Lo quits once everything has stopped.
  app.on('will-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    void stop()
      .catch((error: unknown) => console.error("Lo couldn't stop cleanly:", error))
      .finally(() => {
        stopped = true;
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
      const opened = openDatabase(join(app.getPath('userData'), 'lo.db'));
      database = opened;
      migrate(opened, migrations);
      stopFeatures = serveFeatures(features, services, opened, git, dev);
      background = startBackground(backgroundOptions);
      windowSession = secured;
      // Once the window is up, Lo looks for git, then opens its cache and cleans it up: none of
      // it holds the window up. A window that never says it's up holds the look back no more
      // than a few seconds.
      const shown = show();
      onceUp(
        (up) => shown?.once('ready-to-show', up),
        () => {
          git.check().catch((error: unknown) => {
            // Lo quit while it looked.
            if (!(error instanceof GitStopped)) console.error("Lo couldn't look for git:", error);
          });
        },
      );
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
