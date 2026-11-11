// The keymap file in the window: what main reads from it goes to the registry, and what went wrong
// with the file as a whole waits here for key help to show, beside the registry's errors by line.

import { registry } from './registry.ts';

/** The keymap file, as main sends it. */
export interface KeymapFile {
  readonly text: string;
  /** Why main couldn't read it, if it couldn't. */
  readonly problem?: string | undefined;
}

let unreadable: string | undefined;
let unopened: string | undefined;
const listeners = new Set<() => void>();

function changed(): void {
  for (const listener of listeners) listener();
}

/** Calls `listener` when `keymapProblem` may have changed. Returns a function that stops it. */
export function subscribeProblem(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** What's wrong with the keymap file as a whole, for key help to show, if anything is. */
export function keymapProblem(): string | undefined {
  return unreadable ?? unopened;
}

/**
 * Applies the keymap file over the default keys, in place of the last one. Its lines that can't be
 * used are the registry's errors, and the file itself being unusable is `keymapProblem`.
 */
export function applyKeymapFile(file: KeymapFile): void {
  unreadable = file.problem;
  try {
    registry().setKeymap(file.text);
  } catch (error) {
    // The parser reports bad lines; this is a bug, and the keys stay as they were.
    console.error("Lo couldn't apply the keymap file:", error);
    unreadable = "Lo couldn't apply the keymap file.";
  }
  changed();
}

/** Says why the keymap file couldn't be opened, or clears the message after one that could. */
export function setOpenProblem(message: string | undefined): void {
  unopened = message;
  changed();
}
