// Each pull request's tab's viewed marks in the window: GitHub's, as the tab's changed files say,
// with the marks Lo is setting on top until GitHub has answered (`@lo/review`'s `ViewedMarks`).
// `e` marks a file viewed, or clears its mark: the new mark shows at once and goes to main, and if
// GitHub doesn't take it, the file shows GitHub's mark again and a note says why. Nothing else of
// what `e` did goes back: where the cursor went, and what's on screen, are the reader's.

import { type ViewedToggle, ViewedMarks } from '@lo/review';
import { clock } from '@lo/ui';

import {
  changedFiles,
  pullOf,
  runOf,
  tabState,
  type Files,
  type PullView,
} from '../../tab/window/shared.ts';
import { offlineLabel } from '../../../window/explain.ts';
import { PATH_LIMIT, pathBytes, type TreePath } from '../../tree/contract.ts';
import type { Marked } from '../contract.ts';
import { main } from './main.ts';
import { views } from './store.ts';

/** A changed file's viewed mark: viewed, not yet, or changed since it was viewed. */
export type Mark = 'viewed' | 'unviewed' | 'dismissed';

/**
 * A mark GitHub didn't take, which the file's header shows: what failed, why, and what GitHub or
 * the system said, as it said it, for Details.
 */
export interface MarkFailure {
  readonly title: string;
  readonly reason: string | undefined;
  readonly details?: string | undefined;
}

/** A tab's viewed marks, as they show. */
export interface ShownMarks {
  /** Each file's mark, by the path GitHub lists it at: only paths short enough to key a map by. */
  readonly byPath: ReadonlyMap<string, Mark>;
  /** Each file whose last mark or clear GitHub didn't take, by the same path, until the next. */
  readonly failed?: ReadonlyMap<string, MarkFailure> | undefined;
  /** How many files show as viewed, of how many the pull request changes, once GitHub has said. */
  readonly count: { readonly viewed: number; readonly total: number } | undefined;
}

const NONE: ShownMarks = { byPath: new Map(), failed: new Map(), count: undefined };

/** Each mark as GitHub's API names it. */
const GITHUB = { viewed: 'VIEWED', unviewed: 'UNVIEWED', dismissed: 'DISMISSED' } as const;

/** What each tab's marks show, re-rendering what reads them as they change. */
export const shownMarks = tabState<ShownMarks>(() => NONE);

/** A tab's marks, the files GitHub last listed, and the writes GitHub didn't take. */
interface Model {
  marks: ViewedMarks;
  files: Files | undefined;
  readonly failed: Map<string, MarkFailure>;
}

const models = tabState<Model | undefined>(() => undefined);

/** Whether GitHub's mark on `path` is kept: its path is short enough to key a map by. */
function keyable(path: string): boolean {
  return pathBytes({ text: path }) <= PATH_LIMIT;
}

/** `tab`'s marks, made the first time, from the files main last listed. */
function modelOf(tab: string): Model {
  let model = models.get(tab);
  if (!model) {
    model = { marks: new ViewedMarks(), files: undefined, failed: new Map() };
    models.set(tab, model);
    const files = changedFiles(tab);
    if (files) take(tab, model, files);
  }
  return model;
}

/** Takes the files GitHub listed, with its marks, as they reached the window just now. */
function take(tab: string, model: Model, files: Files): void {
  model.files = files;
  const listed = files.files.filter((file) => keyable(file.path));
  const marks = new Map(listed.map((file) => [file.path, GITHUB[file.viewed]] as const));
  model.marks.setGithub(model.marks.withoutStale(marks, Date.now()));
  // Whether GitHub listed every file, so a path it doesn't list is none of the pull request's. Only
  // `githubPath` reads it, which asks of no head.
  const whole = listed.length === files.files.length && files.files.length === files.total;
  model.marks.setListed(whole ? new Set(listed.map((file) => file.path)) : undefined, '');
  show(tab, model);
}

/** Puts what `tab`'s marks show where the views read it. */
function show(tab: string, model: Model): void {
  const byPath = new Map<string, Mark>();
  let viewed = 0;
  for (const [path, state] of model.marks.shown()) {
    const mark: Mark =
      state === 'VIEWED' ? 'viewed' : state === 'DISMISSED' ? 'dismissed' : 'unviewed';
    byPath.set(path, mark);
    if (mark === 'viewed') viewed += 1;
  }
  const total = model.files?.total;
  shownMarks.set(tab, {
    byPath,
    failed: new Map(model.failed),
    count: total === undefined ? undefined : { viewed, total },
  });
}

/** Main said `tab`'s changed files anew. */
export function takeFiles(tab: string, files: Files): void {
  const model = models.get(tab);
  if (model) take(tab, model, files);
  else modelOf(tab);
}

/** `path`'s mark in `marks`, or its old path's, for a rename GitHub lists by that. */
export function markIn(
  marks: ShownMarks,
  path: TreePath,
  previous: TreePath | null | undefined,
): Mark | undefined {
  const own = textOf(path);
  const old = previous ? textOf(previous) : undefined;
  return (
    (own === undefined ? undefined : marks.byPath.get(own)) ??
    (old === undefined ? undefined : marks.byPath.get(old))
  );
}

/**
 * How many of `files` are viewed in `marks`, of how many there are: for a count of the files a diff
 * shows. GitHub's own count is of the pull request's files, which include another layer's when a
 * stack's layer is compared with the one below it, and the diff shows fewer.
 */
export function countIn(
  marks: ShownMarks,
  files: readonly { readonly path: TreePath; readonly previous: TreePath | null }[],
): { readonly viewed: number; readonly total: number } {
  let viewed = 0;
  for (const file of files) if (markIn(marks, file.path, file.previous) === 'viewed') viewed += 1;
  return { viewed, total: files.length };
}

/**
 * Whether `e` can mark the file at `path` viewed: GitHub can name it, as UTF-8, and its path is short
 * enough to key a map by. Lo keeps no mark of any other.
 */
export function markable(path: TreePath): boolean {
  return textOf(path) !== undefined;
}

/** A path as GitHub lists it: its text, when it's UTF-8 and short enough to key a map by. */
function textOf(path: TreePath): string | undefined {
  return path.hex === undefined && path.digest === undefined && keyable(path.text)
    ? path.text
    : undefined;
}

/** What `e` did: started marking a file viewed, or clearing its mark, or why it couldn't. */
export type Toggled =
  | { readonly kind: 'marking' }
  | { readonly kind: 'clearing' }
  | { readonly kind: 'refused'; readonly why: string };

const refused = (why: string): { kind: 'refused'; why: string } => ({ kind: 'refused', why });

/** A time later today, or on another day, as the system writes one, for when a pause ends. */
function timeOf(at: number): string {
  const when = new Date(at);
  const time = clock(at);
  return when.toDateString() === new Date().toDateString()
    ? time
    : `${when.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Why marks can't be written as `pull` stands with GitHub, if they can't: the dimmed ball's tip. */
function connectionRefusal(pull: PullView): string | undefined {
  const { connection } = pull;
  switch (connection.kind) {
    case 'signedOut':
      return `${connection.login} is signed out`;
    case 'offline':
      return offlineLabel(connection.cause);
    case 'rateLimited':
      return `GitHub’s rate limit resets at ${timeOf(connection.until)}`;
    case 'live':
    case 'limitLow':
      return undefined;
    default:
      connection satisfies never;
      return undefined;
  }
}

/**
 * The head of what `tab`'s diff shows: the newer side of the comparison on screen, or the head on
 * screen.
 */
function headOf(tab: string, pull: PullView): string | undefined {
  return views.get(tab)?.comparison?.to ?? pull.shown ?? undefined;
}

/**
 * `e` on a changed file of `tab`'s, at `path`, or `previous` for a rename: marks it viewed, or
 * clears the mark of one that's viewed. The new mark shows at once. Marking needs GitHub's newest
 * head on screen, since GitHub marks a file as of that head; clearing doesn't. Neither is sent
 * while Lo can't write, as when GitHub has asked it to hold off.
 */
export function toggle(
  tab: string,
  file: { readonly path: TreePath; readonly previous: TreePath | null },
): Toggled {
  const can = writable(tab, file);
  if (can.kind === 'refused') return can;
  const { model, path, marking, at } = can;
  const name = file.path.text.slice(file.path.text.lastIndexOf('/') + 1);
  const title = marking ? `Couldn’t mark ${name} viewed` : `Couldn’t unmark ${name}`;
  const made = model.marks.toggle(path);
  // A new mark or clear on the file takes the place of one that failed.
  model.failed.delete(path);
  show(tab, model);
  void write(tab, model, made, at, title);
  return { kind: marking ? 'marking' : 'clearing' };
}

/**
 * Why `e` can't mark or clear the changed file of `tab`'s at `path`, or `previous` for a rename,
 * now, if it can't: what its dimmed control's tooltip says. It changes nothing.
 */
export function markRefusal(
  tab: string,
  file: { readonly path: TreePath; readonly previous: TreePath | null },
): string | undefined {
  const can = writable(tab, file);
  return can.kind === 'refused' ? can.why : undefined;
}

/** Whether a mark or clear on `file` can be sent now, and what it needs to be, or why not. */
function writable(
  tab: string,
  file: { readonly path: TreePath; readonly previous: TreePath | null },
):
  | { kind: 'refused'; why: string }
  | { kind: 'can'; model: Model; path: string; marking: boolean; at: string } {
  // A run shows its layers' changes combined, and a mark says which layer's version was seen.
  if (runOf(tab)) return refused('Show a single layer first');
  const pull = pullOf(tab);
  if (pull?.acting?.kind !== 'account') return refused('Sign in to mark files viewed');
  const own = textOf(file.path);
  if (own === undefined) {
    return refused(
      file.path.hex === undefined
        ? 'This file’s path is too long to mark'
        : 'GitHub can’t name this file’s path',
    );
  }
  const model = modelOf(tab);
  if (!model.files) return refused('Reading changed files…');
  const old = file.previous ? textOf(file.previous) : undefined;
  const path = model.marks.githubPath(own, old);
  if (path === undefined) return refused('GitHub doesn’t list this file in this pull request');
  const marking = model.marks.state(path) !== 'VIEWED';
  const unwritable = connectionRefusal(pull);
  if (unwritable !== undefined) return refused(unwritable);
  const at = headOf(tab, pull);
  if (at === undefined) return refused('Opening pull request…');
  // GitHub marks a file viewed as of the newest push, so only a diff up to it can.
  if (marking && pull.newer !== null) return refused('This revision is out of date');
  if (marking && at !== pull.shown) return refused('Compare up to the latest revision first');
  return { kind: 'can', model, path, marking, at };
}

/**
 * Sends a toggle to main, and takes its answer: if GitHub didn't take it, GitHub's mark again, and
 * the failure, `title`, why and what was said, kept on the file for its header to show until the
 * next toggle.
 */
async function write(
  tab: string,
  model: Model,
  made: ViewedToggle,
  at: string,
  title: string,
): Promise<void> {
  let failure: MarkFailure | undefined;
  try {
    const marked: Marked = await main().markViewed({
      id: tab,
      path: made.path,
      viewed: made.mark,
      at,
    });
    switch (marked.kind) {
      case 'done':
        break;
      case 'paused':
        failure = { title, reason: `GitHub’s rate limit resets at ${timeOf(marked.until)}.` };
        break;
      case 'moved':
        failure = { title, reason: 'This revision is out of date.' };
        break;
      case 'failed':
        failure = { title, reason: marked.reason ?? undefined, details: marked.details };
        break;
      default:
        marked satisfies never;
        failure = { title, reason: undefined };
    }
  } catch (error) {
    // Main's own refusal, or no answer: no reason line, and its words behind Details.
    failure = {
      title,
      reason: undefined,
      details: error instanceof Error ? error.message : String(error),
    };
  }
  model.marks.finish(made, failure === undefined, Date.now());
  if (failure === undefined) model.failed.delete(made.path);
  else model.failed.set(made.path, failure);
  // Unless the tab closed meanwhile.
  if (models.get(tab) === model) show(tab, model);
}

/**
 * The failure on the changed file at `path`, or `previous` for a rename GitHub lists by its old
 * path, from the last mark or clear GitHub didn't take: none once a later one is sent.
 */
export function failureIn(
  marks: ShownMarks,
  path: TreePath,
  previous: TreePath | null | undefined,
): MarkFailure | undefined {
  const own = textOf(path);
  const old = previous ? textOf(previous) : undefined;
  return (
    (own === undefined ? undefined : marks.failed?.get(own)) ??
    (old === undefined ? undefined : marks.failed?.get(old))
  );
}
