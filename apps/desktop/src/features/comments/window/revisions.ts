// Each view's revisions, as the revisions feature sends them, for the threads panel: what the
// revision an outdated thread was written on is called, and what the view compares, so a thread the
// diff on screen doesn't show can be shown in the diff of the revision it's on. Each is kept with
// its tab and goes when the tab closes.

import { client, type Client } from '../../../window/ipc.ts';
import { contract, type ComparisonView } from '../../revisions/contract.ts';
import { tabState } from '../../tab/window/shared.ts';

/** The revisions feature's client: each tab's revisions, and comparing two of them. */
export function revisions(): Client<typeof contract> {
  return client(contract);
}

/** What the revisions feature last sent of each view's revisions. */
export const revisionViews = tabState<ComparisonView | undefined>(() => undefined);

/** Takes what the revisions feature sent. */
export function takeRevisions(view: ComparisonView): void {
  revisionViews.set(view.id, view);
}

const asked = new Set<string>();

/** Asks for a view's revisions, once, for a view drawn before the revisions feature said them. */
export function catchUpRevisions(id: string): void {
  if (asked.has(id) || revisionViews.get(id) !== undefined) return;
  asked.add(id);
  revisions()
    .list({ id })
    .then((view) => {
      if (view && revisionViews.get(id) === undefined) takeRevisions(view);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's revisions:", error))
    .finally(() => asked.delete(id));
}

/** The label of the revision with head `head` in `view`, `r2`, if it's one of its revisions. */
export function labelIn(view: ComparisonView | undefined, head: string): string | undefined {
  const number = view?.revisions.find((revision) => revision.head === head)?.number;
  return number === undefined || number === null ? undefined : `r${number}`;
}
