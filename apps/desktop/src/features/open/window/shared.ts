// What the open feature shares with other features' window code: the open box, opening a link as
// the box does, and the `lo` command, for the welcome screen's box and its row for the command; and
// the slot for other command-line tools' rows in Settings.

import { useStore } from 'zustand';

import { defineSlot } from '../../../window/slots.tsx';
import type { CommandState, Installed, Opened } from '../contract.ts';
import { openBox as openTheBox, openText } from './box.ts';
import { checkCommand, commandStore, installCommand as install } from './command.ts';

export type { CommandState, Installed, Opened } from '../contract.ts';

/**
 * The rows of Settings' Command line section after the `lo` command's, one `Setting` per view, in
 * `order`, lower first: another feature's tool for the command line or for the agents that run
 * there, such as installing a skill for them.
 */
export const commandLine = defineSlot('open.commandLine');

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
