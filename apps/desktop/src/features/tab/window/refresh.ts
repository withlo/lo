// The reader's refresh: `⌘R` or `F5` reads what the tab on screen shows from GitHub again, at once. Main
// reads a pull request's tab's pull request and all it shows of it, what its middle views on
// screen show first, and a merge queue's tab's queue. The tab's mark in the strip turns until
// that's in, and asking again meanwhile asks nothing more. Nothing here draws.

import { createStore } from 'zustand/vanilla';

import { frontView, type FrontView } from '../contract.ts';
import { main } from './main.ts';
import { viewsShown } from './shared.ts';
import { activeOf, pullsStore, tabsStore } from './store.ts';

/** The tabs being read again, by their ids in the strip. */
export const refreshingStore = createStore<{ readonly ids: ReadonlySet<string> }>()(() => ({
  ids: new Set<string>(),
}));

function mark(id: string, on: boolean): void {
  const ids = new Set(refreshingStore.getState().ids);
  if (on) ids.add(id);
  else ids.delete(id);
  refreshingStore.setState({ ids });
}

/**
 * Why the tab on screen can't be read again now, or `true` when it can. Recent and Settings show
 * nothing read from GitHub, and Recent reads its list again each time it's shown. A tab being read
 * again already says so.
 */
export function refreshable(): true | string {
  const state = tabsStore.getState();
  const tab = activeOf(state);
  if (!tab || state.active === undefined || refreshingStore.getState().ids.has(state.active)) {
    return '';
  }
  switch (tab.kind) {
    case 'pull': {
      const connection = pullsStore.getState().views.get(tab.id)?.connection;
      if (connection?.kind === 'signedOut') return 'Sign in again to refresh';
      if (connection?.kind === 'rateLimited') return 'Rate limit reached';
      return true;
    }
    case 'queue':
      return true;
    case 'recent':
    case 'settings':
      return '';
    default:
      tab satisfies never;
      return '';
  }
}

/**
 * The middle views on screen in pull request's tab `tab`, left to right, by the feature that draws
 * each: a view's id is `<feature>.<name>`.
 */
function frontOf(tab: string): FrontView[] {
  return viewsShown(tab).flatMap((id) => {
    const read = frontView.safeParse(id.split('.')[0]);
    return read.success ? [read.data] : [];
  });
}

/** Reads the tab on screen again from GitHub, its mark turning in the strip until that's in. */
export async function refresh(): Promise<void> {
  const state = tabsStore.getState();
  const tab = activeOf(state);
  const { active } = state;
  if (!tab || active === undefined || refreshable() !== true) return;
  mark(active, true);
  try {
    // A pull request's tab by its view on screen, which main reads, what's on screen first.
    await main().refresh(
      tab.kind === 'pull' ? { id: tab.id, front: frontOf(tab.id) } : { id: tab.id },
    );
  } catch (error) {
    console.error("Lo couldn't read the tab again:", error);
  } finally {
    mark(active, false);
  }
}
