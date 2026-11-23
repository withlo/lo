import { useSyncExternalStore } from 'react';

import { controlOf, heldRegistry, type CommandControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';

/** How many times the keys or the history have changed, which draws each control again. */
let changes = 0;

const subscribe = (listener: () => void): (() => void) => {
  const registry = heldRegistry();
  if (!registry) return () => undefined;
  const changed = () => {
    changes += 1;
    listener();
  };
  const stops = [registry.subscribe(changed), registry.history.subscribe(changed)];
  return () => {
    for (const stop of stops) stop();
  };
};

/**
 * What a control for command `id` on `target` shows now, drawn again whenever the keymap changes,
 * so it never shows a key the keymap file has moved, and whenever the tab's history does, so Back
 * and Forward dim as soon as there's nowhere to go. Nothing for a command that isn't there.
 */
export function useControl(id: string, target?: Target): CommandControl | undefined {
  useSyncExternalStore(
    subscribe,
    () => changes,
    () => 0,
  );
  return controlOf(id, target);
}
