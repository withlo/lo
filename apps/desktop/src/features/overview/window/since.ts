// What changed since each tab's overview's commit, up to the head on screen, as the window keeps it:
// how many files the pushes since changed, and how each file the overview points at is at the head,
// each worked out once for the commit and head. Main reads the files from the local copy; a small
// one is diffed here, as a block's own code is, and a larger one by the diff's background job; only
// the runs of lines that changed are kept, never the texts.
// A newer head on screen replaces what was worked out for the last, and a closed tab's goes.
//
// `placeOnHead` says where a place the overview points at is on the head on screen, as far as it's
// worked out, for whatever goes to it or marks it there; `placing` works it out first, for
// following.

import type { CodeRange } from '@lo/artifact';

import { diffTexts } from '../../diff/window/shared.ts';
import type { LocalState } from '../../tab/contract.ts';
import { localCopyOf, onLocalCopy, pullOf } from '../../tab/window/shared.ts';
import type { SinceReply } from '../contract.ts';
import { standingOf } from './facts.ts';
import { QUICK_LIMIT, quickDiff } from './files.ts';
import { main } from './main.ts';
import {
  blockChange,
  commentOnHead,
  fileSinceOf,
  onHead,
  type CommentOnHead,
  type FileSince,
  type OnHead,
} from './mapping.ts';
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

/**
 * How a file is asked for: `soon` for a block on screen, which goes first; and `quick` to diff a
 * small file here, at once, as for an overview on screen, rather than in the diff's job, which an
 * overview kept behind another view leaves it to.
 */
export interface Asking {
  readonly soon?: boolean | undefined;
  readonly quick?: boolean | undefined;
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
 * Whether tab `tab`'s local copy is other than `asked`, now or once it changes: never once `stop`
 * aborts.
 */
function changedFrom(
  tab: string,
  asked: LocalState | undefined,
  stop: AbortSignal,
): Promise<boolean> {
  if (stop.aborted) return Promise.resolve(false);
  if (localCopyOf(tab) !== asked) return Promise.resolve(true);
  return new Promise((resolve) => {
    const done = (changed: boolean) => {
      listening();
      stop.removeEventListener('abort', aborted);
      resolve(changed);
    };
    const aborted = () => done(false);
    const listening = onLocalCopy((which) => {
      if (which === tab) done(true);
    });
    stop.addEventListener('abort', aborted, { once: true });
  });
}

/**
 * What main answers with `ask` for tab `tab`, asked again each time the tab's local copy changes
 * while main says it's waiting for it, as it does until the copy has the commit and the head; none
 * once `stop` aborts first.
 */
async function untilReady<T extends { readonly kind: string }>(
  tab: string,
  stop: AbortSignal,
  ask: () => Promise<T>,
): Promise<T | undefined> {
  const asked = localCopyOf(tab);
  const reply = await ask();
  if (reply.kind !== 'waiting') return reply;
  return (await changedFrom(tab, asked, stop)) ? untilReady(tab, stop, ask) : undefined;
}

/**
 * How many files the pushes since `commit` changed, up to `head`, the head on screen, in tab
 * `tab`: asked once, and again as the local copy changes while it isn't ready for them.
 */
export function sinceCount(tab: string, commit: string, head: string): Promise<SinceReply> {
  const entry = entryOf(tab, commit, head);
  if (entry.count) return entry.count;
  const count = untilReady(tab, entry.stop.signal, () => main().since({ id: tab, commit, head }))
    .then((reply): SinceReply => {
      if (reply?.kind !== 'read' && entry.count === count) entry.count = undefined;
      return reply ?? { kind: 'waiting' };
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
 * once, a few files at a time, those asked for `soon` first, as a block on screen asks. While the
 * local copy isn't ready for it, it's asked again each time the copy changes, until it is.
 */
export function fileSince(
  tab: string,
  commit: string,
  head: string,
  path: string,
  { soon = false, quick = true }: Asking = {},
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
    .then(() => read(entry, path, quick))
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

/** Reads `path` at both commits from main and diffs it, here when `quick`, keeping what's known. */
async function read(entry: Entry, path: string, quick: boolean): Promise<FileSince> {
  const { tab, commit, head, stop } = entry;
  let since: FileSince;
  try {
    const text = await untilReady(tab, stop.signal, () =>
      main().sinceFile({ id: tab, commit, head, path }),
    );
    if (text === undefined || text.kind === 'waiting') {
      // Stopped for another head, or as the tab closed.
      entry.files.delete(path);
      return { kind: 'unknown', why: 'The read was stopped.' };
    }
    if (text.kind === 'changed' && 'old' in text.texts) {
      const { old, new: now } = text.texts;
      // A small file is diffed here, at once, as a block's own code is, since its block draws
      // with its flag; a larger one, or one for an overview kept behind another view, by the
      // diff's background job, without highlighting.
      const here =
        quick && old.length + now.length <= QUICK_LIMIT ? quickDiff({ old, new: now }) : undefined;
      const diffed =
        here ??
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
  { quick = true }: Pick<Asking, 'quick'> = {},
): Promise<number | undefined> {
  const changes = await Promise.all(
    targets.map(async (target) => {
      const since = await fileSince(tab, commit, head, target.path, { quick });
      return since.kind === 'unknown'
        ? undefined
        : blockChange(since, target.lines).kind !== 'none';
    }),
  );
  if (changes.includes(undefined)) return undefined;
  return changes.filter(Boolean).length;
}

/**
 * The commit tab `tab`'s overview on screen describes, and the head on screen, when it's another:
 * what there's anything to work out between.
 */
function comparedIn(tab: string): { readonly commit: string; readonly head: string } | undefined {
  const standing = standingOf(states.get(tab), checked.get(tab));
  const commit = standing.kind === 'shown' ? standing.header.commit : undefined;
  const head = commit === undefined ? undefined : staleAgainst(commit, pullOf(tab));
  return commit === undefined || head === undefined ? undefined : { commit, head };
}

/** How the file at `path` is at the head on screen in tab `tab`, once that's worked out. */
function knownIn(tab: string, path: string): FileSince | undefined {
  const compared = comparedIn(tab);
  const entry = entries.get(tab);
  const known = entry?.commit === compared?.commit && entry?.head === compared?.head;
  return compared && known ? entry?.known.get(path) : undefined;
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
  return onHead(knownIn(tab, path), path, lines);
}

/**
 * Lo working out how the file at `path`, at the commit tab `tab`'s overview on screen describes,
 * is at the head on screen, for something about to go there: its read and diff, ahead of the
 * rest. None once that's known, or when there's nothing to work out.
 */
export function placing(tab: string, path: string): Promise<unknown> | undefined {
  const compared = comparedIn(tab);
  if (!compared || knownIn(tab, path)) return undefined;
  return fileSince(tab, compared.commit, compared.head, path, { soon: true });
}

/**
 * Where lines `from` to `to` on `side` of the file at `path`, at `commit`, the commit tab `tab`'s
 * overview describes, are for a comment at the head on screen, once Lo has worked out how the file
 * changed (`commentOnHead`): as they are where the overview describes that head; on the file where
 * the overview on screen is for another commit, or Lo can't tell.
 */
export async function commentLinesOnHead(
  tab: string,
  commit: string,
  path: string,
  lines: { readonly side: 'old' | 'new'; readonly from: number; readonly to: number },
): Promise<CommentOnHead> {
  if (pullOf(tab)?.shown === commit) return commentOnHead('same', path, lines);
  const compared = comparedIn(tab);
  if (compared?.commit !== commit) return { kind: 'file', path };
  const since = await fileSince(tab, commit, compared.head, path, { soon: true });
  return commentOnHead(since, path, lines);
}

/**
 * How the file at `path` at `commit` is at `head`, in tab `tab`, if Lo has worked it out: nothing
 * while it hasn't, which `fileSince` asks for.
 */
export function knownSince(
  tab: string,
  commit: string,
  head: string,
  path: string,
): FileSince | undefined {
  const entry = entries.get(tab);
  return entry?.commit === commit && entry.head === head ? entry.known.get(path) : undefined;
}

/** Lets go of what was worked out for the tabs that closed: those not in `open`. */
export function keepSinceOnly(open: ReadonlySet<string>): void {
  for (const [tab, entry] of entries) {
    if (open.has(tab)) continue;
    entry.stop.abort();
    entries.delete(tab);
  }
}
