// What the stacks share with other features' window code: how many review threads the layer on
// screen has unresolved, which another feature counts, for its row in the stack's tree.

import { countWith, type LayerCounter } from './counts.ts';

export type { LayerCounter } from './counts.ts';

/**
 * Gives the stack's tree what counts the layer on screen's unresolved threads, such as the
 * comments: its row shows them as they change, where the other layers' rows show what was read of
 * each layer with the stack. Returns a function that takes it back.
 */
export function setLayerCounts(counter: LayerCounter): () => void {
  return countWith(counter);
}
