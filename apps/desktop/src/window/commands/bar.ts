// Lo's commands in the app menu: those that declare `bar`, with the key each shows there, whether
// it can run on what has focus, and whether it's checked.

import {
  findScope,
  fit,
  isChord,
  KEY_EVENT,
  listOf,
  SCOPE_ATTRIBUTE,
  scopeTarget,
  type Command,
  type Registry,
  type Target,
} from '@lo/ui/commands';

import type { BarItem } from '../../features/keys/contract.ts';

/**
 * The app menu's items for `registry`'s commands on its system, as they'd run with `focused` the
 * target of what has focus, each on what its key would act on (`keyTarget`). A command shows its
 * first key that's a single chord: a menu can't show a sequence, and a key without a modifier
 * would fire from the menu as it's typed. With `blocked`, a right-click menu is open over the
 * window, and none can run.
 */
export function barItems(registry: Registry, focused: Target, blocked = false): BarItem[] {
  return registry.commands().flatMap((command): BarItem[] => {
    if (!command.bar || !command.handler) return [];
    const system = command.when?.system;
    if (system !== undefined && system !== registry.system) return [];
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
    const { menu, section, order, instead } = command.bar;
    const target = keyTarget(command, focused);
    return [
      {
        id: command.id,
        // A menu can't set code apart, so a name that's code in a label goes in plainly.
        label: command.label.replaceAll('`', ''),
        menu,
        section,
        order,
        ...(instead !== undefined ? { instead } : {}),
        ...(key ? { key } : {}),
        enabled: !blocked && registry.enabled(command.id, target, true) === true,
        ...(command.toggle !== undefined
          ? { toggle: command.toggle, checked: registry.checked(command.id, target) === true }
          : {}),
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
 * Runs the command a click in the app menu chose through the registry, as its key would, on what
 * its key would act on, with `focused` the target of what has focus (`keyTarget`): only one the
 * menu lists, one that declares `bar`. `true`, or why it didn't run. The click is the reader's input,
 * but makes no event in the page: before the command runs, it drops the keys held for a sequence, as
 * a click in the page does, and the focused element hears it as it hears a key the registry takes
 * (`KEY_EVENT`), so what waits for the reader's next input knows of it. Choosing the option of a
 * choice that's already chosen does nothing, as in any menu, though its command would switch it.
 */
export function runFromBar(registry: Registry, id: string, focused: Target): true | string {
  const command = registry.command(id);
  if (!command?.bar) return `${id} isn’t in the app menu.`;
  const target = keyTarget(command, focused);
  if (command.toggle === 'choice' && registry.checked(id, target) === true) return true;
  registry.drop();
  (document.activeElement ?? document.body).dispatchEvent(new Event(KEY_EVENT, { bubbles: true }));
  return registry.run(id, target, undefined, true);
}

/**
 * What `command` acts on from the app menu, with `focused` the target of what has focus: what its
 * key would. A command that can't take that target takes what its key would act on in the scope
 * its key works in, while one is on screen: Go ▸ Next file, with focus on the middle of the window,
 * goes from the diff's cursor, as `] f` there would.
 */
function keyTarget(command: Command, focused: Target): Target {
  if (fit(command.targets ?? ['none'], focused)) return focused;
  for (const name of listOf(command.when?.scope)) {
    const shown = shownTarget(name);
    if (shown) return shown;
  }
  return focused;
}

/**
 * What a key in the scope called `name` would act on, in the one on screen: not one kept hidden,
 * as a view under another is, inert.
 */
function shownTarget(name: string): Target | undefined {
  for (const element of document.querySelectorAll(`[${SCOPE_ATTRIBUTE}]`)) {
    if (element.getAttribute(SCOPE_ATTRIBUTE) !== name || element.closest('[inert]')) continue;
    const scope = findScope(element);
    if (scope.source === undefined) continue;
    try {
      return scopeTarget(scope);
    } catch (error) {
      console.error("Lo couldn't tell what the view on screen acts on:", error);
      return undefined;
    }
  }
  return undefined;
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
