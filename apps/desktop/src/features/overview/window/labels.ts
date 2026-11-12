// The keys the overview's views show on their controls, as this system shows them.

import { keyLabels } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';

/** The first key the command `id` has now, the keymap's included, if it has one. */
export function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/** The overview's middle view, among the tab's. */
export const OVERVIEW_VIEW = 'overview.view';

/**
 * The key that steps from the middle view `from` to `to` in one press, `` ` `` or `~`, among
 * `ids`, the tab's middle views in order; `` ` `` when neither does.
 */
export function stepKeyOf(ids: readonly string[], from: string | undefined, to: string): string {
  const count = ids.length;
  const at = from === undefined ? -1 : ids.indexOf(from);
  const goal = ids.indexOf(to);
  if (count > 1 && at >= 0 && goal >= 0 && (at - goal + count) % count === 1) {
    return 'tab.previousView';
  }
  return 'tab.nextView';
}
