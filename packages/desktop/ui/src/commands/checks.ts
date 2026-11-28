// The checks every feature's declarations pass. The app's tests run them over every `keys.ts`:
//
// - ids: every feature, command and scope has a name of its own, and `when` names only scopes that
//   exist;
// - handlers: one for every command but Vim's own, and none for a command `keys.ts` doesn't
//   declare;
// - keys: every command has a default key on each system it's on;
// - text-editing keys: a command on a key that edits text in a field either edits that field
//   itself, or applies only in scopes that hold no field;
// - menus: every item in a right-click menu or the app menu has a key, and a right-click menu's
//   target is one its command takes;
// - clashes: in each scope, mode and system, no key or start of a sequence is claimed twice, and
//   none is one the engine takes first;
// - Vim: in a code view, no key of Lo's meets one of Vim's unless its command says `overVim`.
//
// Each returns its problems as sentences, and none when the declarations pass.

import {
  commandsOf,
  isCommandId,
  isOwned,
  listOf,
  menuPlaces,
  type Command,
  type Declarations,
} from './declare.ts';
import {
  declaredBindings,
  holds,
  isTextEditing,
  menuArrows,
  precedence,
  startsWith,
  type Binding,
  type Focus,
} from './match.ts';
import { parseKeys, systemStrokes, writeStrokes, type Stroke, type System } from './notation.ts';
import { codeScopes, engineScopes, type Mode } from './scopes.ts';
import { fit, NO_TARGET, together, type Target, type TargetKind } from './targets.ts';
import { vimDefaults } from './vim.ts';

/** The systems Lo runs on, as the checks try each. */
export const systems: readonly System[] = ['mac', 'linux'];

/** Each system's name, as a person reads it. */
export const systemNames: Readonly<Record<System, string>> = { mac: 'macOS', linux: 'Linux' };

/**
 * The modes Vim can be in, in each code view. Nothing in the diff, a file or a peek can be edited,
 * so only a comment box has insert mode.
 */
export const codeModes: Readonly<Record<(typeof codeScopes)[number], readonly Mode[]>> = {
  diff: ['normal', 'visual'],
  file: ['normal', 'visual'],
  peek: ['normal', 'visual'],
  box: ['normal', 'visual', 'insert'],
};

/** Vim's keys in each mode, in Lo's notation, as `vimDefaults` has them. */
export type VimKeys = Readonly<Record<Mode, readonly string[]>>;

/** Where a key is pressed: a scope, Vim's mode when the scope is a code view, and the system. */
export interface Site {
  readonly scope: string;
  readonly mode: Mode | undefined;
  readonly system: System;
}

const NAME = /^[a-z][a-zA-Z0-9]*$/;

function isCodeScope(scope: string): scope is keyof typeof codeModes {
  return Object.hasOwn(codeModes, scope);
}

/** The modes a key can meet in `scope`: Vim's, in a code view, or none elsewhere. */
export function modesOf(scope: string): readonly (Mode | undefined)[] {
  return isCodeScope(scope) ? codeModes[scope] : [undefined];
}

/**
 * Every scope the declarations know: the engine's, the code views', those features declare, and
 * any a `when` names, so that a misspelt one is still tried.
 */
export function scopesOf(features: readonly Declarations[]): string[] {
  const scopes = new Set<string>([...engineScopes, ...codeScopes]);
  for (const feature of features) for (const scope of feature.scopes) scopes.add(scope);
  for (const command of features.flatMap(commandsOf)) {
    for (const scope of namedScopes(command)) scopes.add(scope);
  }
  return [...scopes];
}

/** The scopes a command's `when` names. */
function namedScopes(command: Command): readonly string[] {
  return [...listOf(command.when?.scope), ...(command.when?.except ?? [])];
}

/** The focus a key pressed at `site` is matched with, with nothing typed or pending. */
export function focusAt(site: Site): Focus {
  return site.mode === undefined
    ? { scope: site.scope, text: false }
    : { scope: site.scope, text: false, view: { mode: site.mode, pending: false } };
}

/** The systems `command` is on. */
export function systemsOf(command: Command): readonly System[] {
  const only = command.when?.system;
  return only === undefined ? systems : [only];
}

/** Whether `command` has a default key on `system`. */
function hasKey(command: Command, system: System): boolean {
  return declaredBindings([command], system).length > 0;
}

/** Keys as a problem quotes them: in Lo's notation, as `system` reads them. */
function quoted(strokes: readonly Stroke[], system: System): string {
  return `\`${writeStrokes(strokes, system)}\``;
}

/** Joins words as a sentence lists them: `a`, `a and b`, `a, b and c`, or with `or`. */
export function listed(words: readonly string[], conjunction: 'and' | 'or' = 'and'): string {
  if (words.length <= 1) return words.join('');
  return `${words.slice(0, -1).join(', ')} ${conjunction} ${words.at(-1) ?? ''}`;
}

/**
 * Problems found at many sites, each said once, with every site it was found at: `in diff
 * (normal) and diff (visual), on macOS and Linux`.
 */
class Found {
  private readonly problems = new Map<string, { sites: Set<string>; systems: Set<System> }>();

  add(problem: string, site: Site): void {
    let entry = this.problems.get(problem);
    if (!entry) {
      entry = { sites: new Set(), systems: new Set() };
      this.problems.set(problem, entry);
    }
    entry.sites.add(site.mode === undefined ? site.scope : `${site.scope} (${site.mode})`);
    entry.systems.add(site.system);
  }

  list(): string[] {
    return [...this.problems].map(([problem, { sites, systems: on }]) => {
      const names = systems.filter((system) => on.has(system)).map((each) => systemNames[each]);
      return `${problem}, in ${listed([...sites])}, on ${listed(names)}.`;
    });
  }
}

/**
 * Names: each feature's is a folder's name and its own, each command's id is `<feature>.<name>`
 * and its own, each scope a feature declares is declared once and isn't the engine's or a code
 * view's, and every scope a `when` names is one of those.
 */
export function checkIds(features: readonly Declarations[]): string[] {
  const problems: string[] = [];
  const builtIn = new Set<string>([...engineScopes, ...codeScopes]);
  const names = new Set<string>();
  /** Each scope a feature declares, and the feature. */
  const declared = new Map<string, string>();
  for (const { feature, scopes } of features) {
    if (!NAME.test(feature)) problems.push(`"${feature}" isn’t a feature’s name, such as diff.`);
    if (names.has(feature)) problems.push(`Two features are called ${feature}.`);
    names.add(feature);
    for (const scope of scopes) {
      const other = declared.get(scope);
      if (!NAME.test(scope)) {
        problems.push(`${feature} declares the scope "${scope}", which isn’t a scope’s name.`);
      } else if (builtIn.has(scope)) {
        problems.push(`${feature} declares the scope ${scope}, which the engine already has.`);
      } else if (other !== undefined) {
        problems.push(`${other} and ${feature} both declare the scope ${scope}.`);
      } else {
        declared.set(scope, feature);
      }
    }
  }
  const ids = new Set<string>();
  for (const command of features.flatMap(commandsOf)) {
    if (!isCommandId(command.id)) {
      problems.push(`"${command.id}" isn’t a command’s id, such as diff.markViewed.`);
    }
    if (ids.has(command.id)) problems.push(`Two commands are called ${command.id}.`);
    ids.add(command.id);
    for (const scope of new Set(namedScopes(command))) {
      if (!builtIn.has(scope) && !declared.has(scope)) {
        problems.push(`${command.id} names the scope ${scope}, which no feature declares.`);
      }
    }
  }
  return problems;
}

/**
 * Handlers: every command but Vim's own has exactly one in `given`, the commands the window's
 * features give the registry, and Vim's own have none. Every command in `given` is one a `keys.ts`
 * declares, as it declares it, so the docs and the checks, which read `keys.ts`, see what the app
 * runs.
 */
export function checkHandlers(
  features: readonly Declarations[],
  given: readonly Command[],
): string[] {
  const problems: string[] = [];
  const declared = new Map(features.flatMap(commandsOf).map((command) => [command.id, command]));
  const counts = new Map<string, number>();
  for (const command of given) {
    const declaration = declared.get(command.id);
    if (!declaration) {
      problems.push(`${command.id} is in the window’s commands, but no keys.ts declares it.`);
      continue;
    }
    if (!sameDeclaration(command, declaration)) {
      problems.push(`${command.id} in the window’s commands isn’t as its keys.ts declares it.`);
    }
    if (command.handler) counts.set(command.id, (counts.get(command.id) ?? 0) + 1);
  }
  for (const [id, command] of declared) {
    const count = counts.get(id) ?? 0;
    if (isOwned(command)) {
      if (count > 0) {
        const whose = command.editor ? 'its scope’s editor’s own key' : 'one of Vim’s own keys';
        problems.push(`${id} is ${whose}, which nothing runs, but has a handler.`);
      }
    } else if (count === 0) {
      problems.push(`${id} has no handler.`);
    } else if (count > 1) {
      problems.push(`${id} has ${count} handlers.`);
    }
  }
  return problems;
}

/** A command's fields, but its handler. */
function fields(command: Command): [string, unknown][] {
  return Object.entries(command).filter(([key]) => key !== 'handler');
}

/** Whether `command` has `declaration`'s fields, each the same value, and no others but a handler. */
function sameDeclaration(command: Command, declaration: Command): boolean {
  const given = fields(command);
  const wanted = new Map(fields(declaration));
  return (
    given.length === wanted.size &&
    given.every(([key, value]) => wanted.has(key) && Object.is(wanted.get(key), value))
  );
}

/**
 * Whether `command` has no key on purpose: it's declared with `keys: []`, for something done once
 * in a while, and something drawn reaches it, besides the palette, which lists every command: its
 * control, a right-click menu or the app menu.
 */
export function keyless(command: Command): boolean {
  return (
    command.keys.length === 0 &&
    (command.control !== undefined || command.bar !== undefined || command.menu !== undefined)
  );
}

/**
 * Whether the mouse reaches `command`: by a control drawn where its target is (`control`), a
 * right-click menu (`menu`) or the app menu (`bar`). One of Vim's own keys has no route to have:
 * Lo documents it and never runs it.
 */
export function routed(command: Command): boolean {
  return (
    command.vim === 'own' ||
    command.control !== undefined ||
    command.menu !== undefined ||
    command.bar !== undefined
  );
}

/** A menu of the app menu, by its name, and the names of its sections that commands join. */
export interface BarMenuNames {
  readonly menu: string;
  readonly sections: readonly string[];
}

/**
 * The app menu: every command in it names a menu and a section of it that `menus`, the app's list,
 * has, and one command a place takes the place of (`instead`) is in the app menu too.
 */
export function checkBar(
  features: readonly Declarations[],
  menus: readonly BarMenuNames[],
): string[] {
  const commands = features.flatMap(commandsOf);
  const inBar = new Set(commands.filter((command) => command.bar).map((command) => command.id));
  return commands.flatMap((command) => {
    const { bar } = command;
    if (!bar) return [];
    const menu = menus.find((each) => each.menu === bar.menu);
    if (!menu)
      return [`${command.id} is in the app menu’s ${bar.menu} menu, which it doesn’t have.`];
    const problems = menu.sections.includes(bar.section)
      ? []
      : [
          `${command.id} is in the ${bar.menu} menu’s ${bar.section} section, which it doesn’t have.`,
        ];
    if (bar.instead !== undefined && !inBar.has(bar.instead)) {
      problems.push(
        `${command.id} takes the place of ${bar.instead} in the app menu, which isn’t in it.`,
      );
    }
    return problems;
  });
}

/**
 * Toggles: every command declared a `toggle` has a handler that says whether it's checked, and
 * only toggles have one, so the app menu never draws a switch with no check, nor a check on an
 * action.
 */
export function checkToggles(
  features: readonly Declarations[],
  given: readonly Command[],
): string[] {
  const handled = new Map(given.map((command) => [command.id, command.handler]));
  return features.flatMap(commandsOf).flatMap((command) => {
    const checked = handled.get(command.id)?.checked !== undefined;
    if (command.toggle !== undefined && !checked) {
      return [
        `${command.id} is a ${command.toggle}, but its handler doesn’t say when it’s checked.`,
      ];
    }
    if (command.toggle === undefined && checked) {
      return [`${command.id} says when it’s checked, but isn’t declared a switch or a choice.`];
    }
    return [];
  });
}

/**
 * Routes: every command names how the mouse reaches it, so no action is the keyboard's alone.
 * `without` lists the ids of the commands that have no route yet. The list only shrinks: a command
 * on it that has gained a route, or is gone, fails too, so it comes off the list in the change
 * that gives it one, and a new command can never join it.
 */
export function checkRoutes(
  features: readonly Declarations[],
  without: readonly string[] = [],
): string[] {
  const commands = features.flatMap(commandsOf);
  const byId = new Map(commands.map((command) => [command.id, command]));
  const waiting = new Set(without);
  return [
    ...commands
      .filter((command) => !routed(command) && !waiting.has(command.id))
      .map(
        (command) =>
          `${command.id} has no control, right-click menu or app menu item: only its key runs it.`,
      ),
    ...without.flatMap((id) => {
      const command = byId.get(id);
      if (!command)
        return [`${id} is listed as having no mouse route, but no feature declares it.`];
      return routed(command)
        ? [`${id} is listed as having no mouse route, but it has one now.`]
        : [];
    }),
  ];
}

/** Keys: every command has a default key on each system it's on, unless it's {@link keyless}. */
export function checkKeys(features: readonly Declarations[]): string[] {
  return features.flatMap(commandsOf).flatMap((command) =>
    systemsOf(command)
      .filter(() => !keyless(command))
      .filter((system) => !hasKey(command, system))
      .map((system) => `${command.id} has no key on ${systemNames[system]}.`),
  );
}

/**
 * Text-editing keys: an editable field keeps the keys that edit its text (`textEditingKeys`), so a
 * command bound to one never runs while a field has focus. Each such command says how it's meant:
 * it edits that field itself (`editsField`), every scope it applies in is one of `fieldless`,
 * which hold no field, or it's one of `kept`, which run everywhere else and leave the key to a
 * field that has focus. Any other, for anywhere or for a scope that can hold one, fails, named with
 * its keys. So does one that says `editsField` with no such key, a scope in `fieldless` that no
 * feature declares, or that's a code view's, which holds Vim's prompt and its search, and a command
 * in `kept` that no feature declares, or that a field no longer keeps a key of.
 */
export function checkEditingKeys(
  features: readonly Declarations[],
  fieldless: readonly string[],
  kept: readonly string[] = [],
): string[] {
  const problems: string[] = [];
  const declared = new Set(features.flatMap(commandsOf).map(({ id }) => id));
  for (const id of kept) {
    if (!declared.has(id)) {
      problems.push(`${id} is listed as leaving its key to a field, but no feature declares it.`);
    }
  }
  const keeps = new Set(kept);
  const known = new Set(scopesOf(features));
  const views = new Set<string>(codeScopes);
  for (const scope of fieldless) {
    if (views.has(scope)) {
      problems.push(`${scope} is listed as holding no field, but it’s a code view.`);
    } else if (!known.has(scope)) {
      problems.push(`${scope} is listed as holding no field, but no feature declares it.`);
    }
  }
  const noField = new Set(fieldless.filter((scope) => known.has(scope) && !views.has(scope)));
  for (const command of features.flatMap(commandsOf)) {
    // Vim's own keys and an editor's never run as Lo's.
    if (isOwned(command)) continue;
    const keys = systemsOf(command).flatMap((system) =>
      declaredBindings([command], system)
        .filter(({ strokes }) => strokes.some((each) => isTextEditing(each, system)))
        .map(({ strokes }) => quoted(strokes, system)),
    );
    if (command.editsField === true) {
      if (keys.length === 0) {
        problems.push(`${command.id} says editsField, but none of its keys edits text.`);
      }
      continue;
    }
    const scopes = listOf(command.when?.scope);
    const fine =
      keys.length === 0 || (scopes.length > 0 && scopes.every((scope) => noField.has(scope)));
    if (keeps.has(command.id)) {
      if (fine) {
        problems.push(
          `${command.id} is listed as leaving its key to a field, but a field keeps none of its keys.`,
        );
      }
      continue;
    }
    if (fine) continue;
    const named = [...new Set(keys)];
    problems.push(
      `${listed(named)} (${command.id}) ${named.length === 1 ? 'edits' : 'edit'} text, which a field that has focus keeps: give the command scopes that hold no field, or editsField if it edits that field itself.`,
    );
  }
  return problems;
}

/** A target of `kind`, with all it can give: a line has a thread on it, so it gives a file too. */
function sampleTarget(kind: TargetKind): Target {
  switch (kind) {
    case 'line':
      return { kind, at: { file: 'f', side: 'new', line: 1 }, thread: 't' };
    case 'header':
      return { kind, file: 'f', side: 'new' };
    case 'file':
      return { kind, file: 'f' };
    case 'thread':
      return { kind, thread: 't' };
    case 'draft':
    case 'note':
      return { kind, at: { file: 'f', side: 'new', line: 1 } };
    case 'layer':
      return { kind, layer: 1 };
    case 'block':
      return { kind, block: 'b' };
    case 'tab':
      return { kind, tab: 't' };
    case 'row':
      return { kind, row: 'r' };
    case 'box':
      return { kind, box: 'b' };
    case 'lines':
      return { kind, box: 'b' };
    case 'notice':
      return { kind, notice: 'n', tab: 't', pull: 1 };
    case 'none':
      return NO_TARGET;
    default:
      kind satisfies never;
      throw new Error(`There’s no target of kind ${String(kind)}.`);
  }
}

/**
 * Menus: an item in a right-click menu has a key on each system its command is on, and takes the
 * kind of target the menu is for; one in the app menu has a key on macOS, the only system with one.
 */
export function checkMenus(features: readonly Declarations[]): string[] {
  const problems: string[] = [];
  for (const command of features.flatMap(commandsOf)) {
    // A command with no key on purpose has none to show in its menu.
    const on = keyless(command) ? [] : systemsOf(command);
    for (const place of menuPlaces(command)) {
      for (const system of on.filter((each) => !hasKey(command, each))) {
        problems.push(
          `${command.id} is in the right-click menu of a ${place.on}, with no key on ${systemNames[system]}.`,
        );
      }
      const takes = command.targets ?? ['none'];
      if (fit(takes, sampleTarget(place.on)) === undefined) {
        problems.push(
          `${command.id} is in the right-click menu of a ${place.on}, but acts on ${listed(takes, 'or')}.`,
        );
      }
    }
    if (command.bar && on.includes('mac') && !hasKey(command, 'mac')) {
      problems.push(
        `${command.id} is in the app menu’s ${command.bar.menu} menu, with no key on macOS.`,
      );
    }
  }
  return problems;
}

/**
 * Clashes: in each scope, mode and system, no two of Lo's bindings that hold there claim the same
 * key, nor one the start of another's sequence (a lone `g` against `g S`), since one of the two
 * would never run. Lo's motions count in code views, where Vim runs them. The one exception is the
 * rule matching follows: a command for what the key acts on beats one for the focused scope, and
 * one for the focused scope beats one for anywhere, on the same keys, so `z a` can collapse a
 * thread on one and the file elsewhere, and `⌘⏎` can add to the review in a box and submit it
 * elsewhere, unless the key is one the box's
 * editor handles itself (`editor`), which a command for anywhere would take from it. Two for what
 * the key acts on never meet where no one target gives both (`together`): `⏎` shows a thread on
 * one, and opens a draft on another. A motion
 * against another command in a code view has no such exception, since matching never takes the
 * motion there. Nor may a binding start with a key the engine takes first: `j` or `k` in a menu.
 */
export function checkClashes(features: readonly Declarations[]): string[] {
  const commands = features.flatMap(commandsOf).filter((command) => command.vim !== 'own');
  const scopes = scopesOf(features);
  const found = new Found();
  for (const system of systems) {
    const bindings = declaredBindings(commands, system);
    for (const scope of scopes) {
      for (const mode of modesOf(scope)) {
        const site: Site = { scope, mode, system };
        const focus = focusAt(site);
        const here = bindings.filter((binding) => holds(binding, focus, system));
        here.forEach((first, index) => {
          const taken = engineTakes(first, site);
          if (taken !== undefined) found.add(taken, site);
          for (const second of here.slice(index + 1)) {
            const problem = clash(first, second, site);
            if (problem !== undefined) found.add(problem, site);
          }
        });
      }
    }
  }
  return found.list();
}

/**
 * Why a binding never runs at `site` because the engine takes its first key there, if it doesn't:
 * in a menu, `j` and `k` move as the arrows do.
 */
function engineTakes(binding: Binding, site: Site): string | undefined {
  const first = binding.strokes[0];
  if (site.scope !== 'menu' || first === undefined || !Object.hasOwn(menuArrows, first.id)) {
    return undefined;
  }
  return `${quoted(binding.strokes, site.system)} (${binding.command.id}) never runs, since \`j\` and \`k\` move as the arrows do`;
}

/** How two bindings that hold at the same site clash there, if they do. */
function clash(a: Binding, b: Binding, site: Site): string | undefined {
  const { system } = site;
  // Each for what the key acts on, where no one target gives both: only one ever holds.
  const on = [a.command.when?.on, b.command.when?.on] as const;
  if (on[0] !== undefined && on[1] !== undefined && !together(on[0], on[1])) return undefined;
  const [short, long] = a.strokes.length <= b.strokes.length ? [a, b] : [b, a];
  if (!startsWith(long.strokes, short.strokes)) return undefined;
  if (short.strokes.length === long.strokes.length) {
    // The same key written twice for one command.
    if (a.command === b.command) return undefined;
    // A scope's command beats one for anywhere on the same keys, but not in a code view when one
    // of the two is a motion: matching never takes a motion there, so Lo's other command takes
    // the key before Vim, and the motion never runs.
    const motion = a.command.vim === 'motion' || b.command.vim === 'motion';
    // Nor in one an editor handles itself: matching never takes it, so a command for anywhere that
    // holds there takes the key from the editor.
    const owned = a.command.editor === true || b.command.editor === true;
    // One for what the key acts on beats one for the scope or anywhere, as one for the scope
    // beats one for anywhere.
    const overridden = precedence(a.command) !== precedence(b.command);
    if (overridden && !owned && !(motion && site.mode !== undefined)) return undefined;
    return `${quoted(a.strokes, system)} runs both ${a.command.id} and ${b.command.id}`;
  }
  return `${quoted(short.strokes, system)} (${short.command.id}) starts ${quoted(long.strokes, system)} (${long.command.id})`;
}

/** One of Lo's keys meeting one of Vim's in a code view: the same keys, or one starting the other. */
export interface VimMeeting {
  readonly binding: Binding;
  readonly site: Site;
  /** Vim's key, in Lo's notation. */
  readonly vim: string;
}

/** Where `commands`' keys meet Vim's, in every code view, mode and system. */
export function vimMeetings(
  commands: readonly Command[],
  vim: VimKeys = vimDefaults,
): VimMeeting[] {
  const meetings: VimMeeting[] = [];
  const lo = commands.filter((command) => command.vim !== 'own');
  for (const system of systems) {
    const bindings = declaredBindings(lo, system);
    for (const scope of codeScopes) {
      for (const mode of codeModes[scope]) {
        const site: Site = { scope, mode, system };
        const focus = focusAt(site);
        const keys = vim[mode].map((each) => ({
          keys: each,
          strokes: systemStrokes(parseKeys(each), system),
        }));
        for (const binding of bindings) {
          if (!holds(binding, focus, system)) continue;
          for (const each of keys) {
            if (meet(binding.strokes, each.strokes)) {
              meetings.push({ binding, site, vim: each.keys });
            }
          }
        }
      }
    }
  }
  return meetings;
}

/** Whether two sequences are the same, or one starts the other. */
function meet(a: readonly Stroke[], b: readonly Stroke[]): boolean {
  return startsWith(a, b) || startsWith(b, a);
}

/**
 * Vim: in a code view, a key of Lo's that is one of Vim's, starts one (a lone `g` against `g g`)
 * or starts with one Vim reads another key after (`y l` against the operator `y`) is there only on
 * purpose, with `overVim`. A command that says `overVim` has a key that meets one of Vim's, and one
 * declared as Vim's own (`vim: 'own'`) is one of Vim's keys.
 */
export function checkVim(features: readonly Declarations[], vim: VimKeys = vimDefaults): string[] {
  const commands = features.flatMap(commandsOf);
  const meetings = vimMeetings(commands, vim);
  const found = new Found();
  for (const { binding, site, vim: theirs } of meetings) {
    if (binding.command.overVim) continue;
    found.add(
      `${quoted(binding.strokes, site.system)} (${binding.command.id}) meets Vim’s \`${theirs}\` without overVim`,
      site,
    );
  }
  const problems = found.list();
  const over = new Set(meetings.map((meeting) => meeting.binding.command));
  for (const command of commands) {
    if (command.overVim && command.vim !== 'own' && !over.has(command)) {
      problems.push(`${command.id} says overVim, but none of its keys meets one of Vim’s.`);
    }
  }
  for (const command of commands.filter((each) => each.vim === 'own')) {
    for (const system of systemsOf(command)) {
      for (const { strokes } of declaredBindings([command], system)) {
        const known = Object.values(vim).some((keys) =>
          keys.some((each) => meet(strokes, systemStrokes(parseKeys(each), system))),
        );
        if (!known) {
          problems.push(
            `${command.id} is declared as Vim’s own, but ${quoted(strokes, system)} isn’t one of Vim’s keys.`,
          );
        }
      }
    }
  }
  return [...new Set(problems)];
}
