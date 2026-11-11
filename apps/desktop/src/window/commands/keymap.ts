// The keymap file in the window: what main reads from it goes to the registry, and what is wrong with
// the file as a whole, and whether Lo may open it, wait here for key help and the command.

import { registry } from './registry.ts';

/** The keymap file, as main sends it. */
export interface KeymapFile {
  readonly text: string;
  /** What is wrong with the file, if anything is. */
  readonly problem?: string | undefined;
  /** Whether Lo will open it in an editor. */
  readonly canOpen: boolean;
}

/** What the window knows of the keymap file besides its keys. */
export interface KeymapState {
  readonly problem: string | undefined;
  readonly canOpen: boolean;
}

// Before main has said, there's no problem, and opening the file is allowed: main decides.
let state: KeymapState = { problem: undefined, canOpen: true };
const listeners = new Set<() => void>();

/** Calls `listener` when `keymapState` changes. Returns a function that stops it. */
export function subscribeKeymap(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What is wrong with the keymap file as a whole, and whether it can be opened. */
export function keymapState(): KeymapState {
  return state;
}

/** `true` if the keymap file can be opened, or why not. */
export function keymapOpenable(): true | string {
  return state.canOpen ? true : (state.problem ?? "Lo won't open the keymap file.");
}

/**
 * Applies the keymap file over the default keys, in place of the last one. Its lines that can't be
 * used are the registry's errors, and `keymapState` holds the rest.
 */
export function applyKeymapFile(file: KeymapFile): void {
  state = { problem: file.problem, canOpen: file.canOpen };
  try {
    registry().setKeymap(file.text);
  } catch (error) {
    // The parser reports bad lines; this is a bug, and the keys stay as they were.
    console.error("Lo couldn't apply the keymap file:", error);
    state = { problem: "Lo couldn't apply the keymap file.", canOpen: file.canOpen };
  }
  for (const listener of listeners) listener();
}
