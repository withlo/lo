// What the open feature shares with other features' window code: the open box, opening a link as
// the box does, and the `lo` command, for the welcome screen's box and its row for the command;
// and opening a web link another view follows.

import { useStore } from 'zustand';

import type { CommandState, Installed, Opened } from '../contract.ts';
import { followLink as follow } from './actions.ts';
import { openBox as openTheBox, openText } from './box.ts';
import { checkCommand, commandStore, installCommand as install } from './command.ts';

export type { CommandState, Installed, Opened } from '../contract.ts';

/** Opens the open box, with `text` in it, or else the pull request link on the clipboard, if any. */
export function openBox(text?: string): void {
  openTheBox(text);
}

/**
 * Opens `text` as the box does: a pull request in its tab, read only without signing in when it's
 * public and no account can see it; any other web link in the browser. Resolves with what it did,
 * or nothing when main couldn't be asked.
 */
export function openLink(text: string): Promise<Opened | undefined> {
  return openText(text);
}

/**
 * Opens `url`, an `https` link followed in another view, such as a link in an overview: a pull
 * request in its tab, any other page in the browser. Says why in a notice when it opens nothing.
 * The open box is left as it is.
 */
export function followLink(url: string): Promise<void> {
  return follow(url);
}

/** Where the `lo` command is, once Lo has looked, re-rendering when that changes. */
export function useCommand(): CommandState | undefined {
  return useStore(commandStore, (state) => state.state);
}

/** Looks again for where the `lo` command is. */
export function findCommand(): Promise<void> {
  return checkCommand();
}

/** Installs the `lo` command, and says how it went in a notice. */
export function installCommand(): Promise<Installed | undefined> {
  return install();
}
