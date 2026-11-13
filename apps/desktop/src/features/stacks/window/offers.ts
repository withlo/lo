// Where each layer's diff could start, as main last offered it in the layer's stack: kept with the
// layer's view of its tab, and gone when the tab closes.

import type { DiffState } from '../../diff/contract.ts';
import { diffStateOf, onDiffState } from '../../diff/window/shared.ts';
import { tabState, type BannerSwitch } from '../../tab/window/shared.ts';
import type { Offer, StackState } from '../contract.ts';
import { main } from './main.ts';

/** The start each view of a pull request's tab is offered, if any. */
export const offers = tabState<Offer | null>(() => null);

/** Takes what main sent of a tab's stack. */
export function takeStack(state: StackState): void {
  const kept = offers.get(state.id);
  if (JSON.stringify(kept) !== JSON.stringify(state.offer)) offers.set(state.id, state.offer);
}

const asked = new Set<string>();

/** Asks main for a tab's stack, once, for a tab drawn before main said anything of it. */
export function catchUp(id: string): void {
  if (asked.has(id)) return;
  asked.add(id);
  main()
    .state({ id })
    .then((state) => {
      if (state && offers.get(id) === null) offers.set(id, state.offer);
    })
    .catch((error: unknown) => console.error("Lo couldn't ask about a tab's stack:", error))
    .finally(() => asked.delete(id));
}

/** Starts tab `id`'s layer's diff where `offer` says, as its banner's button does. */
export function applyOffer(id: string, offer: Offer): void {
  offers.set(id, null);
  main()
    .useStart({ id, commit: offer.commit })
    .catch((error: unknown) => console.error("Lo couldn't start the layer's diff there:", error));
}

/**
 * Whether the diff on screen, as main says it (`state`), already starts where `offer` says: it's
 * compared with that commit, or the local copy worked out that its changes start there, as when the
 * layer's base branch was the layer below's until it was changed elsewhere. For a start at the base
 * branch (no commit), it's compared with that. A diff main hasn't worked out the start of, as
 * GitHub's, doesn't.
 */
export function startedAt(offer: Offer, state: DiffState | undefined): boolean {
  if (state === undefined) return false;
  if (offer.commit === null) return state.compareFrom === null;
  return state.compareFrom === offer.commit || state.start === offer.commit;
}

/** The start tab `id` is offered, if it's one its diff on screen doesn't start at already. */
export function offerFor(id: string): Offer | null {
  const offer = offers.get(id);
  return offer === null || startedAt(offer, diffStateOf(id)) ? null : offer;
}

/**
 * Whether a tab's banner shows: while it's offered a start its diff on screen doesn't have
 * already. A tab drawn before main said anything of its stack asks for it as it comes on screen.
 */
export const startSwitch: BannerSwitch = {
  shows: (tab) => offerFor(tab.id) !== null,
  subscribe(tab, listener) {
    if (offers.get(tab.id) === null) catchUp(tab.id);
    const stops = [offers.subscribe(listener), onDiffState(tab.id, listener)];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
