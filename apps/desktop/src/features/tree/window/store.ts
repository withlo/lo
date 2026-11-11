// Each tab's tree in the window: what main last sent, the folders it sent since, what the reader
// chose, the row the keyboard is on and the file on screen. Each is kept with its tab and goes when
// the tab closes.

import { tabState } from '../../tab/window/shared.ts';
import {
  type Entry,
  type Folder,
  FOLDERS_LIMIT,
  type TreePath,
  type TreeState,
} from '../contract.ts';
import { main } from './main.ts';
import { NO_CHOICES, type Choices, type Model } from './model.ts';
import { keyOf } from './paths.ts';

/** What main last sent of each tab's tree. */
export const states = tabState<TreeState | undefined>(() => undefined);

/** The folders main sent of a tab's tree, by key, for the commit they're of. */
export interface Folders {
  readonly at: string | null;
  readonly entries: ReadonlyMap<string, readonly Entry[]>;
}

const NO_FOLDERS: Folders = { at: null, entries: new Map() };

export const folders = tabState<Folders>(() => NO_FOLDERS);

/** What the reader chose for each tab's tree. */
export const choices = tabState<Choices>(() => NO_CHOICES);

/** The row the keyboard is on, by key. */
export const focus = tabState<string | undefined>(() => undefined);

/** The file on screen, by key, as the middle view says. */
export const onScreen = tabState<string | undefined>(() => undefined);

/** A row to scroll into view, each time the count goes up. */
export const reveal = tabState<{ key: string; count: number } | undefined>(() => undefined);

/** What each tab's tree last showed, for the keys, which act on what's on screen. */
export const shown = new Map<string, Model>();

/** Takes what main sent. A tree of another commit forgets the folders of the last. */
export function showState(state: TreeState): void {
  states.set(state.id, state);
  if (folders.get(state.id).at !== state.at)
    folders.set(state.id, { at: state.at, entries: new Map() });
}

/**
 * Keeps the folders main sent for the commit `at`, unless the tree has moved on. A folder asked for
 * that main didn't send isn't in the commit, as a deleted file's folder may not be: it's kept empty,
 * so it isn't asked for again.
 */
export function addFolders(
  id: string,
  at: string,
  asked: readonly TreePath[],
  sent: readonly Folder[],
): void {
  folders.update(id, (current) => {
    if (current.at !== at) return current;
    const entries = new Map(current.entries);
    for (const path of asked) if (!entries.has(keyOf(path))) entries.set(keyOf(path), []);
    for (const folder of sent) entries.set(keyOf(folder.path), folder.entries);
    return { at, entries };
  });
}

/** Folders asked for and not yet answered, by tab, so none is asked for twice. */
const asked = new Map<string, Set<string>>();

/**
 * Asks main for `paths`' entries, of the tree at `at`, but those already asked for: as many
 * requests as it takes, each of `FOLDERS_LIMIT` folders at most.
 */
export function askFolders(id: string, at: string, paths: readonly TreePath[]): void {
  let waiting = asked.get(id);
  if (!waiting) {
    waiting = new Set();
    asked.set(id, waiting);
  }
  const pending = waiting;
  const wanted = paths.filter((path) => !pending.has(`${at}\0${keyOf(path)}`));
  for (let start = 0; start < wanted.length; start += FOLDERS_LIMIT) {
    const batch = wanted.slice(start, start + FOLDERS_LIMIT);
    const keys = batch.map((path) => `${at}\0${keyOf(path)}`);
    for (const key of keys) pending.add(key);
    main()
      .folder({ id, at, paths: batch })
      .then((sent) => addFolders(id, at, batch, sent))
      .catch((error: unknown) => console.error("Lo couldn't read a folder of the tree:", error))
      .finally(() => {
        for (const key of keys) pending.delete(key);
      });
  }
}

/** Asks main what it has of a tab's tree, unless a newer one arrived meanwhile. */
export function catchUp(id: string): void {
  main()
    .current({ id })
    .then((state) => {
      if (state && states.get(id) === undefined) showState(state);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's tree:", error));
}

/** Opens or closes a folder by hand. */
export function setOpen(id: string, key: string, open: boolean): void {
  choices.update(id, (current) => {
    const opened = new Set(current.opened);
    const closed = new Set(current.closed);
    if (open) {
      opened.add(key);
      closed.delete(key);
    } else {
      closed.add(key);
      opened.delete(key);
    }
    return { ...current, opened, closed };
  });
}
