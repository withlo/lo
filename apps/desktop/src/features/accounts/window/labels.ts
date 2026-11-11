// The keys the feature's dialogs show on their buttons, as this system shows them.

import { keyLabels, parseKeys, systemStrokes } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';

/** A key written in Lo's notation, such as `enter`, as this system shows it. */
export function labels(keys: string): string[] {
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(keys), system), system);
}

/** The first key the command `id` has now, the keymap's included, if it has one. */
export function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}
