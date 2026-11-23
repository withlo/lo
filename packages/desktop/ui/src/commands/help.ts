// What keyboard shortcuts (`?`) and the command palette (`⌘⇧P`) show, read from the registry: each
// command's live keys in this system's form, the area of the window they work in, and whether
// they're Vim's.

import { groups, isOwned, listOf, type Command, type Group } from './declare.ts';
import { ariaShortcut, keyLabels } from './notation.ts';
import type { Registry } from './registry.ts';
import type { Target } from './targets.ts';

/** One line of keyboard shortcuts: a command, or the commands of one area with one label. */
export interface HelpRow {
  /** The first command's id, which a search or "Show key" finds the row by. */
  readonly id: string;
  /** Every command the line stands for, the first's first. */
  readonly ids: readonly string[];
  readonly label: string;
  /** Its one line under the label, if it has one. */
  readonly description: string | undefined;
  /** Its keys now, the keymap file's first: one list of key labels per sequence (`⌘⇧P`, `] f`). */
  readonly keys: readonly (readonly string[])[];
  /** One of Vim's own keys, which keyboard shortcuts lists and Lo never takes. */
  readonly vim: boolean;
  /** One of an editor's own keys, such as the comment box's: listed, never run, and fixed. */
  readonly editor: boolean;
  /** Its keys take one of Vim's in code views. */
  readonly overVim: boolean;
}

/** One of keyboard shortcuts' groups, in the groups' order. */
export interface HelpGroup {
  readonly group: Group;
  readonly rows: readonly HelpRow[];
}

/** One area of the window, as keyboard shortcuts has a tab for it: a focus scope, by its name. */
export interface HelpArea {
  /** The scope, as `data-lo-scope` names it. */
  readonly scope: string;
  readonly name: string;
  readonly groups: readonly HelpGroup[];
}

/**
 * The window's areas, in keyboard shortcuts' order, each scope by the name its tab has. A scope
 * named the same as another is part of its area, as the line under Settings' search that matches
 * nothing is part of Settings. A menu has no tab: it shows its own keys.
 */
const areas: readonly (readonly [scope: string, name: string])[] = [
  ['window', 'Anywhere'],
  ['diff', 'Diff'],
  ['file', 'Whole file'],
  ['peek', 'Definitions'],
  ['references', 'References'],
  ['box', 'Comment box'],
  ['threads', 'Threads panel'],
  ['tree', 'Files'],
  ['stack', 'Stack'],
  ['overview', 'Overview'],
  ['timeline', 'Timeline'],
  ['revisions', 'Revisions'],
  ['merge', 'Merge panel'],
  ['commit', 'Commit message'],
  ['queue', 'Merge queue'],
  ['recent', 'Recent'],
  ['settings', 'Settings'],
  ['noMatch', 'Settings'],
  ['welcome', 'Welcome'],
  ['palette', 'Command palette'],
  ['dialog', 'Sign-in'],
];

/** The area `scope` is part of, by its first scope, or none for a scope with no tab. */
function areaOf(scope: string): string | undefined {
  const name = areas.find(([each]) => each === scope)?.[1];
  return name === undefined ? undefined : areas.find(([, each]) => each === name)?.[0];
}

/** What keyboard shortcuts lists. */
export interface HelpOptions {
  /**
   * Vim keys are on: Vim's own keys and those that take one of Vim's are tagged, and those only Vim
   * has, `vimOnly`, are listed.
   */
  readonly vim: boolean;
  /** Whether `command` is one of Vim's own keys that only Vim has, such as `v`. */
  readonly vimOnly?: ((command: Command) => boolean) | undefined;
  /** Commands with no key are listed too, as "Show all commands" asks. */
  readonly all?: boolean | undefined;
}

/** Whether `command` is on the registry's system. */
export function onSystem(registry: Registry, command: Command): boolean {
  return command.when?.system === undefined || command.when.system === registry.system;
}

/** `command`'s keys now, in this system's form. */
export function liveKeys(registry: Registry, command: Command): (readonly string[])[] {
  return registry.keysOf(command.id).map((strokes) => keyLabels(strokes, registry.system));
}

/**
 * `command`'s first key now as `aria-keyshortcuts` says it, which a control gives a screen reader
 * in place of its key caps. A sequence has none.
 */
export function liveShortcut(registry: Registry, command: Command): string | undefined {
  const [first] = registry.keysOf(command.id);
  return first && ariaShortcut(first);
}

/** The commands keyboard shortcuts lists on the registry's system, with `options`. */
function listedCommands(registry: Registry, options: HelpOptions): Command[] {
  return registry
    .commands()
    .filter(
      (command) =>
        onSystem(registry, command) &&
        (options.vim || !(options.vimOnly?.(command) ?? false)) &&
        (options.all === true || registry.keysOf(command.id).length > 0),
    );
}

/** `commands` as rows in the groups' order, those of one group with one label as one row. */
function grouped(registry: Registry, commands: readonly Command[], vim: boolean): HelpGroup[] {
  return groups.flatMap((group): HelpGroup[] => {
    const rows: HelpRow[] = [];
    for (const command of commands.filter((each) => each.group === group)) {
      const keys = liveKeys(registry, command);
      const at = rows.findIndex((row) => row.label === command.label);
      const same = rows[at];
      if (same) {
        const known = new Set(same.keys.map((each) => each.join(' ')));
        rows[at] = {
          ...same,
          ids: [...same.ids, command.id],
          keys: [...same.keys, ...keys.filter((each) => !known.has(each.join(' ')))],
          description: same.description ?? command.description,
        };
        continue;
      }
      rows.push({
        id: command.id,
        ids: [command.id],
        label: command.label,
        description: command.description,
        keys,
        vim: vim && command.vim === 'own',
        editor: command.editor === true,
        overVim: vim && command.overVim === true,
      });
    }
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

/** The areas `command`'s keys work in: the scopes it names, or Anywhere. */
function areasOfCommand(command: Command): string[] {
  const scopes = listOf(command.when?.scope);
  const named = (scopes.length > 0 ? scopes : ['window']).flatMap((scope) => areaOf(scope) ?? []);
  return [...new Set(named)];
}

/**
 * Keyboard shortcuts' areas, in their order: each with the commands whose keys work there, by
 * group. A command for anywhere is in Anywhere, and one for some scopes in each of theirs. An area
 * with nothing to list isn't there.
 */
export function helpAreas(registry: Registry, options: HelpOptions): HelpArea[] {
  const commands = listedCommands(registry, options);
  return areas.flatMap(([scope, name]): HelpArea[] => {
    if (areaOf(scope) !== scope) return [];
    const here = commands.filter((command) => areasOfCommand(command).includes(scope));
    const listed = grouped(registry, here, options.vim);
    return listed.length > 0 ? [{ scope, name, groups: listed }] : [];
  });
}

/** Whether `command`'s `when` lets it run from `scope`, ignoring Vim's mode. */
function appliesIn(command: Command, scope: string): boolean {
  const { when } = command;
  if (when?.scope !== undefined && !listOf(when.scope).includes(scope)) return false;
  return !when?.except?.includes(scope);
}

/**
 * The keys that work in what had focus, keyboard shortcuts' first tab, "Here": every command whose
 * keys apply in `scope` and can run on `target` now, by group. One that the registry never runs,
 * one of Vim's or an editor's own, is there wherever it applies.
 */
export function helpHere(
  registry: Registry,
  scope: string,
  target: Target,
  options: HelpOptions,
): HelpGroup[] {
  const commands = listedCommands(registry, options).filter(
    (command) =>
      appliesIn(command, scope) &&
      (isOwned(command) || registry.enabled(command.id, target) === true),
  );
  return grouped(registry, commands, options.vim);
}

/**
 * Every command keyboard shortcuts lists, by group, for a search, which looks through every area
 * at once.
 */
export function helpAll(registry: Registry, options: HelpOptions): HelpGroup[] {
  return grouped(registry, listedCommands(registry, options), options.vim);
}

/** The area keyboard shortcuts shows command `id` in: the first it works in. */
export function areaOfCommand(registry: Registry, id: string): string | undefined {
  const command = registry.command(id);
  return command && areasOfCommand(command)[0];
}

/** Lowercase words, for matching what someone types against what's shown. */
function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/** A label as it reads, with no backticks around what's set as code. */
export function plainLabel(label: string): string {
  return label.replaceAll('`', '');
}

/**
 * The groups with only the rows that match `query`: each word of it is in the row's label, its
 * description, its group's name, an id or one of its keys. A group whose name matches keeps every
 * row.
 */
export function filterHelp(all: readonly HelpGroup[], query: string): HelpGroup[] {
  const wanted = words(query);
  if (wanted.length === 0) return [...all];
  const matches = (text: string) => wanted.every((word) => text.includes(word));
  return all.flatMap((each): HelpGroup[] => {
    if (matches(each.group.toLowerCase())) return [each];
    const rows = each.rows.filter((row) => {
      const keys = row.keys.map((sequence) => sequence.join(' ')).join(' ');
      const said = `${plainLabel(row.label)} ${row.description ?? ''}`;
      return matches(`${said} ${each.group} ${row.ids.join(' ')} ${keys}`.toLowerCase());
    });
    return rows.length > 0 ? [{ group: each.group, rows }] : [];
  });
}

/** One command in the palette. */
export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  /** Its one line under the label, if it has one. */
  readonly description: string | undefined;
  readonly group: Group;
  /** Its first key now, as labels in this system's form, if it has one. */
  readonly keys: readonly string[] | undefined;
  /** That key as `aria-keyshortcuts` says it, if it's one key or a chord. */
  readonly shortcut: string | undefined;
}

/** The palette's own command, which it doesn't list. */
const PALETTE = 'keys.palette';

/**
 * The palette's commands, for what had focus before it opened: `scope` and `target`. Every command
 * on this system that applies there and can run on the target now, in the groups' order, but Vim's
 * own keys and an editor's, which nothing here runs, and the palette's own.
 */
export function paletteItems(registry: Registry, scope: string, target: Target): PaletteItem[] {
  const commands = registry
    .commands()
    .filter(
      (command) =>
        !isOwned(command) &&
        command.id !== PALETTE &&
        onSystem(registry, command) &&
        appliesIn(command, scope) &&
        registry.enabled(command.id, target) === true,
    );
  return groups.flatMap((group) =>
    commands
      .filter((command) => command.group === group)
      .map((command) => ({
        id: command.id,
        label: withDetail(
          registry.labelled(command.id, target) ?? command.label,
          registry.detail(command.id, target),
        ),
        description: command.description,
        group,
        keys: liveKeys(registry, command)[0],
        shortcut: liveShortcut(registry, command),
      })),
  );
}

/** A command's label with what its handler says of it now, if anything: "Submit review · 3 pending". */
function withDetail(label: string, detail: string | undefined): string {
  return detail === undefined || detail === '' ? label : `${label} · ${detail}`;
}

/** A palette item that matches what's typed, with the letters of its label that matched. */
export interface PaletteMatch {
  readonly item: PaletteItem;
  /** Indexes into the label as it reads, without backticks, of the letters matched, to mark. */
  readonly marks: readonly number[];
}

/**
 * The letters of `query` (spaces aside) in `label` in order, preferring the starts of words and
 * runs of letters, and a score for how well they match: none when they don't all appear.
 */
function matchLabel(label: string, query: string): { marks: number[]; score: number } | undefined {
  const text = label.toLowerCase();
  const letters = query.toLowerCase().replace(/\s+/g, '');
  const marks: number[] = [];
  let score = 0;
  let from = 0;
  for (let position = 0; position < letters.length; position++) {
    const letter = letters[position];
    // The next start of a word with the letter, or else the next place it appears at all.
    let at = -1;
    for (let index = from; index < text.length; index++) {
      if (text[index] !== letter) continue;
      if (at === -1) at = index;
      if (index === 0 || text[index - 1] === ' ') {
        at = index;
        break;
      }
    }
    // Keep a run going rather than jump to a later word.
    if (text[from] === letter && marks.at(-1) === from - 1) at = from;
    if (at === -1) return undefined;
    const previous = marks.at(-1);
    if (previous !== undefined && at === previous + 1) score += 3;
    if (at === 0 || text[at - 1] === ' ') score += 2;
    score -= (at - from) * 0.01;
    marks.push(at);
    from = at + 1;
  }
  return { marks, score };
}

/**
 * The palette's items that match `query`, the best first: its letters in order in the label, or
 * else every word of it in the command's description, group or id. With nothing typed, every item,
 * in order.
 */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteMatch[] {
  if (query.trim() === '') return items.map((item) => ({ item, marks: [] }));
  const wanted = words(query);
  const scored = items.flatMap((item, index) => {
    const label = matchLabel(plainLabel(item.label), query);
    if (label) return [{ item, marks: label.marks, score: label.score, index }];
    const other = `${item.description ?? ''} ${item.group} ${item.id}`.toLowerCase();
    return wanted.every((word) => other.includes(word))
      ? [{ item, marks: [], score: -100, index }]
      : [];
  });
  return scored
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, marks }) => ({ item, marks }));
}
