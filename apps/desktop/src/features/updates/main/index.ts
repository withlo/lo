// The updates feature in main: whether this copy of Lo checks for updates, decided as it starts, and
// how it takes one, decided then and again before it moves itself or downloads one; electron-updater,
// set up as Lo uses it; the checks Lo makes by itself, once
// its window is up and while `updates.check` is on; and the window's requests. Restarting into an
// update quits Lo as any quit does, through Lo's own stop, and only then hands over to Squirrel.Mac.

import { accessSync, constants, existsSync } from 'node:fs';

import { app, autoUpdater, BrowserWindow, dialog, type MessageBoxSyncOptions } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature } from '../../../main/features.ts';
import { settings } from '../../settings/service.ts';
import { checkAnswer, contract, how as howSchema, updateState } from '../contract.ts';
import { check as checkSetting } from '../settings.ts';
import { feedFor } from './feed.ts';
import { howItUpdates, howItUpdatesNow, type Place } from './how.ts';
import { FIRST_CHECK, FIRST_LOCAL_CHECK, Schedule } from './schedule.ts';
import { adapt, CheckingUpdater, configure, InstallingUpdater, type Squirrel } from './updater.ts';
import { Updates, type UpdatesOptions } from './updates.ts';

const log = (line: string) => console.error(`updates: ${line}`);

let updates: Updates | undefined;
let schedule: Schedule | undefined;
const stops: (() => void)[] = [];

/** Where updates stand, once the feature has started. */
function running(): Updates {
  if (!updates) throw new IpcError('unavailable', 'Lo hasn’t started checking for updates yet.');
  return updates;
}

/** Whether Lo may write `path`. */
function writable(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** Squirrel.Mac, through Electron's own updater, which electron-updater hands a download to. */
const squirrel: Squirrel = {
  listen(ready, failed) {
    autoUpdater.once('update-downloaded', ready);
    autoUpdater.once('error', failed);
    return () => {
      autoUpdater.off('update-downloaded', ready);
      autoUpdater.off('error', failed);
    };
  },
};

/** The question Lo asks before it replaces a Lo already in Applications. "Cancel" is the default. */
const REPLACE: MessageBoxSyncOptions = {
  type: 'question',
  message: 'Replace Lo in Applications?',
  detail: 'The copy in Applications moves to the Trash. This one takes its place and restarts.',
  buttons: ['Replace Lo', 'Cancel'],
  defaultId: 1,
  cancelId: 1,
  noLink: true,
};

/**
 * Moves Lo to Applications, asking first when a Lo is there already, and, once it's moved, starts
 * it from there and quits this one: `false` when told not to. When the Lo there is running, it
 * comes forward and this one quits, as Electron does by default.
 */
function moveToApplications(): boolean {
  return app.moveToApplicationsFolder({
    conflictHandler(conflict) {
      if (conflict === 'existsAndRunning') return true;
      const window = BrowserWindow.getFocusedWindow();
      const answer = window
        ? dialog.showMessageBoxSync(window, REPLACE)
        : dialog.showMessageBoxSync(REPLACE);
      return answer === 0;
    },
  });
}

export default defineFeature(contract, {
  uses: [settings],
  handlers: {
    // Checked as a push is, so the window gets nothing but what the contract says.
    read: () => updateState.parse(running().state),
    how: () => howSchema.parse(running().howNow()),
    async check() {
      schedule?.checked();
      return checkAnswer.parse(await running().check(true));
    },
    install: () => running().install(),
    restart: () => running().restart(),
    later: () => running().later(),
    move: () => running().move(),
  },
  start(context) {
    const packaged = app.isPackaged;
    const found = feedFor({
      packaged,
      resources: process.resourcesPath,
      exists: existsSync,
      env: process.env,
    });
    const place: Place = {
      platform: process.platform,
      packaged,
      executable: process.execPath,
      home: app.getPath('home'),
      exists: existsSync,
      writable,
    };
    // As Lo starts, which decides the updater; Lo decides again before it moves or downloads.
    const how = howItUpdates(place);
    const installs = how === 'install';
    let updater: UpdatesOptions['updater'];
    if ('feed' in found) {
      const electronUpdater = installs ? new InstallingUpdater() : new CheckingUpdater();
      configure(electronUpdater, { feed: found.feed, installs, log });
      updater = adapt(electronUpdater, installs ? squirrel : undefined);
    } else {
      updater = found;
    }
    const started = new Updates({
      current: app.getVersion(),
      how: () => howItUpdatesNow(place, how),
      updater,
      publish: (state) => context.publish('state', state),
      log,
      quit: () => app.quit(),
      move: moveToApplications,
    });
    updates = started;
    // Never taken off: the last `will-quit`, after the feature has stopped, is the one a restart
    // into an update waits for. Lo's own listener was added before any feature started.
    app.on('will-quit', (event) => started.willQuit(event));
    if (!('feed' in found)) return;
    const timed = new Schedule(
      () => {
        started.check(false).catch((error: unknown) => {
          log(`couldn't check for updates: ${String(error)}`);
        });
      },
      found.feed.host === undefined ? FIRST_CHECK : FIRST_LOCAL_CHECK,
    );
    schedule = timed;
    // Lo's window, which opens once every feature has started.
    app.once('browser-window-created', (_event, window) => {
      window.once('ready-to-show', () => timed.up());
    });
    stops.push(context.use(settings).watch(checkSetting, (on) => timed.timed(on)));
  },
  stop() {
    for (const stop of stops.splice(0)) stop();
    schedule?.stop();
    updates?.stop();
  },
});
