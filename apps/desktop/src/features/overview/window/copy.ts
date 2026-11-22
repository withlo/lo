// Copying the prompt a tab's overview offers, with `ya` or Copy prompt: built from what the window
// knows of the tab, and put on the clipboard by main.

import { announce, refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { pullOf, type PullTab } from '../../tab/window/shared.ts';
import { promptKindOf, revisionAt, standingOf, type Standing } from './facts.ts';
import { promptOf } from './prompts.ts';
import { checked, revisions, states } from './store.ts';

/**
 * The prompt `tab`'s overview offers, standing as `standing`, or none: there's none for an
 * overview Lo is still reading or checking, one it couldn't read, or one in a newer format. Where
 * the pull request is, it says, is the head on screen, as the overview's banner says.
 */
export function promptFor(tab: PullTab, standing: Standing): string | undefined {
  const kind = promptKindOf(standing);
  if (kind === undefined) return undefined;
  const known = revisions.get(tab.id);
  return promptOf({
    kind,
    pull: { owner: tab.owner, repo: tab.repo, number: tab.number },
    written: standing.kind === 'shown' ? revisionAt(known, standing.header.commit) : undefined,
    newest: revisionAt(known, pullOf(tab.id)?.shown ?? undefined),
  });
}

/** The prompt `tab`'s overview offers now, as the stores have it. */
export function promptNow(tab: PullTab): string | undefined {
  return promptFor(tab, standingOf(states.get(tab.id), checked.get(tab.id)));
}

/**
 * Puts `prompt` on the clipboard, and says it's there, or that it couldn't be: the buttons that
 * copy it are commands', which have no "Copied" of their own to read.
 */
export async function copyPrompt(prompt: string): Promise<void> {
  try {
    await client(tabContract).copy({ text: prompt });
  } catch (error) {
    console.error("Lo couldn't copy the prompt:", error);
    refuse('Couldn’t copy the prompt');
    return;
  }
  announce('Copied prompt');
}
