// What a right-click menu shows, read from the registry: the commands that declare a menu on the
// kind of target clicked, in their order, each with its keys as they are now, a switch with whether
// it's on, and, when it can't run on that target, why.

import { type Group, isOwned, menuPlaces } from './declare.ts';
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
  /**
   * For a switch, whether it's on for the target now, as the menu draws its check: "Collapse in
   * this repo". Absent for anything else, and for a switch the menu calls something else, which
   * is an action there: "Dismiss for all stacks".
   */
  readonly checked?: boolean | undefined;
}

/**
 * The menu of a right-click on `target`: every command on this system that declares `menu.on` as
 * the target's kind, by `menu.order` (the registry's order among equals). A command that can't run
 * on the target now is there, greyed with its reason, so the menu never hides what the keys can
 * do elsewhere; only a handler's `listed` leaves one out, for a target it doesn't apply to. The
 * commands are in sections, which the menu draws a separator between: a new one starts where the
 * key table's group changes, and at a place that's `apart`. A switch says whether it's on.
 */
export function menuSections(registry: Registry, target: Target): MenuItem[][] {
  const commands = registry
    .commands()
    .flatMap((command) => {
      const place = menuPlaces(command).find(({ on }) => on === target.kind);
      return place &&
        command.handler !== undefined &&
        !isOwned(command) &&
        onSystem(registry, command) &&
        registry.listed(command.id, target)
        ? [{ command, place }]
        : [];
    })
    .toSorted((a, b) => a.place.order - b.place.order);
  const sections: MenuItem[][] = [];
  let group: Group | undefined;
  for (const { command, place } of commands) {
    const ready = registry.enabled(command.id, target);
    const item: MenuItem = {
      id: command.id,
      label: registry.named(command.id, target) ?? place.label ?? command.label,
      keys: liveKeys(registry, command)[0],
      shortcut: liveShortcut(registry, command),
      disabled: ready === true ? undefined : ready,
      // A switch the menu names by what it does there, as "Dismiss for all stacks" is, is an action.
      ...(command.toggle === 'switch' && place.label === undefined
        ? { checked: registry.checked(command.id, target) }
        : {}),
    };
    const last = sections.at(-1);
    if (last && group === command.group && place.apart !== true) last.push(item);
    else sections.push([item]);
    group = command.group;
  }
  return sections;
}
