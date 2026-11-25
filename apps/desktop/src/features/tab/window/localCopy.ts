// Where a pull request's local copy is: shown in Finder, or the system's file manager, and its path
// copied, from the status bar item's details or from the palette. Main does both with the whole
// path, which the window has only written shorter. A copy says how it went on the details' Copy
// path where they're open, which reads "Copied", else in a toast.

import type { CopySaid } from '@lo/ui';

import { announce, fail, saidBy } from '../../../window/commands/notices.tsx';
import { activeTab } from './shared.ts';
import { main } from './main.ts';
import { pullsStore } from './store.ts';

/** Where the local copy of view `id` is, once it's ready, as a person writes it. */
export function localFolder(id: string): string | undefined {
  const local = pullsStore.getState().locals.get(id);
  return local?.kind === 'ready' ? local.folder : undefined;
}

/** The view on screen whose local copy is ready, or why there's none. */
function readyOnScreen(): { id: string } | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  return localFolder(tab.id) === undefined ? 'The local copy isn’t ready' : { id: tab.id };
}

/** Whether the view on screen's local copy can be shown or copied, or why not. */
export function localShowable(): true | string {
  const ready = readyOnScreen();
  return typeof ready === 'string' ? ready : true;
}

/** Shows the view on screen's local copy in Finder, or the file manager, and says if that failed. */
export async function showLocalCopy(): Promise<void> {
  const ready = readyOnScreen();
  if (typeof ready === 'string') return;
  try {
    await main().showLocal({ id: ready.id });
  } catch (error) {
    console.error("Lo couldn't show the local copy:", error);
    fail('Couldn’t show the local copy', saidBy(error));
  }
}

/** The Copy path buttons drawn for each view, which answer a copy of its path. */
const answering = new Map<string, Set<(said: CopySaid) => void>>();

/** Has view `id`'s Copy path button, `say`, answer copies of its path while it's drawn. */
export function answerLocalCopies(id: string, say: (said: CopySaid) => void): () => void {
  const buttons = answering.get(id) ?? new Set();
  answering.set(id, buttons);
  buttons.add(say);
  return () => {
    buttons.delete(say);
    if (buttons.size === 0 && answering.get(id) === buttons) answering.delete(id);
  };
}

/**
 * Copies the whole path of the view on screen's local copy, which main has, and says how that
 * went: on its Copy path where the details are open, else in a toast, as from the palette.
 */
export async function copyLocalPath(): Promise<void> {
  const ready = readyOnScreen();
  if (typeof ready === 'string') return;
  let failed: unknown;
  try {
    await main().copyLocal({ id: ready.id });
  } catch (error) {
    console.error("Lo couldn't copy the local copy's path:", error);
    failed = error;
  }
  const buttons = answering.get(ready.id);
  if (buttons) {
    for (const say of buttons) say(failed === undefined ? 'copied' : 'failed');
  } else if (failed === undefined) {
    announce('Copied path');
  } else {
    fail('Couldn’t copy the path', saidBy(failed));
  }
}
