// The keys the screen shows on its controls, as this system shows them.

import { keyLabels } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';

/** The first key the command `id` has now, the keymap's included, if it has one. */
export function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}
