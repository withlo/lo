// What the revisions' keys do: open the picker on the pull request on screen, move in it, set an
// end, and compare. A comparison goes to main, which says once it's on screen.

import { notify } from '../../../window/commands/notices.tsx';
import { activeTab } from '../../tab/window/shared.ts';
import type { Compared } from '../contract.ts';
import { main } from './main.ts';
import {
  comparedOf,
  endsOf,
  moved,
  rowsOf,
  shortcutsOf,
  withEnd,
  type Shortcuts,
} from './model.ts';
import { pickers, views } from './store.ts';

/** The pull request's tab on screen, and its revisions, or why there are none to pick from. */
function onScreen() {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const view = views.get(tab.id);
  if (!view) return 'Lo hasn’t read the revisions yet.';
  if (view.status === 'signIn') return 'Sign in to see revisions.';
  if (view.status === 'loading') return 'Lo is still reading the revisions.';
  if (view.revisions.length === 0) return view.problem ?? 'Lo couldn’t read the revisions.';
  return { id: tab.id, view };
}

/** Whether the picker can open on the pull request on screen, or why not. */
export function canPick(): true | string {
  const found = onScreen();
  return typeof found === 'string' ? found : true;
}

/** Opens the revision picker on the pull request on screen, at the comparison it shows. */
export function openPicker(): void {
  const found = onScreen();
  if (typeof found === 'string') return;
  const { id, view } = found;
  // At a comparison offered, so `⏎` takes it; else at the one asked for, or the one on screen.
  const compared =
    view.offered ??
    view.pending ??
    view.comparison ??
    (view.shown ? { from: null, to: view.shown } : undefined);
  if (!compared) return;
  const ends = endsOf(compared);
  pickers.set(id, { open: true, focused: ends.to, ends });
}

/** The tab whose picker is open, with its revisions. */
function picking() {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return undefined;
  const picker = pickers.get(tab.id);
  const view = views.get(tab.id);
  if (!picker.open || !view) return undefined;
  return { id: tab.id, picker, view };
}

/** Whether a picker is open, or why its keys can't run. */
export function isPicking(): true | string {
  return picking() ? true : 'The revision picker isn’t open.';
}

export function closePicker(): void {
  const tab = activeTab();
  if (tab?.kind === 'pull') pickers.set(tab.id, { open: false });
}

/** Moves the keyboard `step` rows on in the open picker. */
export function move(step: 1 | -1): void {
  const open = picking();
  if (!open) return;
  const rows = rowsOf(open.view, Date.now());
  pickers.set(open.id, { ...open.picker, focused: moved(rows, open.picker.focused, step) });
}

/** Makes the row the keyboard is on, or `key`'s, an end. */
export function setEnd(key?: string): void {
  const open = picking();
  if (!open) return;
  const at = key ?? open.picker.focused;
  if (at === undefined) return;
  const rows = rowsOf(open.view, Date.now());
  pickers.set(open.id, { ...open.picker, focused: at, ends: withEnd(rows, open.picker.ends, at) });
}

/** Compares `compared` on tab `id`, and closes its picker. */
async function compare(id: string, compared: Compared): Promise<void> {
  pickers.set(id, { open: false });
  const view = views.get(id);
  const now = view?.pending ?? view?.comparison;
  if (now && now.from === compared.from && now.to === compared.to) return;
  try {
    await main().compare({ id, ...compared });
  } catch (error) {
    notify('Compare revisions', error instanceof Error ? error.message : String(error));
  }
}

/** Compares the open picker's ends. */
export async function compareEnds(): Promise<void> {
  const open = picking();
  if (!open) return;
  await compare(open.id, comparedOf(open.picker.ends));
}

/** Compares what one of the open picker's shortcuts makes. */
export async function compareShortcut(which: keyof Shortcuts): Promise<void> {
  const open = picking();
  if (!open) return;
  const compared = shortcutsOf(open.view)[which];
  if (compared) await compare(open.id, compared);
}

/** Whether a shortcut can compare, or why not. */
export function canShortcut(which: keyof Shortcuts): true | string {
  const open = picking();
  if (!open) return 'The revision picker isn’t open.';
  if (shortcutsOf(open.view)[which]) return true;
  return which === 'review'
    ? 'You haven’t reviewed an earlier revision.'
    : 'You haven’t looked at an earlier revision here.';
}
