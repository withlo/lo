import { useSyncExternalStore } from 'react';

import { controlOf, heldRegistry, type CommandControl } from './commands/control.ts';
import type { Target } from './commands/targets.ts';

const subscribe = (listener: () => void): (() => void) => {
  const registry = heldRegistry();
  if (!registry) return () => undefined;
  const stops = [registry.subscribe(listener), registry.history.subscribe(listener)];
  return () => {
    for (const stop of stops) stop();
  };
};

/** What a control shows, as text that changes only when it does. */
function shownOf(control: CommandControl | undefined): string {
  return control === undefined
    ? ''
    : JSON.stringify([control.label, control.keys, control.shortcut, control.off]);
}

/**
 * What a control for command `id` on `target` shows now, drawn again whenever that changes: as the
 * keymap changes, so it never shows a key the keymap file has moved, and as the tab's history does,
 * so Back and Forward dim as soon as there's nowhere to go. A change that leaves what it shows as it
 * was draws nothing again, so a bar of tabs that reads one control isn't drawn again at each jump.
 * Nothing for a command that isn't there.
 */
export function useControl(id: string, target?: Target): CommandControl | undefined {
  useSyncExternalStore(
    subscribe,
    () => shownOf(controlOf(id, target)),
    () => '',
  );
  return controlOf(id, target);
}
