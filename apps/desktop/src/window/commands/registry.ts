// The window's registry, and the middle view keys come back to. Features' handlers reach both
// through here, since the registry is built from their commands.

import { Registry, type Command, type Entry, type System } from '@lo/ui/commands';
import { useSyncExternalStore } from 'react';

import { notify } from './notices.tsx';

/** The view in the middle of the window, as keys see it. */
export interface Middle {
  /** Takes focus, as `Esc` gives it back. */
  focus(): void;
  /** Where the tab is in it, for history: the place a jump leaves. */
  here(): Entry | undefined;
  /**
   * `Esc` comes to it first: it closes something of its own it has open, such as a note in the
   * diff, while focus is in it, and says whether it did. Otherwise `Esc` gives focus back to it.
   */
  escape?(): boolean;
}

let current: Registry | undefined;
/** The views that are the middle of the window, the newest on top: a cover over a tab's own. */
const middles: Middle[] = [];

/** The middle view now: the newest one still there. */
function middle(): Middle | undefined {
  return middles.at(-1);
}

/** Builds the window's registry from every feature's commands. */
export function createRegistry(commands: readonly Command[], system: System): Registry {
  const created: Registry = new Registry({
    system,
    commands,
    here: () => middle()?.here(),
    // A command asked for that can't run says why, whoever asked: a key, a menu or the palette.
    onRefused: (reason, id) => notify(created.command(id)?.label ?? 'Not now', reason),
  });
  current = created;
  return current;
}

/** The window's registry. */
export function registry(): Registry {
  if (!current) throw new Error("The window's registry isn't built yet.");
  return current;
}

let version = 0;

/** Re-renders when the registry's keys change, as the keymap file does. */
export function useKeys(): number {
  return useSyncExternalStore(
    (listener) =>
      registry().subscribe(() => {
        version++;
        listener();
      }),
    () => version,
  );
}

/**
 * Makes `view` the middle view. Returns a function that takes it back, for when the view goes: the
 * one it covered, if it's still there, is the middle again.
 */
export function setMiddle(view: Middle): () => void {
  middles.push(view);
  return () => {
    const at = middles.lastIndexOf(view);
    if (at >= 0) middles.splice(at, 1);
  };
}

/**
 * `Esc`: the middle view closes something of its own it has open, if it has; otherwise focus goes
 * back to it.
 */
export function escapeToMiddle(): void {
  if (middle()?.escape?.()) return;
  focusMiddle();
}

/** Gives focus back to the middle view, or the middle of the window while there's none. */
export function focusMiddle(): void {
  const view = middle();
  if (view) {
    view.focus();
    return;
  }
  const element = document.querySelector('[data-lo-middle]');
  if (element instanceof HTMLElement) element.focus();
}

/** Where the tab is in the middle view, if it has a place. */
export function here(): Entry | undefined {
  return middle()?.here();
}

/** The system the window runs on, from `navigator.platform`. */
export function systemOf(platform: string): System {
  return platform.startsWith('Mac') ? 'mac' : 'linux';
}
