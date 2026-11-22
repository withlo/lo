import { useSyncExternalStore } from 'react';

import { controlOf, heldRegistry, type CommandControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';

/** How many times the keys have changed, which draws each control again. */
let changes = 0;

const subscribe = (listener: () => void): (() => void) =>
  heldRegistry()?.subscribe(() => {
    changes += 1;
    listener();
  }) ?? (() => undefined);

/**
 * What a control for command `id` on `target` shows now, drawn again whenever the keymap changes,
 * so it never shows a key the keymap file has moved. Nothing for a command that isn't there.
 */
export function useControl(id: string, target?: Target): CommandControl | undefined {
  useSyncExternalStore(
    subscribe,
    () => changes,
    () => 0,
  );
  return controlOf(id, target);
}
