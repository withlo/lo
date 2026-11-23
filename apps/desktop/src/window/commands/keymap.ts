// The keymap file in the window: what main reads from it goes to the registry, and what is wrong with
// the file as a whole, and whether Lo may open it, wait here for key help and the command.

import { registry } from './registry.ts';

/** What is wrong with the keymap file as a whole, as an error says it. */
export interface KeymapProblem {
  readonly title: string;
  readonly reason?: string | undefined;
  /** What the system said, as it came. */
  readonly details?: string | undefined;
}

/** The keymap file, as the keys feature has it from main, in words. */
export interface KeymapFile {
  readonly text: string;
  /** What is wrong with the file, if anything is. */
  readonly problem?: KeymapProblem | undefined;
  /** Whether Lo will open it in an editor. */
  readonly canOpen: boolean;
  /** Why it can't be opened, when it can't: the reason on the dimmed command. */
  readonly refusal?: string | undefined;
  /** What to do about the refusal, under it where the file's problem shows, as in key help. */
  readonly remedy?: string | undefined;
}

/** What the window knows of the keymap file besides its keys. */
export interface KeymapState {
  readonly problem: KeymapProblem | undefined;
  readonly canOpen: boolean;
  readonly refusal: string | undefined;
  readonly remedy: string | undefined;
}

// Before main has said, there's no problem, and opening the file is allowed: main decides.
let state: KeymapState = {
  problem: undefined,
  canOpen: true,
  refusal: undefined,
  remedy: undefined,
};
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

/** Why the keymap file can't be opened, when main gives no reason. */
const CANT_OPEN = 'The keymap file can’t be opened';

/** `true` if the keymap file can be opened, or why not. */
export function keymapOpenable(): true | string {
  return state.canOpen ? true : (state.refusal ?? CANT_OPEN);
}

/**
 * What key help says is wrong with the keymap file: its problem, or, with no button to open it, why
 * Lo won't, and what to do about that.
 */
export function keymapProblem(): KeymapProblem | undefined {
  if (state.problem !== undefined) return state.problem;
  if (state.canOpen) return undefined;
  return { title: state.refusal ?? CANT_OPEN, reason: state.remedy };
}

/**
 * Applies the keymap file over the default keys, in place of the last one. Its lines that can't be
 * used are the registry's errors, and `keymapState` holds the rest.
 */
export function applyKeymapFile(file: KeymapFile): void {
  state = {
    problem: file.problem,
    canOpen: file.canOpen,
    refusal: file.refusal,
    remedy: file.remedy,
  };
  try {
    registry().setKeymap(file.text);
  } catch (error) {
    // The parser reports bad lines; this is a bug, and the keys stay as they were.
    console.error("Lo couldn't apply the keymap file:", error);
    const details = error instanceof Error ? error.message : String(error);
    state = { ...state, problem: { title: 'Couldn’t apply the keymap file', details } };
  }
  for (const listener of listeners) listener();
}
