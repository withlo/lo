// Each pull request's tab's revisions in the window: what main last sent, and the revision picker,
// while it's open: the row the keyboard is on and the two ends. Each is kept with its tab and goes
// when the tab closes.

import { tabState } from '../../tab/window/shared.ts';
import type { ComparisonView } from '../contract.ts';
import { main } from './main.ts';
import type { Ends, Marked } from './model.ts';

/** What main last sent of each tab's revisions. */
export const views = tabState<ComparisonView | undefined>(() => undefined);

/** The revision picker of a tab: closed, or open with the row the keyboard is on and the ends. */
export type Picker =
  | { readonly open: false }
  | { readonly open: true; readonly focused: string | undefined; readonly ends: Ends };

export const pickers = tabState<Picker>(() => ({ open: false }));

/** What other features mark on each tab's revisions. */
export const marked = tabState<Marked>(() => ({}));

/** Takes what main sent. */
export function showView(view: ComparisonView): void {
  views.set(view.id, view);
}

const asked = new Set<string>();

/** Asks main for a tab's revisions, once, for a tab drawn before main said anything of it. */
export function catchUp(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  main()
    .list({ id })
    .then((view) => {
      if (view && views.get(id) === undefined) views.set(id, view);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's revisions:", error))
    .finally(() => asked.delete(id));
}
