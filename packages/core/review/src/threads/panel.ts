/** Which threads the threads panel lists (`docs/design.md`, "Threads panel"). */

import { Thread } from '../threads.ts';

/**
 * Which threads the threads panel lists: `unresolved` ones, the default; `all` of them; or
 * `yours`, the threads you started or replied in, resolved or not. Each thread there is labeled
 * outdated when it is ({@link Thread.outdated}).
 */
export type PanelFilter = 'unresolved' | 'all' | 'yours';

/** The filter the threads panel starts with. */
export const DEFAULT_PANEL_FILTER: PanelFilter = 'unresolved';

/** Whether the panel, filtered by `filter`, lists `thread` for the viewer with login `viewer`. */
export function panelShows(filter: PanelFilter, thread: Thread, viewer: string): boolean {
  switch (filter) {
    case 'unresolved':
      return !thread.resolved;
    case 'all':
      return true;
    case 'yours':
      return Thread.involves(thread, viewer);
    default:
      return filter satisfies never;
  }
}

/** The threads the panel lists, in the order given. */
export function panel(threads: readonly Thread[], filter: PanelFilter, viewer: string): Thread[] {
  return threads.filter((thread) => panelShows(filter, thread, viewer));
}
