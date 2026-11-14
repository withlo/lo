// Commands: every action is one, with an id, a label, default keys, where it applies and a handler.
// A feature declares its commands in `keys.ts`, as plain data Node can import, and gives each a
// handler in its window code:
//
//   export default defineCommands('diff', {
//     markViewed: {
//       label: 'Mark viewed', group: 'Act', keys: ['e'], targets: ['line', 'file'],
//       when: { scope: ['diff', 'tree'], mode: 'normal' }, menu: { on: 'file', order: 20 },
//     },
//   });
//
//   export default { commands: handlers(keys, { markViewed: { run, enabled } }) };

import { parseKeys, type System } from './notation.ts';
import type { Mode } from './scopes.ts';
import type { NoTarget, Target, TargetKind, TargetOf } from './targets.ts';

/** The key table's groups, in its order, which key help follows. */
export const groups = [
  'Move',
  'Jump',
  'Act',
  'Threads',
  'Code',
  'Copy and open',
  'Review',
  'Find',
  'View',
  'Files',
  'Overview',
  'Panels',
  'Diff view',
  'Comment box',
  'Merge queue',
  'Revision picker',
  'Palettes',
  'Tabs and window',
] as const;

export type Group = (typeof groups)[number];

/** The macOS app menu's menus a command can sit in. `App` is the menu named after Lo. */
export type BarMenu = 'App' | 'File' | 'View' | 'Go' | 'Review' | 'Window';

/** A default key sequence in Lo's notation, for both systems or for one. */
export type KeySpec = string | { readonly keys: string; readonly on: System };

/**
 * Where a command's keys apply, as data the clash check can try every combination of. Every
 * condition given must hold.
 */
export interface When {
  /** The focused scope is one of these. Without it, the command applies anywhere. */
  readonly scope?: string | readonly string[];
  /** The focused scope is none of these. */
  readonly except?: readonly string[];
  /** In a code view, Vim is in one of these modes. Other scopes have no mode. */
  readonly mode?: Mode | readonly Mode[];
  /** The command exists on this system only. */
  readonly system?: System;
}

/** Where a command is in right-click menus: the kind of target's menu, and its place there. */
export interface MenuPlace {
  readonly on: TargetKind;
  readonly order: number;
  /** What that menu calls it, for a command that does something else to other targets. */
  readonly label?: string;
}

/** Each right-click menu `command` is in. */
export function menuPlaces(command: Pick<Declaration, 'menu'>): readonly MenuPlace[] {
  const { menu } = command;
  if (menu === undefined) return [];
  return 'on' in menu ? [menu] : menu;
}

export interface Declaration {
  readonly label: string;
  readonly group: Group;
  /** Its default keys. The keymap file adds and removes keys over these. */
  readonly keys: readonly KeySpec[];
  /** What it acts on. Without it, nothing in particular (`none`). */
  readonly targets?: readonly TargetKind[];
  readonly when?: When;
  /**
   * `own`: one of Vim's keys, documented and never taken. `motion`: one of Lo's jumps, which a
   * code view's Vim runs with the keys the registry hands it, so counts and visual mode work;
   * elsewhere, and from the palette, its handler runs.
   */
  readonly vim?: 'own' | 'motion';
  /** Its key replaces one of Vim's in a code view, on purpose. */
  readonly overVim?: boolean;
  /** Running it records the place it leaves in the tab's history first. */
  readonly jump?: boolean;
  /** A held key runs it again with each repeat. Without it, a held key runs it once. */
  readonly repeat?: boolean;
  /**
   * What a count typed before its keys counts, as in Vim's `3j`: `files` for `3e`. Its handler gets
   * the count, `1` for `1e`, or nothing without one. Without it, a count before its keys goes on to
   * Vim in a code view, and is dropped elsewhere.
   */
  readonly count?: string;
  /**
   * It's in the right-click menu of targets of this kind, or of each of these kinds, after the
   * commands with a lower `order`. A menu draws a separator wherever the key table's `group`
   * changes between neighbours, so commands of one group sit together.
   */
  readonly menu?: MenuPlace | readonly MenuPlace[];
  /** It's in this menu of the macOS app menu. */
  readonly bar?: { readonly menu: BarMenu; readonly order: number };
}

/** A feature's declarations, as `keys.ts` exports them. */
export interface Declarations<D extends Record<string, Declaration> = Record<string, Declaration>> {
  /** The feature's folder name. Its commands' ids are `<feature>.<name>`. */
  readonly feature: string;
  readonly commands: D;
  /** The scopes the feature names on the DOM, besides the engine's and the code views'. */
  readonly scopes: readonly string[];
}

/** What runs a command, given its target. */
export interface Handler<T extends Target = Target> {
  /** `count` is the count typed before its keys, for a command that takes one, if one was. */
  run(target: T, count?: number): void | Promise<void>;
  /** `true`, or why it can't run on `target` now, as menus grey it out with. */
  enabled?(target: T): true | string;
  /**
   * Whether a right-click menu on `target` lists it: always, without this. For a keyless command
   * that applies to only some targets of its kind, such as a line's overview note on a line with
   * one, which no key could reach elsewhere.
   */
  listed?(target: T): boolean;
}

/** The target a command's handler gets, from the kinds it declares. */
export type TargetFor<D extends Declaration> = D extends {
  readonly targets: readonly (infer K extends TargetKind)[];
}
  ? TargetOf<K>
  : NoTarget;

/** A handler for each of a feature's commands, but Vim's own keys, which nothing runs. */
export type HandlersFor<D extends Record<string, Declaration>> = {
  [K in keyof D as D[K] extends { readonly vim: 'own' } ? never : K]: Handler<TargetFor<D[K]>>;
};

/** A command as the registry has it: its declaration, its id, and its handler. */
export interface Command extends Declaration {
  /** `<feature>.<name>`. */
  readonly id: string;
  readonly feature: string;
  readonly name: string;
  /** Absent for Vim's own keys, and for declarations read without their handlers. */
  readonly handler?: Handler;
}

const NAME = /^[a-z][a-zA-Z0-9]*$/;

/** Whether `id` is written as a command's id is: `<feature>.<name>`. */
export function isCommandId(id: string): boolean {
  const [feature, name, ...rest] = id.split('.');
  return (
    feature !== undefined &&
    name !== undefined &&
    rest.length === 0 &&
    NAME.test(feature) &&
    NAME.test(name)
  );
}

/**
 * Declares a feature's commands. `feature` is its folder's name. Each default key is read here, so
 * a key Lo's notation can't read fails when the declaration loads.
 */
export function defineCommands<const D extends Record<string, Declaration>>(
  feature: string,
  commands: D,
  options: { readonly scopes?: readonly string[] } = {},
): Declarations<D> {
  if (!NAME.test(feature)) throw new Error(`"${feature}" isn't a feature name, such as diff.`);
  for (const [name, declaration] of Object.entries(commands)) {
    if (!NAME.test(name)) throw new Error(`"${feature}.${name}" isn't a command id.`);
    for (const spec of declaration.keys) parseKeys(typeof spec === 'string' ? spec : spec.keys);
  }
  return { feature, commands, scopes: options.scopes ?? [] };
}

/** A feature's commands with no handlers: what Node reads for the checks and the docs. */
export function commandsOf(declarations: Declarations): readonly Command[] {
  return Object.entries(declarations.commands).map(([name, declaration]) => ({
    ...declaration,
    id: `${declarations.feature}.${name}`,
    feature: declarations.feature,
    name,
  }));
}

/**
 * A feature's commands with their handlers, one for each, typed from the declarations: each
 * handler gets a target of a kind its command declares. A handler for a command the feature
 * doesn't declare, or for one of Vim's own keys, fails as it loads.
 */
export function handlers<const D extends Record<string, Declaration>>(
  declarations: Declarations<D>,
  given: HandlersFor<D>,
): readonly Command[] {
  const byName: Readonly<Record<string, Handler | undefined>> = given;
  const { feature, commands } = declarations;
  for (const name of Object.keys(byName)) {
    const declaration = Object.hasOwn(commands, name) ? commands[name] : undefined;
    if (declaration === undefined) {
      throw new Error(
        `${feature}.${name} has a handler, but ${feature}'s keys.ts doesn't declare it.`,
      );
    }
    if (declaration.vim === 'own') {
      throw new Error(
        `${feature}.${name} is one of Vim's own keys, which nothing runs, so it has no handler.`,
      );
    }
  }
  return commandsOf(declarations).map((command) => {
    const handler = Object.hasOwn(byName, command.name) ? byName[command.name] : undefined;
    return handler === undefined ? command : { ...command, handler };
  });
}

/** The scopes `when` names, as a list. */
export function listOf<T extends string>(value: T | readonly T[] | undefined): readonly T[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}
