// What key help (`?`) and the command palette (`⌘⇧P`) show, read from the registry: each
// command's live keys in this system's form, where they apply, and whether they're Vim's.

import { groups, listOf, type Command, type Group } from './declare.ts';
import { keyLabels } from './notation.ts';
import type { Registry } from './registry.ts';
import type { Target } from './targets.ts';

/** One command in key help. */
export interface HelpRow {
  readonly id: string;
  readonly label: string;
  /** Its keys now, the keymap file's first: one list of key labels per sequence (`⌘⇧P`, `] f`). */
  readonly keys: readonly (readonly string[])[];
  /** Where its keys apply, in words, or nothing when they apply anywhere. */
  readonly where: string | undefined;
  /** One of Vim's own keys, which key help lists and Lo never takes. */
  readonly vim: boolean;
  /** Its keys take one of Vim's in code views. */
  readonly overVim: boolean;
}

/** One of key help's groups, in the key table's order. */
export interface HelpGroup {
  readonly group: Group;
  readonly rows: readonly HelpRow[];
}

/** How a person reads each of the engine's and the code views' scopes. */
const scopeWords: Readonly<Record<string, string>> = {
  window: 'the window',
  menu: 'menus',
  dialog: 'dialogs',
  palette: 'palettes',
  diff: 'the diff',
  file: 'file views',
  peek: 'peeks',
  box: 'comment boxes',
};

/** Joins words as a sentence lists them: `a`, `a and b`, `a, b or c`. */
function joined(items: readonly string[], conjunction: 'and' | 'or'): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} ${conjunction} ${items.at(-1) ?? ''}`;
}

/** Scopes as a person reads them. */
function named(scopes: readonly string[]): string[] {
  return scopes.map((scope) => scopeWords[scope] ?? scope);
}

/** Where `command`'s keys apply, in words: `In the diff and tree`, `Not in comment boxes`. */
export function whereText(command: Command): string | undefined {
  const { when } = command;
  const parts: string[] = [];
  const scopes = listOf(when?.scope);
  if (scopes.length > 0) parts.push(`In ${joined(named(scopes), 'and')}`);
  const except = when?.except ?? [];
  if (except.length > 0)
    parts.push(`${parts.length > 0 ? 'not' : 'Not'} in ${joined(named(except), 'or')}`);
  const modes = listOf(when?.mode);
  if (modes.length > 0) parts.push(`in Vim's ${joined(modes, 'or')} mode`);
  if (parts.length === 0) return undefined;
  return parts.join(', ');
}

/** Whether `command` is on the registry's system. */
function onSystem(registry: Registry, command: Command): boolean {
  return command.when?.system === undefined || command.when.system === registry.system;
}

/** `command`'s keys now, in this system's form. */
function liveKeys(registry: Registry, command: Command): (readonly string[])[] {
  return registry.keysOf(command.id).map((strokes) => keyLabels(strokes, registry.system));
}

/**
 * Key help's groups, in the key table's order: every command on this system, each with its keys
 * as they are now, the keymap file's included.
 */
export function helpGroups(registry: Registry): HelpGroup[] {
  const commands = registry.commands().filter((command) => onSystem(registry, command));
  return groups.flatMap((group): HelpGroup[] => {
    const rows = commands
      .filter((command) => command.group === group)
      .map((command): HelpRow => ({
        id: command.id,
        label: command.label,
        keys: liveKeys(registry, command),
        where: whereText(command),
        vim: command.vim === 'own',
        overVim: command.overVim === true,
      }));
    return rows.length > 0 ? [{ group, rows }] : [];
  });
}

/** Lowercase words, for matching what someone types against what's shown. */
function words(text: string): string[] {
  return text.toLowerCase().split(/\s+/).filter(Boolean);
}

/**
 * The groups with only the rows that match `query`: each word of it is in the row's label, its
 * group's name, its id or one of its keys. A group whose name matches keeps every row.
 */
export function filterHelp(all: readonly HelpGroup[], query: string): HelpGroup[] {
  const wanted = words(query);
  if (wanted.length === 0) return [...all];
  const matches = (text: string) => wanted.every((word) => text.includes(word));
  return all.flatMap((each): HelpGroup[] => {
    if (matches(each.group.toLowerCase())) return [each];
    const rows = each.rows.filter((row) => {
      const keys = row.keys.map((sequence) => sequence.join(' ')).join(' ');
      return matches(`${row.label} ${each.group} ${row.id} ${keys}`.toLowerCase());
    });
    return rows.length > 0 ? [{ group: each.group, rows }] : [];
  });
}

/** One command in the palette. */
export interface PaletteItem {
  readonly id: string;
  readonly label: string;
  readonly group: Group;
  /** Its first key now, as labels in this system's form, if it has one. */
  readonly keys: readonly string[] | undefined;
}

/** Whether `command`'s `when` lets it run from `scope`, ignoring Vim's mode. */
function appliesIn(command: Command, scope: string): boolean {
  const { when } = command;
  if (when?.scope !== undefined && !listOf(when.scope).includes(scope)) return false;
  return !when?.except?.includes(scope);
}

/**
 * The palette's commands, for what had focus before it opened: `scope` and `target`. Every command
 * on this system that applies there and can run on the target now, in the key table's order, but
 * Vim's own keys, which nothing runs.
 */
export function paletteItems(registry: Registry, scope: string, target: Target): PaletteItem[] {
  const commands = registry
    .commands()
    .filter(
      (command) =>
        command.vim !== 'own' &&
        onSystem(registry, command) &&
        appliesIn(command, scope) &&
        registry.enabled(command.id, target) === true,
    );
  return groups.flatMap((group) =>
    commands
      .filter((command) => command.group === group)
      .map((command) => ({
        id: command.id,
        label: command.label,
        group,
        keys: liveKeys(registry, command)[0],
      })),
  );
}

/** A palette item that matches what's typed, with the letters of its label that matched. */
export interface PaletteMatch {
  readonly item: PaletteItem;
  /** Indexes into the label of the letters the query matched, to mark. */
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
 * else every word of it in the command's group or id. With nothing typed, every item, in order.
 */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteMatch[] {
  if (query.trim() === '') return items.map((item) => ({ item, marks: [] }));
  const wanted = words(query);
  const scored = items.flatMap((item, index) => {
    const label = matchLabel(item.label, query);
    if (label) return [{ item, marks: label.marks, score: label.score, index }];
    const other = `${item.group} ${item.id}`.toLowerCase();
    return wanted.every((word) => other.includes(word))
      ? [{ item, marks: [], score: -100, index }]
      : [];
  });
  return scored
    .toSorted((a, b) => b.score - a.score || a.index - b.index)
    .map(({ item, marks }) => ({ item, marks }));
}
