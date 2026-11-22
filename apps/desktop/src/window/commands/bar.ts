// Lo's commands in the macOS app menu: those that declare `bar`, with the key each shows there and
// whether it can run on what has focus.

import {
  findScope,
  isChord,
  KEY_EVENT,
  scopeTarget,
  type Registry,
  type Target,
} from '@lo/ui/commands';

import type { BarItem } from '../../features/keys/contract.ts';

/**
 * The app menu's items for `registry`'s commands, as they'd run on `target`. A command shows its
 * first key that's a single chord: a menu can't show a sequence, and a key without a modifier
 * would fire from the menu as it's typed. With `blocked`, a right-click menu is open over the window,
 * and none can run.
 */
export function barItems(registry: Registry, target: Target, blocked = false): BarItem[] {
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
        // A menu can't set code apart, so a name that's code in a label goes in plainly.
        label: command.label.replaceAll('`', ''),
        menu: command.bar.menu,
        order: command.bar.order,
        ...(key ? { key } : {}),
        enabled: !blocked && registry.enabled(command.id, target) === true,
      },
    ];
  });
}

const stale = new Set<() => void>();

/**
 * Says that whether some command can run changed with nothing the menu watches changing, as when
 * an update finishes downloading: the app menu is made again from the registry as it is now.
 * Focus, and the keys the registry holds, tell the menu themselves.
 */
export function menuStale(): void {
  for (const listener of stale) listener();
}

/** Calls `listener` each time {@link menuStale} is called. Returns a function that stops it. */
export function onMenuStale(listener: () => void): () => void {
  stale.add(listener);
  return () => {
    stale.delete(listener);
  };
}

/**
 * Runs the command a click in the app menu chose, on `target`, through the registry: only one the
 * menu lists, one that declares `bar`. `true`, or why it didn't run. The click is the reader's input,
 * but makes no event in the page: before the command runs, it drops the keys held for a sequence, as
 * a click in the page does, and the focused element hears it as it hears a key the registry takes
 * (`KEY_EVENT`), so what waits for the reader's next input knows of it.
 */
export function runFromBar(registry: Registry, id: string, target: Target): true | string {
  if (!registry.command(id)?.bar) return `${id} isn't in the app menu.`;
  registry.drop();
  (document.activeElement ?? document.body).dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
  return registry.run(id, target);
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
