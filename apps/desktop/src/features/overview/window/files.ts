// The files an overview's blocks show, read and diffed once for all the blocks that show each:
// main reads a file's text at the overview's commit and where the pull request's diff of it
// starts, and the diff's background job diffs and highlights them, once for every block on the
// file. A small file on an overview on screen is diffed here, at once, so its blocks draw without
// waiting for a job to start, and the job runs only once a block asks for its highlighting; an
// overview kept behind another view leaves the work to the job. A file no block holds any
// more is kept a little while, for the next block that comes near, up to `IDLE_LIMIT` of text in
// all, then let go; one still being read when the last block lets it go is stopped.

import { LIMITS } from '@lo/artifact';
import { diffText, type FileDiff } from '@lo/diff';

import { diffTexts, type DiffedText } from '../../diff/window/shared.ts';
import type { BlockText } from '../contract.ts';
import { main } from './main.ts';
import { excerptOf, textsOf } from './targets.ts';

/** Each side's highlighting: `@lo/syntax`'s triples, where it could highlight. */
export interface Tokens {
  old?: Uint32Array | undefined;
  new?: Uint32Array | undefined;
}

/**
 * A file's code, as the blocks that show it draw it: each side's lines, the pull request's diff of
 * it when it changes it, and each side's highlighting, for a block that asks; or why it couldn't
 * be read.
 */
export type FileCode =
  | { kind: 'unread'; why: string }
  | {
      kind: 'code';
      lines: { old: string[]; new: string[] };
      diff: FileDiff | undefined;
      /** Each side's highlighting, from the diff's job, which this starts if it hasn't. */
      highlighted(): Promise<Tokens>;
    };

/** A block's hold on a file's code: the code once it's in, and the way to let it go. */
export interface FileHold {
  readonly code: Promise<FileCode>;
  release(): void;
}

/** The most text the files no block holds may have, kept for the next block, in all. */
export const IDLE_LIMIT = LIMITS.file;

/**
 * The most text a file may have, both sides, to be diffed here as it's read, a moment's work,
 * rather than only by the diff's background job, which takes a few hundred milliseconds to start.
 */
export const QUICK_LIMIT = 16 * 1024;

/**
 * How long the diffs here may take in one frame, all told, in milliseconds: half of it, the rest
 * left to draw. A file whose diff doesn't finish in what's left waits for the job's.
 */
const QUICK_BUDGET = 8;

/** How long the diffs here have taken in this frame, and whether its end is watched for. */
let spent = 0;
let framing = false;

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

/**
 * Reads `path` at `commit` in tab `tab`, and diffs it: here when it's small and `quick`, else in
 * the diff's job.
 */
async function read(
  tab: string,
  commit: string,
  path: string,
  quick: boolean,
  signal: AbortSignal,
) {
  let text: BlockText;
  try {
    text = await main().texts({ id: tab, commit, path, base: true });
  } catch (error) {
    return { code: unread(error), size: 0, keep: false };
  }
  if (text.kind === 'unread') return { code: text, size: 0, keep: false };
  const size = text.text.length + (text.base?.kind === 'changed' ? text.base.text.length : 0);
  const texts = textsOf(path, text);
  // The diff's job, started once something needs it: the diff of a larger file, or highlighting.
  let job: Promise<DiffedText | undefined> | undefined;
  const diffed = () =>
    (job ??= diffTexts([texts], signal).then(
      ([done]) => done,
      (error: unknown) => {
        if (!signal.aborted) console.error("Lo couldn't diff a file an overview shows:", error);
        return undefined;
      },
    ));
  const here = quick && size <= QUICK_LIMIT ? quickDiff(texts) : undefined;
  const { lines, diff } = excerptOf(text, here ?? (await diffed()));
  const highlighted = () => diffed().then((done) => excerptOf(text, done).tokens);
  return { code: { kind: 'code' as const, lines, diff, highlighted }, size, keep: true };
}

/**
 * `texts` diffed here, as the diff's job diffs them, without highlighting; none if it can't be in
 * what's left of this frame's share, as a coarser diff than the job's would be.
 */
export function quickDiff(texts: { old: string | null; new: string | null }) {
  const budget = QUICK_BUDGET - spent;
  // A budget of 0 is none at all to the diff.
  if (budget < 1) return undefined;
  const start = performance.now();
  try {
    const diff = diffText(texts.old ?? undefined, texts.new ?? undefined, { budget });
    return diff.approximate ? undefined : { ok: true as const, diff, tokens: {} };
  } catch {
    return undefined;
  } finally {
    spent += performance.now() - start;
    if (!framing) {
      framing = true;
      requestAnimationFrame(() => {
        spent = 0;
        framing = false;
      });
    }
  }
}

/**
 * Holds the code of `path` at `commit`, in tab `tab`, for a block: read and diffed once for every
 * block that holds it at the same time, or that comes soon after. A small file is diffed here when
 * it's `quick`, as for a block on an overview on screen; one kept behind another view leaves it to
 * the diff's job. `from` is the commit a stack's layer's diff starts from, as the local copy last
 * said, which the code's base side starts from too: another reads it again. Each hold is let go
 * once.
 */
export function holdFile(
  tab: string,
  commit: string,
  path: string,
  quick = true,
  from = '',
): FileHold {
  const key = `${tab}\n${commit}\n${path}\n${from}`;
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
      code: read(tab, commit, path, quick, stop.signal).then((done) => {
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
