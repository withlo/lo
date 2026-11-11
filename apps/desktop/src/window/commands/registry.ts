// The window's registry, and the middle view keys come back to. Features' handlers reach both
// through here, since the registry is built from their commands.

import { Registry, type Command, type Entry, type System } from '@lo/ui/commands';
import { useSyncExternalStore } from 'react';

/** The view in the middle of the window, as keys see it. */
export interface Middle {
  /** Takes focus, as `Esc` gives it back. */
  focus(): void;
  /** Where the tab is in it, for history: the place a jump leaves. */
  here(): Entry | undefined;
}

let current: Registry | undefined;
let middle: Middle | undefined;

/** Builds the window's registry from every feature's commands. */
export function createRegistry(commands: readonly Command[], system: System): Registry {
  current = new Registry({ system, commands, here: () => middle?.here() });
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

/** Makes `view` the middle view. Returns a function that takes it back, for when the view goes. */
export function setMiddle(view: Middle): () => void {
  middle = view;
  return () => {
    if (middle === view) middle = undefined;
  };
}

/** Gives focus back to the middle view, or the middle of the window while there's none. */
export function focusMiddle(): void {
  if (middle) {
    middle.focus();
    return;
  }
  const element = document.querySelector('[data-lo-middle]');
  if (element instanceof HTMLElement) element.focus();
}

/** Where the tab is in the middle view, if it has a place. */
export function here(): Entry | undefined {
  return middle?.here();
}

/** The system the window runs on, from `navigator.platform`. */
export function systemOf(platform: string): System {
  return platform.startsWith('Mac') ? 'mac' : 'linux';
}
