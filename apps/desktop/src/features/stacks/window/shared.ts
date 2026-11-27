// What the stacks share with other features' window code: how many review threads the layer on
// screen has unresolved, which another feature counts, for its row in the stack's tree; and the
// offer to convert the stack to a GitHub stack, which the merge panel makes too, while the stacks
// offer it, with the same Dismiss menu as the offer over the tree.

import { useEffect } from 'react';

import { useNoticeTarget } from '../../../window/commands/menus.tsx';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { countWith, type LayerCounter } from './counts.ts';
import { convertNotice } from './dismiss.ts';
import { catchUp, stacks } from './layers.ts';

export type { LayerCounter } from './counts.ts';

/**
 * Gives the stack's tree what counts the layer on screen's unresolved threads, such as the
 * comments: its row shows them as they change, where the other layers' rows show what was read of
 * each layer with the stack. Returns a function that takes it back.
 */
export function setLayerCounts(counter: LayerCounter): () => void {
  return countWith(counter);
}

/** What to spread on the element of an offer of a GitHub stack made outside the stack's tree. */
export type ConvertOffer = ReturnType<typeof useNoticeTarget>;

/**
 * The offer to convert the stack the view `tab` of a pull request's tab is in to a GitHub stack,
 * for a place besides its tree that makes it, as the merge panel does: nothing while the stacks
 * don't offer it (`stacks.offerConvert` off, or the offer dismissed for one of its layers), else
 * what to spread on the offer's element, so its right-click, and its Dismiss, open the menu the
 * offer over the tree has. A dismissal in either place takes both away in the same frame.
 */
export function useConvertOffer(tab: PullTab): ConvertOffer | undefined {
  const offered = useTabState(stacks, tab.id, (view) => view?.kind === 'stack' && view.offered);
  const notice = useNoticeTarget(convertNotice(tab));
  // A view drawn before main said anything of its stack, as after a reload with its tree hidden.
  useEffect(() => {
    if (stacks.get(tab.id) === undefined) catchUp(tab.id);
  }, [tab.id]);
  return offered ? notice : undefined;
}
