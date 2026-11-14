// The comment box's own keys as its frame shows them, read from the declarations of the keys its
// editor handles itself (`../keys.ts`), so what the foot says and what the box does can't differ.

import { keyLabels, parseKeys, systemStrokes, type KeySpec } from '@lo/ui/commands';

import { registry } from '../../../window/commands/registry.ts';
import keys from '../keys.ts';

/** The comment box's keys with a label in its frame, by their commands' names. */
export type BoxKey = 'addToReview' | 'postNow' | 'preview' | 'attach';

/** The keys a declaration of a key gives, in Lo's notation. */
function written(spec: KeySpec): string {
  return typeof spec === 'string' ? spec : spec.keys;
}

/** `name`'s first default key, as this system shows it. */
export function boxKeys(name: BoxKey): string[] {
  const [first] = keys.commands[name].keys;
  if (first === undefined) throw new Error(`comments.${name} has no key.`);
  const { system } = registry();
  return keyLabels(systemStrokes(parseKeys(written(first)), system), system);
}
