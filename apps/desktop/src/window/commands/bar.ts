// Lo's commands in the macOS app menu: those that declare `bar`, with the key each shows there and
// whether it can run on what has focus.

import { findScope, isChord, scopeTarget, type Registry, type Target } from '@lo/ui/commands';

import type { BarItem } from '../../features/keys/contract.ts';

/**
 * The app menu's items for `registry`'s commands, as they'd run on `target`. A command shows its
 * first key that's a single chord: a menu can't show a sequence, and a key without a modifier
 * would fire from the menu as it's typed.
 */
export function barItems(registry: Registry, target: Target): BarItem[] {
  return registry.commands().flatMap((command): BarItem[] => {
    if (!command.bar || !command.handler) return [];
    const chord = registry
      .keysOf(command.id)
      .find(([first, ...rest]) => first !== undefined && rest.length === 0 && isChord(first))?.[0];
    const key = chord && {
      key: chord.key,
      meta: chord.meta,
      ctrl: chord.ctrl,
      alt: chord.alt,
      shift: chord.shift,
    };
    return [
      {
        id: command.id,
        label: command.label,
        menu: command.bar.menu,
        order: command.bar.order,
        ...(key ? { key } : {}),
        enabled: registry.enabled(command.id, target) === true,
      },
    ];
  });
}

/** What a key, a menu click or the palette acts on now: the focused scope's target. */
export function focusedTarget(): Target {
  try {
    return scopeTarget(findScope(document.activeElement));
  } catch (error) {
    console.error("Lo couldn't tell what has focus:", error);
    return { kind: 'none' };
  }
}
