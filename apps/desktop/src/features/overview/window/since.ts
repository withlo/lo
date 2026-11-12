// What changed since each tab's overview's commit, up to the head on screen, as the window keeps it:
// how many files the pushes since changed, and how each file the overview points at is at the head,
// each worked out once for the commit and head. Main reads the files from the local copy; a small
// one is diffed here, as a block's own code is, and a larger one by the diff's background job; only
// the runs of lines that changed are kept, never the texts.
// A newer head on screen replaces what was worked out for the last, and a closed tab's goes.
//
// `placeOnHead` says where a place the overview points at is on the head on screen, as far as it's
// worked out, for whatever goes to it or marks it there.

import type { CodeRange } from '@lo/artifact';

import { diffTexts } from '../../diff/window/shared.ts';
import { pullOf } from '../../tab/window/shared.ts';
import type { SinceReply } from '../contract.ts';
import { standingOf } from './facts.ts';
import { QUICK_LIMIT, quickDiff } from './files.ts';
import { main } from './main.ts';
import { blockChange, fileSinceOf, onHead, type FileSince, type OnHead } from './mapping.ts';
import { staleAgainst } from './stale.ts';
import { checked, states } from './store.ts';

/** How many files are read and diffed at once for one tab. */
const AT_ONCE = 2;

/** A tab's overview's commit compared with the head on screen, worked out once. */
interface Entry {
  readonly tab: string;
  readonly commit: string;
  readonly head: string;
  readonly stop: AbortController;
  count: Promise<SinceReply> | undefined;
  /** Each file asked for, by its path at the commit, until it's known. */
  readonly files: Map<string, Promise<FileSince>>;
  /** Each file once it's known. */
  readonly known: Map<string, FileSince>;
  /** Reads waiting their turn, the soonest first. */
  readonly queue: Waiting[];
  running: number;
}

/** A read waiting its turn: the file's path, and what starts it. */
interface Waiting {
  readonly path: string;
  readonly start: () => void;
}

/** What's worked out for each tab, for its overview's commit and its head on screen. */
const entries = new Map<string, Entry>();

/** Tab `tab`'s entry for `commit` and `head`: a new one, the last let go, when either changed. */
function entryOf(tab: string, commit: string, head: string): Entry {
  const kept = entries.get(tab);
  if (kept?.commit === commit && kept.head === head) return kept;
  kept?.stop.abort();
  const entry: Entry = {
    tab,
    commit,
    head,
    stop: new AbortController(),
    count: undefined,
    files: new Map(),
    known: new Map(),
    queue: [],
    running: 0,
  };
  entries.set(tab, entry);
  return entry;
}

/**
 * How many files the pushes since `commit` changed, up to `head`, the head on screen, in tab
 * `tab`: asked once, unless the local copy wasn't ready, when it's asked again next time.
 */
export function sinceCount(tab: string, commit: string, head: string): Promise<SinceReply> {
  const entry = entryOf(tab, commit, head);
  if (entry.count) return entry.count;
  const count = main()
    .since({ id: tab, commit, head })
    .then((reply) => {
      if (reply.kind !== 'read' && entry.count === count) entry.count = undefined;
      return reply;
    })
    .catch((error: unknown): SinceReply => {
      if (entry.count === count) entry.count = undefined;
      return { kind: 'failed', why: error instanceof Error ? error.message : String(error) };
    });
  entry.count = count;
  return count;
}

/**
 * How the file at `path` at `commit` is at `head`, the head on screen, in tab `tab`: read and diffed
 * once, a few files at a time, those asked for `soon` first, as a block on screen asks. One the
 * local copy wasn't ready for is unknown, and asked again next time.
 */
export function fileSince(
  tab: string,
  commit: string,
  head: string,
  path: string,
  { soon = false }: { readonly soon?: boolean } = {},
): Promise<FileSince> {
  const entry = entryOf(tab, commit, head);
  const asked = entry.files.get(path);
  if (asked) {
    if (soon) hurry(entry, path);
    return asked;
  }
  let start!: () => void;
  const turn = new Promise<void>((resolve) => (start = resolve));
  const waiting: Waiting = { path, start };
  if (soon) entry.queue.unshift(waiting);
  else entry.queue.push(waiting);
  const found = turn
    .then(() => read(entry, path))
    .finally(() => {
      entry.running -= 1;
      next(entry);
    });
  entry.files.set(path, found);
  next(entry);
  return found;
}

/** Puts the read of `path` first among those waiting. */
function hurry(entry: Entry, path: string): void {
  const at = entry.queue.findIndex((waiting) => waiting.path === path);
  if (at <= 0) return;
  const [waiting] = entry.queue.splice(at, 1);
  if (waiting) entry.queue.unshift(waiting);
}

/** Starts reads that are waiting, while fewer than `AT_ONCE` run. */
function next(entry: Entry): void {
  while (entry.running < AT_ONCE && !entry.stop.signal.aborted) {
    const waiting = entry.queue.shift();
    if (!waiting) return;
    entry.running += 1;
    waiting.start();
  }
}

/** Reads `path` at both commits from main and diffs it, keeping what's known. */
async function read(entry: Entry, path: string): Promise<FileSince> {
  const { tab, commit, head, stop } = entry;
  let since: FileSince;
  try {
    const text = await main().sinceFile({ id: tab, commit, head, path });
    if (text.kind === 'waiting') {
      // Asked again once the local copy has both.
      entry.files.delete(path);
      return { kind: 'unknown', why: 'The local copy isn’t ready.' };
    }
    if (text.kind === 'changed' && 'old' in text.texts) {
      const { old, new: now } = text.texts;
      // A small file is diffed here, at once, as a block's own code is, since its block draws
      // with its flag; a larger one by the diff's background job, without highlighting.
      const quick =
        old.length + now.length <= QUICK_LIMIT ? quickDiff({ old, new: now }) : undefined;
      const diffed =
        quick ??
        (await diffTexts([{ path: text.path, old, new: now }], stop.signal, {
          highlight: false,
        }).then(
          ([each]) => each,
          (error: unknown) => {
            if (!stop.signal.aborted) {
              console.error("Lo couldn't diff a file since the overview:", error);
            }
            return undefined;
          },
        ));
      since = fileSinceOf(text, diffed);
    } else {
      since = fileSinceOf(text, undefined);
    }
  } catch (error) {
    entry.files.delete(path);
    return { kind: 'unknown', why: error instanceof Error ? error.message : String(error) };
  }
  if (!stop.signal.aborted) entry.known.set(path, since);
  return since;
}

/**
 * How many of `targets`, the lines code blocks show at `commit`, point at lines that changed by
 * `head`, in tab `tab`, as each block's flag says; or none while how any of their files changed
 * isn't known.
 */
export async function blocksChanged(
  tab: string,
  commit: string,
  head: string,
  targets: readonly CodeRange[],
): Promise<number | undefined> {
  const changes = await Promise.all(
    targets.map(async (target) => {
      const since = await fileSince(tab, commit, head, target.path);
      return since.kind === 'unknown'
        ? undefined
        : blockChange(since, target.lines).kind !== 'none';
    }),
  );
  if (changes.includes(undefined)) return undefined;
  return changes.filter(Boolean).length;
}

/**
 * Where lines `lines` of the file at `path`, at the commit tab `tab`'s overview on screen
 * describes, are at the head on screen, as far as Lo has worked out: as written while it hasn't,
 * or when the overview describes the head on screen. None for a file that's gone.
 */
export function placeOnHead(
  tab: string,
  path: string,
  lines: { readonly start: number; readonly end: number } | undefined,
): OnHead | undefined {
  const standing = standingOf(states.get(tab), checked.get(tab));
  const commit = standing.kind === 'shown' ? standing.header.commit : undefined;
  const head = commit === undefined ? undefined : staleAgainst(commit, pullOf(tab));
  const entry = entries.get(tab);
  const known = entry?.commit === commit && entry?.head === head ? entry : undefined;
  return onHead(head === undefined ? undefined : known?.known.get(path), path, lines);
}

/** Lets go of what was worked out for the tabs that closed: those not in `open`. */
export function keepSinceOnly(open: ReadonlySet<string>): void {
  for (const [tab, entry] of entries) {
    if (open.has(tab)) continue;
    entry.stop.abort();
    entries.delete(tab);
  }
}
