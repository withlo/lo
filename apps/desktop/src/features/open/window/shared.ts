// What the open feature shares with other features' window code: the open box, opening a link as
// the box does, and the `lo` command, for the welcome screen's box and its row for the command;
// and opening a web link another view follows.

import { createElement, type ReactNode } from 'react';
import { useStore } from 'zustand';

import type { CommandState, Installed } from '../contract.ts';
import { followLink as follow } from './actions.ts';
import { openBox as openTheBox, openText, type OpenedHere } from './box.ts';
import { checkCommand, commandStore, installCommand as install } from './command.ts';
import { InstallResult as Result } from './InstallResult.tsx';
import { NotPullNote } from './Note.tsx';
import { isNotPull } from './words.ts';

export type { CommandState, Installed } from '../contract.ts';
export type { OpenedHere as Opened } from './box.ts';

/** Opens the open box, with `text` in it, or else the pull request link on the clipboard, if any. */
export function openBox(text?: string): void {
  openTheBox(text);
}

/**
 * Opens `text` as the box does: a pull request in its tab, read only without signing in when it's
 * public and no account can see it; any other web link in the browser. Resolves with what it did,
 * a refusal with its reason in words, or nothing when main couldn't be asked.
 */
export function openLink(text: string): Promise<OpenedHere | undefined> {
  return openText(text);
}

/**
 * Whether a refusal is that the text isn't a pull request link, which a field says as the open box
 * does, with {@link NotPullNote}.
 */
export { isNotPull };

/**
 * The open box's note for text that isn't a pull request link: a warning, with what one looks
 * like. `id` is for the field it describes.
 */
export { NotPullNote };

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

/**
 * Whether the `lo` command is being installed, and what the last install a row asked for did:
 * `undefined` when main couldn't be asked, and `null` when there's nothing for a row to show.
 */
export function useCommandInstall(): {
  installing: boolean;
  done: Installed | null | undefined;
} {
  const installing = useStore(commandStore, (state) => state.installing);
  const done = useStore(commandStore, (state) => state.done);
  return { installing, done };
}

/** Looks again for where the `lo` command is. */
export function findCommand(): Promise<void> {
  return checkCommand();
}

/**
 * Installs the `lo` command, and says how it went once: in a notice, or, from a row (`row`), on
 * the row, which reads it with `useCommandInstall`.
 */
export function installCommand(from?: 'command' | 'row'): Promise<Installed | undefined> {
  return install(from);
}

/**
 * What the last install a row asked for left to say under that row, from `useCommandInstall`'s
 * `done`: the folder to add to `PATH`, or why it failed, with a way to try again.
 */
export function InstallResult(props: { done: Installed | undefined }): ReactNode {
  return createElement(Result, props);
}
