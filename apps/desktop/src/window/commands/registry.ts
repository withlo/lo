// The window's registry, and the middle view keys come back to. Features' handlers reach both
// through here, since the registry is built from their commands.

import {
  findScope,
  Registry,
  textKind,
  type Command,
  type Entry,
  type System,
} from '@lo/ui/commands';
import { useSyncExternalStore } from 'react';

import { refuse } from './notices.tsx';

/** The view in the middle of the window, as keys see it. */
export interface Middle {
  /** Takes focus, as `Esc` gives it back. */
  focus(): void;
  /**
   * Whether focus on `element` is where `focus` puts it, so `Esc` there has nowhere to give it
   * back to.
   */
  holds(element: Element): boolean;
  /** Where the tab is in it, for history: the place a jump leaves. */
  here(): Entry | undefined;
  /**
   * What `Esc` closes first, with focus on `focused`: something of its own it has open, such as a
   * note in the diff while focus is in it, as what closes it. With nothing, `Esc` gives focus back
   * to it. Asking closes nothing, so the palette can ask whether `Esc` would do anything.
   */
  escape?(focused: Element | null): (() => void) | undefined;
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
    // The reason alone, never under the command's name.
    // A command with no reason to give, as one only a note offers, does nothing, and says nothing.
    onRefused: (reason) => {
      if (reason !== '') refuse(reason);
    },
  });
  current = created;
  return current;
}

/** The window's registry. */
export function registry(): Registry {
  if (!current) throw new Error('The window’s registry isn’t built yet.');
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
  if (escapeInMiddle()) return;
  focusMiddle();
}

/**
 * `Esc` in the middle view, for a command that does something of its own with `Esc` there once
 * nothing nearer takes it: the middle view closes something of its own it has open, if it has, and
 * says whether it did.
 */
export function escapeInMiddle(): boolean {
  const close = middle()?.escape?.(document.activeElement);
  close?.();
  return close !== undefined;
}

/**
 * Whether `Esc` with focus on `focused` would do anything: close something the middle view has
 * open, or give focus back to it. With focus already where the view puts it, and nothing open,
 * it has nowhere to go.
 */
export function canEscape(focused: Element | null): boolean {
  const view = middle();
  if (!view) return !(focused?.hasAttribute('data-lo-middle') ?? false);
  if (view.escape?.(focused) !== undefined) return true;
  return focused === null || !view.holds(focused);
}

/**
 * Whether `element` is the text of a code view whose scope is called `scope`: where the view's
 * `focus` puts focus, and its keys go.
 */
export function inCodeOf(element: Element, scope: string): boolean {
  return findScope(element).name === scope && textKind(element) === 'editable';
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
