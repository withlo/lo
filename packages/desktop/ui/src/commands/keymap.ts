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
// A line that can't be read is reported with its number, and the others still apply.

import { isCommandId } from './declare.ts';
import { readKeys, type Sequence } from './notation.ts';
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
