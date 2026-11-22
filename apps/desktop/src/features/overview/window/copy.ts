// Copying the prompt a tab's overview offers, with `ya` or Copy prompt: built from what the window
// knows of the tab, and put on the clipboard by main.

import type { CopySaid } from '@lo/ui';

import { announce, fail } from '../../../window/commands/notices.tsx';
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

/** The Copy prompt buttons drawn, by tab, each told how a copy of its tab's prompt went. */
const answering = new Map<string, Set<(said: CopySaid) => void>>();

/**
 * Has `say` hear how each copy of tab `id`'s prompt goes, by its button or its key, while the Copy
 * prompt button that calls it is drawn: it says so on the button. Returns a function that stops.
 */
export function answerCopies(id: string, say: (said: CopySaid) => void): () => void {
  const buttons = answering.get(id) ?? new Set();
  answering.set(id, buttons);
  buttons.add(say);
  return () => {
    buttons.delete(say);
    if (buttons.size === 0 && answering.get(id) === buttons) answering.delete(id);
  };
}

/**
 * Puts tab `id`'s `prompt` on the clipboard, and says how that went: on the tab's Copy prompt
 * button where one is drawn, which reads "Copied" or "Couldn’t copy", else in a toast, as for `ya`
 * pressed where no button copies it.
 */
export async function copyPrompt(id: string, prompt: string): Promise<void> {
  let said: CopySaid = 'copied';
  try {
    await client(tabContract).copy({ text: prompt });
  } catch (error) {
    console.error("Lo couldn't copy the prompt:", error);
    said = 'failed';
  }
  const buttons = answering.get(id);
  if (buttons) {
    for (const say of buttons) say(said);
  } else if (said === 'copied') {
    announce('Copied prompt');
  } else {
    fail('Couldn’t copy the prompt');
  }
}
