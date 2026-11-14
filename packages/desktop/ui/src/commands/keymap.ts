// The keymap file, `~/.config/lo/keymap`, in Lo's own line format:
//
//   # Mark files viewed with x instead of e.
//   bind x diff.markViewed
//   unbind e
//   vim normal Y y$
//
// - `bind <keys> <command>` adds keys to a command, in the scopes it applies in. A binding here
//   beats a default one, and a later line an earlier one.
// - `unbind <keys>` takes the keys from every command; `unbind <keys> <command>` from that one.
// - `vim <mode> <keys> <what they do>` maps Vim's keys in code views, as `:nmap` does: both sides
//   in Vim's notation. The mode is normal, visual or insert.
// - `#` starts a comment line. Keys are in Lo's notation, a sequence's keys separated by spaces.
//
// A line that can't be read or applied is reported with its number, and the others still apply.
// A `bind` doesn't apply when it names one of Vim's own keys, repeats a binding already in effect,
// or would keep another binding from running: one of the two being the start of the other where
// both apply. A line over `KEYMAP_LINE_LIMIT` characters isn't read at all.
//
// The file is the user's own, but it is text from outside: nothing in it is ever run, and a line is
// only matched against the words above.

import { isCommandId, listOf, type Command, type When } from './declare.ts';
import type { Binding } from './match.ts';
import {
  readKeys,
  systemStrokes,
  writeKeys,
  writeStrokes,
  type Sequence,
  type System,
} from './notation.ts';
import type { Mode } from './scopes.ts';

export type KeymapLine =
  | {
      readonly line: number;
      readonly kind: 'bind';
      readonly keys: Sequence;
      readonly command: string;
    }
  | {
      readonly line: number;
      readonly kind: 'unbind';
      readonly keys: Sequence;
      readonly command: string | undefined;
    }
  | {
      readonly line: number;
      readonly kind: 'vim';
      readonly mode: Mode;
      readonly keys: string;
      readonly to: string;
    };

export interface KeymapError {
  /** From 1. */
  readonly line: number;
  readonly message: string;
}

export interface Keymap {
  /** The lines that apply, in the file's order. */
  readonly lines: readonly KeymapLine[];
  readonly errors: readonly KeymapError[];
}

const modes: readonly Mode[] = ['normal', 'visual', 'insert'];

/** The longest line of a keymap file, in characters. A longer one is reported and skipped. */
export const KEYMAP_LINE_LIMIT = 1000;

/**
 * Reads a keymap file. `isCommand` says whether a command exists; without it, any id written as
 * one (`<feature>.<name>`) is taken.
 */
export function parseKeymap(text: string, isCommand?: (id: string) => boolean): Keymap {
  const lines: KeymapLine[] = [];
  const errors: KeymapError[] = [];
  const known = (id: string) => isCommandId(id) && (isCommand?.(id) ?? true);
  text
    .replace(/^﻿/, '')
    .split(/\r?\n|\r/)
    .forEach((source, index) => {
      const line = index + 1;
      if (source.length > KEYMAP_LINE_LIMIT) {
        errors.push({
          line,
          message: `This line is over ${KEYMAP_LINE_LIMIT.toLocaleString('en')} characters long, so Lo didn't read it.`,
        });
        return;
      }
      const read = readLine(source, line, known);
      if (read === undefined) return;
      if ('message' in read) errors.push(read);
      else lines.push(read);
    });
  return { lines, errors };
}

function readLine(
  source: string,
  line: number,
  known: (id: string) => boolean,
): KeymapLine | KeymapError | undefined {
  const trimmed = source.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return undefined;
  const words = trimmed.split(/\s+/);
  const [word = '', ...rest] = words;
  const error = (message: string): KeymapError => ({ line, message });
  switch (word) {
    case 'bind': {
      const command = rest.at(-1);
      if (rest.length < 2 || command === undefined) {
        return error('bind takes keys, then a command: bind x diff.markViewed.');
      }
      if (!known(command)) return error(`There's no command called ${command}.`);
      const keys = readKeys(rest.slice(0, -1).join(' '));
      if ('error' in keys) return error(keys.error);
      return { line, kind: 'bind', keys: keys.keys, command };
    }
    case 'unbind': {
      if (rest.length === 0)
        return error('unbind takes keys, and a command if only its keys go: unbind e.');
      const last = rest.at(-1) ?? '';
      const named = rest.length >= 2 && isCommandId(last);
      if (named && !known(last)) return error(`There's no command called ${last}.`);
      const keys = readKeys((named ? rest.slice(0, -1) : rest).join(' '));
      if ('error' in keys) return error(keys.error);
      return { line, kind: 'unbind', keys: keys.keys, command: named ? last : undefined };
    }
    case 'vim': {
      const [mode, keys] = rest;
      if (mode === undefined || keys === undefined || rest.length < 3) {
        return error('vim takes a mode, keys and what they do: vim normal Y y$.');
      }
      const vimMode = modes.find((each) => each === mode);
      if (vimMode === undefined) {
        return error(`${mode} isn't a Vim mode here: use normal, visual or insert.`);
      }
      // What the keys do is the rest of the line as written, spaces and all.
      const to = trimmed.replace(/^vim\s+\S+\s+\S+\s+/, '');
      return { line, kind: 'vim', mode: vimMode, keys, to };
    }
    default:
      return error(`A line starts with bind, unbind, vim or #, not ${word}.`);
  }
}

/** The bindings in effect once a keymap's lines apply over the defaults, and the lines that don't. */
export interface Applied {
  /** In order of precedence: the keymap's binds, the later first, then the defaults. */
  readonly bindings: readonly Binding[];
  readonly errors: readonly KeymapError[];
}

interface Entry {
  readonly binding: Binding;
  /** The strokes' ids, space-separated. */
  readonly keys: string;
  /** The keymap line that added it; 0 for a default. */
  readonly line: number;
  alive: boolean;
}

/**
 * Applies a keymap's `bind` and `unbind` lines over `defaults`, in the file's order, in time linear
 * in the bindings: each line looks only at bindings that share its keys or start with them.
 */
export function applyKeymap(
  defaults: readonly Binding[],
  lines: readonly KeymapLine[],
  commands: ReadonlyMap<string, Command>,
  system: System,
): Applied {
  const errors: KeymapError[] = [];
  const entries: Entry[] = [];
  /** Entries by their keys. */
  const byKeys = new Map<string, Entry[]>();
  /** Entries by each of their keys' shorter starts. */
  const byStart = new Map<string, Entry[]>();
  const add = (binding: Binding, line: number) => {
    const ids = binding.strokes.map((each) => each.id);
    const entry: Entry = { binding, keys: ids.join(' '), line, alive: true };
    entries.push(entry);
    push(byKeys, entry.keys, entry);
    for (let length = 1; length < ids.length; length++) {
      push(byStart, ids.slice(0, length).join(' '), entry);
    }
  };
  for (const binding of defaults) add(binding, 0);

  for (const line of lines) {
    if (line.kind === 'vim') continue;
    const strokes = systemStrokes(line.keys, system);
    const keys = strokes.map((each) => each.id).join(' ');
    const written = writeKeys(line.keys);
    const fail = (message: string) => errors.push({ line: line.line, message });
    if (line.kind === 'unbind') {
      const named = line.command === undefined ? undefined : commands.get(line.command);
      if (named?.editor) {
        fail(editorMessage(named));
        continue;
      }
      let kept: Command | undefined;
      let freed = false;
      for (const entry of alive(byKeys, keys)) {
        if (line.command !== undefined && entry.binding.command.id !== line.command) continue;
        // A key the editor handles itself isn't the keymap's to take away.
        if (entry.binding.command.editor) {
          kept = entry.binding.command;
          continue;
        }
        entry.alive = false;
        freed = true;
      }
      if (kept && !freed) fail(editorMessage(kept));
      continue;
    }
    const command = commands.get(line.command);
    if (!command) continue;
    if (command.vim === 'own') {
      fail(`${command.id} is one of Vim's own keys: change Vim's keys with a vim line.`);
      continue;
    }
    if (command.editor) {
      fail(editorMessage(command));
      continue;
    }
    const same = alive(byKeys, keys);
    if (same.some((entry) => entry.binding.command === command)) {
      fail(`${written} already runs ${command.id}.`);
      continue;
    }
    // Another command on the same keys takes them in its scope, but not from an editor's own.
    const taken = same.find(
      (entry) => entry.binding.command.editor && overlap(command, entry.binding.command),
    );
    if (taken) {
      const other = `${writeStrokes(taken.binding.strokes, system)} (${taken.binding.command.id})`;
      fail(`${written} would take ${other} from the editor that handles it itself.`);
      continue;
    }
    const conflict = shadowed(command, strokes.length, keys, byKeys, byStart);
    if (conflict) {
      const other = `${writeStrokes(conflict.binding.strokes, system)} (${conflict.binding.command.id})`;
      fail(
        conflict.binding.command.editor
          ? `${written} would take ${other} from the editor that handles it itself.`
          : conflict.binding.strokes.length > strokes.length
            ? `${written} would keep ${other} from ever running.`
            : `${written} would never run: ${other} runs first.`,
      );
      continue;
    }
    add({ command, strokes }, line.line);
  }

  const users = entries.filter((entry) => entry.alive && entry.line > 0).toReversed();
  const kept = entries.filter((entry) => entry.alive && entry.line === 0);
  return {
    bindings: [...users, ...kept].map((entry) => entry.binding),
    errors,
  };
}

/** The first binding in effect that one of `keys` and its keys would be the start of the other. */
function shadowed(
  command: Command,
  length: number,
  keys: string,
  byKeys: Map<string, Entry[]>,
  byStart: Map<string, Entry[]>,
): Entry | undefined {
  const ids = keys.split(' ');
  for (let shorter = 1; shorter < length; shorter++) {
    const start = alive(byKeys, ids.slice(0, shorter).join(' '));
    const found = start.find((entry) => overlap(command, entry.binding.command));
    if (found) return found;
  }
  return alive(byStart, keys).find((entry) => overlap(command, entry.binding.command));
}

/** Why the keymap file can't change `command`, whose keys its scope's editor handles itself. */
function editorMessage(command: Command): string {
  const scopes = listOf(command.when?.scope).map((scope) => `\`${scope}\``);
  return `${command.id} is handled by the editor in ${scopes.join(' and ')}, so the keymap file can't change its keys.`;
}

/** Whether `command` takes keys in the scope an editor's `owner` is in, in a mode they share. */
function takesFrom(command: Command, owner: Command): boolean {
  const { when } = command;
  const there = listOf(owner.when?.scope).some(
    (scope) =>
      (when?.scope === undefined || listOf(when.scope).includes(scope)) &&
      !when?.except?.includes(scope),
  );
  return there && sharesMode(when, owner.when);
}

/**
 * Whether two commands' keys meet at the same level of precedence somewhere: both for anywhere,
 * or both for a scope they share, in a mode they share. Vim's own keys are never Lo's to run. A
 * key an editor handles itself is met by any command that would take it in the editor's scope,
 * for anywhere or not, since matching leaves the editor's alone and the other takes it.
 */
function overlap(a: Command, b: Command): boolean {
  if (a.vim === 'own' || b.vim === 'own') return false;
  if (a.editor) return !b.editor && takesFrom(b, a);
  if (b.editor) return takesFrom(a, b);
  const scopesA = listOf(a.when?.scope);
  const scopesB = listOf(b.when?.scope);
  if ((scopesA.length === 0) !== (scopesB.length === 0)) return false;
  if (scopesA.length > 0 && !scopesA.some((scope) => scopesB.includes(scope))) return false;
  return sharesMode(a.when, b.when);
}

function sharesMode(a: When | undefined, b: When | undefined): boolean {
  const modesA = listOf(a?.mode);
  const modesB = listOf(b?.mode);
  return modesA.length === 0 || modesB.length === 0 || modesA.some((mode) => modesB.includes(mode));
}

/** The entries under `key` still in effect, dropping the rest from the list for good. */
function alive(map: Map<string, Entry[]>, key: string): Entry[] {
  const list = map.get(key);
  if (!list) return [];
  const living = list.filter((entry) => entry.alive);
  if (living.length !== list.length) map.set(key, living);
  return living;
}

function push(map: Map<string, Entry[]>, key: string, entry: Entry): void {
  const list = map.get(key);
  if (list) list.push(entry);
  else map.set(key, [entry]);
}
