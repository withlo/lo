// What a right-click menu shows, read from the registry: the commands that declare a menu on the
// kind of target clicked, in their order, each with its keys as they are now and, when it can't
// run on that target, why.

import type { Group } from './declare.ts';
import { liveKeys, liveShortcut, onSystem } from './help.ts';
import type { Registry } from './registry.ts';
import type { Target } from './targets.ts';

/** One command in a right-click menu. */
export interface MenuItem {
  readonly id: string;
  readonly label: string;
  /** Its first key now, as labels in this system's form, if it has one. */
  readonly keys: readonly string[] | undefined;
  /** That key as `aria-keyshortcuts` says it, if it's one key or a chord. */
  readonly shortcut: string | undefined;
  /** Why it can't run on the target now, as the menu greys it with. Absent when it can. */
  readonly disabled: string | undefined;
}

/**
 * The menu of a right-click on `target`: every command on this system that declares `menu.on` as
 * the target's kind, by `menu.order` (the registry's order among equals). A command that can't run
 * on the target now is there, greyed with its reason, so the menu never hides what the keys can
 * do elsewhere; only a handler's `listed` leaves one out, for a target it doesn't apply to. The
 * commands are in sections, which the menu draws a separator between: a new one starts where the
 * key table's group changes.
 */
export function menuSections(registry: Registry, target: Target): MenuItem[][] {
  const commands = registry
    .commands()
    .filter(
      (command) =>
        command.menu?.on === target.kind &&
        command.handler !== undefined &&
        command.vim !== 'own' &&
        onSystem(registry, command) &&
        registry.listed(command.id, target),
    )
    .toSorted((a, b) => (a.menu?.order ?? 0) - (b.menu?.order ?? 0));
  const sections: MenuItem[][] = [];
  let group: Group | undefined;
  for (const command of commands) {
    const ready = registry.enabled(command.id, target);
    const item: MenuItem = {
      id: command.id,
      label: command.label,
      keys: liveKeys(registry, command)[0],
      shortcut: liveShortcut(registry, command),
      disabled: ready === true ? undefined : ready,
    };
    const last = sections.at(-1);
    if (last && group === command.group) last.push(item);
    else sections.push([item]);
    group = command.group;
  }
  return sections;
}
