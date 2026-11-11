/** Readers for tests: an overview's commit and a repository's code, held in memory. */

import type { CodeReader, EntryKind, FileAnswer, OverviewFiles, TreeEntry } from '../src/index.ts';

const encoder = new TextEncoder();

/**
 * What's at a path: a file's contents, or an entry with a kind and perhaps a size. A file given
 * only its size holds that many newlines.
 */
export type Held = string | Uint8Array | { kind: EntryKind; size?: number };

/** A commit's paths, by their text, and what's at each. */
export type Paths = Readonly<Record<string, Held>>;

/** `held` as a commit's listing has it. */
function entryOf(path: string, held: Held): TreeEntry {
  if (typeof held === 'string' || held instanceof Uint8Array) {
    const size = typeof held === 'string' ? encoder.encode(held).length : held.length;
    return { path: encoder.encode(path), kind: 'file', size };
  }
  return { path: encoder.encode(path), kind: held.kind, size: held.size };
}

/** What reading `path` from `paths` answers under `cap`, as a reader must. */
export function answer(paths: Paths, path: string, cap: number): FileAnswer {
  if (!Object.hasOwn(paths, path)) {
    // A path through a link or a file is nothing: a link is never followed.
    return { kind: 'missing' };
  }
  const held = paths[path]!;
  if (typeof held === 'object' && !(held instanceof Uint8Array)) {
    if (held.kind === 'file')
      return (held.size ?? 0) > cap
        ? { kind: 'tooLarge' }
        : { kind: 'bytes', bytes: new Uint8Array(held.size ?? 0).fill(0x0a) };
    return { kind: 'notFile', is: held.kind };
  }
  const bytes = typeof held === 'string' ? encoder.encode(held) : held;
  return bytes.length > cap ? { kind: 'tooLarge' } : { kind: 'bytes', bytes };
}

/** An overview's commit holding `paths`, and `extra` entries listed as given. */
export function overviewFiles(paths: Paths, extra: readonly TreeEntry[] = []): OverviewFiles {
  return {
    entries: [...Object.entries(paths).map(([path, held]) => entryOf(path, held)), ...extra],
    read: async (path, cap) => answer(paths, path, cap),
  };
}

/** A call a code reader was asked. */
export interface Asked {
  commit: string;
  path: string;
  cap: number;
}

/**
 * A repository holding `paths` at `commit`, and nothing at any other commit, whose reader keeps
 * what it's asked in `asked`.
 */
export function repository(commit: string, paths: Paths): { readCode: CodeReader; asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    readCode: async (at, path, cap) => {
      asked.push({ commit: at, path, cap });
      return at === commit ? answer(paths, path, cap) : { kind: 'noCommit' };
    },
  };
}

/** A code reader that answers nothing, ever. */
export const silent: CodeReader = () => new Promise(() => {});
