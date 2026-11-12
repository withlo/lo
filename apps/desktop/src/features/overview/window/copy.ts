// Copying the prompt a tab's overview offers, with `ya` or a Copy button: built from what the window
// knows of the tab, and put on the clipboard by main.

import { client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { pullOf, type PullTab } from '../../tab/window/shared.ts';
import { newestHead, promptKindOf, revisionAt, standingOf, type Standing } from './facts.ts';
import { promptOf } from './prompts.ts';
import { checked, revisions, states } from './store.ts';

/**
 * The prompt `tab`'s overview offers, standing as `standing`, or none: there's none for an
 * overview Lo is still reading or checking, one it couldn't read, or one in a newer format.
 */
export function promptFor(tab: PullTab, standing: Standing): string | undefined {
  const kind = promptKindOf(standing);
  if (kind === undefined) return undefined;
  const known = revisions.get(tab.id);
  return promptOf({
    kind,
    pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
    written: standing.kind === 'shown' ? revisionAt(known, standing.header.commit) : undefined,
    newest: revisionAt(known, newestHead(pullOf(tab.id))),
  });
}

/** The prompt `tab`'s overview offers now, as the stores have it. */
export function promptNow(tab: PullTab): string | undefined {
  return promptFor(tab, standingOf(states.get(tab.id), checked.get(tab.id)));
}

/** Puts `prompt` on the clipboard. */
export async function copyPrompt(prompt: string): Promise<void> {
  await client(tabContract).copy({ text: prompt });
}
