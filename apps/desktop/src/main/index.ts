// Lo's main process: it starts the app, owns the window and decides what the window may do.

import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, type BrowserWindow, dialog, session, type Session } from 'electron';

import { refusedArguments, refusedEnvironment } from './arguments.ts';
import { startBackground, type Background } from './background.ts';
import { openDatabase, type Database } from './database.ts';
import { appName, backgroundSettings, dataFolder, devServer } from './environment.ts';
import { loadFeatures, type Feature } from './features.ts';
import { cacheFolder, createGit, curlProxy, GitStopped, gitSettings, onceUp } from './git.ts';
import { serveFeatures } from './ipc.ts';
import { incomingLinks, linksIn } from './links.ts';
import { migrate } from './migrations.ts';
import { windowPartition, windowUrl } from './policy.ts';
import { registerScheme, secureContents, secureSession } from './security.ts';
import { findServices } from './services.ts';
import { StartupError } from './startup.ts';
import { openWindow } from './window.ts';

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

// A packaged Lo takes no command-line arguments but links, nor the variables that do what some
// switches do. It quits first of all, before `ready`, so no port has opened, no connection has
// been made and nothing has started.
const refused = refusedArguments({
  packaged: app.isPackaged,
  argv: process.argv.slice(1),
  hasSwitch: (name) => app.commandLine.hasSwitch(name),
});
if (refused.length > 0) {
  console.error(
    `Lo takes no command-line arguments but links, so it quit. Refused: ${refused.map((each) => JSON.stringify(each)).join(' ')}`,
  );
  app.exit(1);
}
const refusedVariables = refusedEnvironment({ packaged: app.isPackaged, env: process.env });
if (refusedVariables.length > 0) {
  console.error(
    `Lo won't start with these set in its environment, which would write out or expose its traffic to GitHub, so it quit: ${refusedVariables.join(' ')}`,
  );
  app.exit(1);
}

// Everything up to the lock runs before `ready`, as Electron requires.
app.enableSandbox();
registerScheme();
// Before `ready`, which is when `safeStorage` takes the name for its key in the keychain.
const name = appName({ packaged: app.isPackaged });
if (name) app.setName(name);

const env = process.env;
const folder = dataFolder({ packaged: app.isPackaged, appData: app.getPath('appData'), env });
if (folder) app.setPath('userData', folder);
const dev = devServer({ packaged: app.isPackaged, env });
const backgroundOptions = backgroundSettings({
  packaged: app.isPackaged,
  env,
  warn: (message) => console.warn(message),
});
const gitOptions = gitSettings({ packaged: app.isPackaged, env });
const cacheRoot = cacheFolder({
  packaged: app.isPackaged,
  platform: process.platform,
  home: app.getPath('home'),
  env,
});

// One Lo per data folder. A second launch hands its command line over to the first and quits; one
// that refused its command line, and is quitting, hands over nothing.
const refusing = refused.length > 0 || refusedVariables.length > 0;
if (!refusing) {
  if (app.requestSingleInstanceLock()) {
    // Links it was started with, as the `lo` command starts it, open once the features are up.
    for (const link of linksIn(process.argv.slice(1))) incomingLinks.receive(link);
    start();
  } else {
    app.quit();
  }
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
    // The route Lo's own requests take: `net.request`'s, in the default session.
    proxy: async (address) => curlProxy(await session.defaultSession.resolveProxy(address)),
    log: (line) => console.error(`git: ${line}`),
  });
  let quitting: Promise<void> | undefined;
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
  // A link from another app, by the system (`lo://`, or a web link a link router sends Lo), or as
  // the argument a second launch hands over. Each is untrusted, and read as a typed link is.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    incomingLinks.receive(url);
    if (app.isReady()) show();
  });
  app.on('second-instance', (_event, argv) => {
    for (const link of linksIn(argv.slice(1))) incomingLinks.receive(link);
    show();
  });
  app.on('activate', show);
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
  /**
   * Stops what Lo runs, in order: its features, while the database is open, each within its own
   * time limit; then the database and the background process; then every git, so none is left
   * running.
   */
  const stop = async (): Promise<void> => {
    await stopFeatures?.();
    database?.close();
    background?.stop();
    await git.stop();
  };
  // Lo quits once everything has stopped. Asked to quit again meanwhile, it waits for the same.
  app.on('will-quit', (event) => {
    if (stopped) return;
    event.preventDefault();
    quitting ??= stop()
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
      const secured = session.fromPartition(windowPartition);
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
