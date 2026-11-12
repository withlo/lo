// The files an overview's blocks show, read and diffed once for all the blocks that show each:
// main reads a file's text at the overview's commit and where the pull request's diff of it
// starts, and the diff's background job diffs and highlights them, once for every block on the
// file that's drawing. A file no block holds any more is kept a little while, for the next block
// that comes near, up to `IDLE_LIMIT` of text in all, then let go; one still being read when the
// last block lets it go is stopped.

import { LIMITS } from '@lo/artifact';
import type { FileDiff } from '@lo/diff';

import { diffTexts } from '../../diff/window/shared.ts';
import type { BlockText } from '../contract.ts';
import { main } from './main.ts';
import { excerptOf, textsOf } from './targets.ts';

/**
 * A file's code, as the blocks that show it draw it: each side's lines, the pull request's diff of
 * it when it changes it, and each side's highlighting; or why it couldn't be read.
 */
export type FileCode =
  | { kind: 'unread'; why: string }
  | {
      kind: 'code';
      lines: { old: string[]; new: string[] };
      diff: FileDiff | undefined;
      tokens: { old?: Uint32Array | undefined; new?: Uint32Array | undefined };
    };

/** A block's hold on a file's code: the code once it's in, and the way to let it go. */
export interface FileHold {
  readonly code: Promise<FileCode>;
  release(): void;
}

/** The most text the files no block holds may have, kept for the next block, in all. */
export const IDLE_LIMIT = LIMITS.file;

interface Entry {
  readonly key: string;
  readonly code: Promise<FileCode>;
  readonly stop: AbortController;
  users: number;
  /** How much text it holds, once it's in. */
  size: number;
  settled: boolean;
  /** Whether it's kept once no block holds it: it was read. */
  keep: boolean;
}

/** Every file a block holds, or kept a little while, by tab, commit and path. */
const entries = new Map<string, Entry>();
/** The files no block holds, oldest first. */
const idle = new Set<Entry>();

/** Reads `path` at `commit` in tab `tab`, and diffs it, once its read starts. */
async function read(tab: string, commit: string, path: string, signal: AbortSignal) {
  let text: BlockText;
  try {
    text = await main().texts({ id: tab, commit, path, base: true });
  } catch (error) {
    return { code: unread(error), size: 0, keep: false };
  }
  if (text.kind === 'unread') return { code: text, size: 0, keep: false };
  const size = text.text.length + (text.base?.kind === 'changed' ? text.base.text.length : 0);
  const [diffed] = await diffTexts([textsOf(path, text)], signal).catch((error: unknown) => {
    if (!signal.aborted) console.error("Lo couldn't diff a file an overview shows:", error);
    return [undefined];
  });
  return { code: { kind: 'code' as const, ...excerptOf(text, diffed) }, size, keep: true };
}

/**
 * Holds the code of `path` at `commit`, in tab `tab`, for a block: read and diffed once for every
 * block that holds it at the same time, or that comes soon after. Each hold is let go once.
 */
export function holdFile(tab: string, commit: string, path: string): FileHold {
  const key = `${tab}\n${commit}\n${path}`;
  let entry = entries.get(key);
  if (entry) {
    idle.delete(entry);
  } else {
    const stop = new AbortController();
    const made: Entry = {
      key,
      stop,
      users: 0,
      size: 0,
      settled: false,
      keep: false,
      code: read(tab, commit, path, stop.signal).then((done) => {
        made.settled = true;
        made.size = done.size;
        made.keep = done.keep;
        // A failure isn't kept: the next block to come near asks again.
        if (!done.keep && made.users === 0) forget(made);
        return done.code;
      }),
    };
    entries.set(key, made);
    entry = made;
  }
  const held = entry;
  held.users += 1;
  let released = false;
  return {
    code: held.code,
    release() {
      if (released) return;
      released = true;
      held.users -= 1;
      if (held.users > 0) return;
      if (!held.settled || !held.keep) {
        held.stop.abort();
        forget(held);
        return;
      }
      idle.add(held);
      trim();
    },
  };
}

/** Lets the files no block holds go, oldest first, until what's left fits `IDLE_LIMIT`. */
function trim(): void {
  let size = 0;
  for (const entry of idle) size += entry.size;
  for (const entry of idle) {
    if (size <= IDLE_LIMIT) break;
    size -= entry.size;
    forget(entry);
  }
}

function forget(entry: Entry): void {
  idle.delete(entry);
  if (entries.get(entry.key) === entry) entries.delete(entry.key);
}

/** How many files are held or kept, for tests. */
export function heldFiles(): number {
  return entries.size;
}

function unread(error: unknown): FileCode {
  return { kind: 'unread', why: error instanceof Error ? error.message : String(error) };
}
