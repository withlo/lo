// What the merge feature's window offers the others: asking to turn auto-merge on for a pull request
// from outside its merge panel, as the merge queue's `a` does for one that left the queue, through
// the panel's own confirmation, so the same checks guard it.

import { refuse } from '../../../window/commands/notices.tsx';
import { activeTab, withoutBidi } from '../../tab/window/shared.ts';
import type { MergeView } from '../contract.ts';
import { openPanel, panelTrouble } from './actions.ts';
import { autoMergeFromPanel } from './merging.ts';
import { shipping, statuses } from './store.ts';
import { cantAutoMerge, failedWhy } from './words.ts';

/** How long Lo waits for a view to say whether it can merge before giving up: 30 s. */
export const AUTO_MERGE_WAIT = 30_000;

/** How often Lo looks whether the view says so yet, in milliseconds. */
const LOOK_EVERY = 200;

/**
 * What asking to turn on auto-merge for pull request `number` does with its view's merge status
 * `view`: wait for the first read (`undefined`); plan it, as `a` in its panel does (`plan`); or say
 * why not, opening the panel when it has one (`said`), as when auto-merge is on already, which it
 * never turns off.
 */
export function autoMergeAsked(
  view: MergeView | undefined,
  number: number,
):
  | { readonly kind: 'plan' }
  | { readonly kind: 'said'; readonly why: string; readonly panel: boolean }
  | undefined {
  switch (view?.kind) {
    case undefined:
    case 'loading':
      return undefined;
    case 'none':
      return { kind: 'said', why: view.why, panel: false };
    case 'failed':
      return { kind: 'said', why: failedWhy(view), panel: false };
    case 'known': {
      const { auto } = view.state;
      if (auto.kind === 'on') return { kind: 'plan' };
      const why =
        auto.kind === 'off'
          ? 'Auto-merge is already on'
          : (cantAutoMerge(view.state, number) ?? 'Blocked by GitHub');
      return { kind: 'said', why, panel: true };
    }
    default:
      view satisfies never;
      return undefined;
  }
}

/**
 * Asks to turn on auto-merge for pull request `number` in view `id`, as `a` in its merge panel does,
 * once the view is on screen and Lo has read whether it can merge: the panel opens, and in its
 * place the confirmation, planned from what GitHub said of it. With auto-merge on already, or when
 * it can't be turned on, the panel opens and the reason alone says why, and nothing is asked. Lo
 * gives up when it hasn't read whether it can merge in 30 s, and says it couldn't. Returns a
 * function that stops waiting.
 */
export function askAutoMerge(id: string, number: number): () => void {
  let done = false;
  const stop = () => {
    done = true;
    clearInterval(looking);
    clearTimeout(late);
  };
  const look = () => {
    if (done) return;
    const asked = autoMergeAsked(statuses.getState().views.get(id), number);
    if (asked === undefined) return;
    if (asked.kind === 'said' && !asked.panel) {
      stop();
      refuse(withoutBidi(asked.why));
      return;
    }
    if (activeTab()?.id !== id) return;
    stop();
    openPanel(id, number);
    if (asked.kind === 'plan') autoMergeFromPanel();
    else refuse(withoutBidi(asked.why));
  };
  const looking = setInterval(look, LOOK_EVERY);
  // What went wrong shows in the panel it would have opened, never in a toast.
  const late = setTimeout(() => {
    if (done) return;
    stop();
    panelTrouble(id, number, {
      title: 'Couldn’t turn on auto-merge',
      reason: 'GitHub didn’t respond.',
      details: undefined,
    });
  }, AUTO_MERGE_WAIT);
  look();
  return stop;
}

/**
 * Whether approve and ship's dialog shows view `id`'s pull request now: what it does there, an
 * approval among it, is said in the dialog, and nothing else says it again.
 */
export function shipShowing(id: string): boolean {
  const { dialog } = shipping.getState();
  if (!dialog) return false;
  return (
    (dialog.kind === 'planning' || dialog.kind === 'refused' ? dialog.id : dialog.plan.id) === id
  );
}
