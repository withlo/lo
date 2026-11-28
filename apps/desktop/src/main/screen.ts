// What the system says of Lo's windows and the screen, as where Lo is for the person at the
// computer (`presence.ts`): whether a window of Lo's has focus, whether one is on screen, shown and
// not minimized, and whether the screen is locked, which only macOS and Windows say. A window
// covered by others counts as on screen: Electron doesn't say when one is.

import type { Presence } from '@lo/github';
import { app, BrowserWindow, powerMonitor } from 'electron';

import { Presences, type Sight } from './presence.ts';

let watching: Presences | undefined;

/** What the system says now, with focus and the lock as the events last said. */
function sightNow(focused: boolean, locked: boolean): Sight {
  const shown = BrowserWindow.getAllWindows().some(
    (window) => !window.isDestroyed() && window.isVisible() && !window.isMinimized(),
  );
  return { focused, shown, locked };
}

/** Starts following the system's word, once `ready` has come. */
function follow(): Presences {
  let focused = BrowserWindow.getFocusedWindow() !== null;
  let locked = false;
  const presences = new Presences(sightNow(focused, locked));
  const look = () => presences.look(sightNow(focused, locked));
  app.on('browser-window-focus', () => {
    focused = true;
    look();
  });
  app.on('browser-window-blur', () => {
    focused = false;
    look();
  });
  app.on('browser-window-created', (_event, window) => {
    window.on('show', look);
    window.on('hide', look);
    window.on('minimize', look);
    window.on('restore', look);
    // Gone once it's closed, which `getAllWindows` says only after this event.
    window.on('closed', () => setImmediate(look));
  });
  powerMonitor.on('lock-screen', () => {
    locked = true;
    look();
  });
  powerMonitor.on('unlock-screen', () => {
    locked = false;
    look();
  });
  return presences;
}

/**
 * Calls `listener` with where Lo is now, then each time that changes, until the returned function
 * is called. Only once `ready` has come, as features start.
 */
export function watchPresence(listener: (presence: Presence) => void): () => void {
  watching ??= follow();
  return watching.watch(listener);
}
