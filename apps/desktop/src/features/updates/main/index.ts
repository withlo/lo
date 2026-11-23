// The updates feature in main: whether this copy of Lo checks for updates, decided as it starts, and
// how it takes one, decided then and again before it moves itself or downloads one; electron-updater,
// set up as Lo uses it; the checks Lo makes by itself, once
// its window is up and while `updates.check` is on; and the window's requests. Restarting into an
// update quits Lo as any quit does, through Lo's own stop, and only then hands over to Squirrel.Mac.

import { accessSync, constants, existsSync } from 'node:fs';

import { app, autoUpdater } from 'electron';

import { IpcError } from '../../../ipc/contract.ts';
import { defineFeature } from '../../../main/features.ts';
import { asking } from '../../ask/service.ts';
import { settings } from '../../settings/service.ts';
import { checkAnswer, contract, how as howSchema, updateState } from '../contract.ts';
import { check as checkSetting } from '../settings.ts';
import { feedFor } from './feed.ts';
import { howItUpdates, howItUpdatesNow, type Place } from './how.ts';
import { moveAsking, REPLACE } from './move.ts';
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

export default defineFeature(contract, {
  uses: [settings, asking],
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
    move: (_input, _context, { windowId }) => running().move(windowId),
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
      // Asking in Lo's own dialog, in the window that asked, before it replaces a Lo there.
      move: (window) =>
        moveAsking(
          (conflict) => app.moveToApplicationsFolder({ conflictHandler: conflict }),
          () => context.use(asking).ask(window, REPLACE),
        ),
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
