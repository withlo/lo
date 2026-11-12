// Each pull request's tab's viewed marks in the window: GitHub's, as the tab's changed files say,
// with the marks Lo is setting on top until GitHub has answered (`@lo/review`'s `ViewedMarks`).
// `e` marks a file viewed, or clears its mark: the new mark shows at once and goes to main, and if
// GitHub doesn't take it, the file shows GitHub's mark again and a note says why. Nothing else of
// what `e` did goes back: where the cursor went, and what's on screen, are the reader's.

import { type ViewedToggle, ViewedMarks } from '@lo/review';

import { notify } from '../../../window/commands/notices.tsx';
import {
  changedFiles,
  pullOf,
  tabState,
  type Files,
  type PullView,
} from '../../tab/window/shared.ts';
import { PATH_LIMIT, pathBytes, type TreePath } from '../../tree/contract.ts';
import type { Marked } from '../contract.ts';
import { main } from './main.ts';
import { views } from './store.ts';

/** A changed file's viewed mark: viewed, not yet, or changed since it was viewed. */
export type Mark = 'viewed' | 'unviewed' | 'dismissed';

/** A tab's viewed marks, as they show. */
export interface ShownMarks {
  /** Each file's mark, by the path GitHub lists it at: only paths short enough to key a map by. */
  readonly byPath: ReadonlyMap<string, Mark>;
  /** How many files show as viewed, of how many the pull request changes, once GitHub has said. */
  readonly count: { readonly viewed: number; readonly total: number } | undefined;
}

const NONE: ShownMarks = { byPath: new Map(), count: undefined };

/** Each mark as GitHub's API names it. */
const GITHUB = { viewed: 'VIEWED', unviewed: 'UNVIEWED', dismissed: 'DISMISSED' } as const;

/** What each tab's marks show, re-rendering what reads them as they change. */
export const shownMarks = tabState<ShownMarks>(() => NONE);

/** Each tab's marks: GitHub's and Lo's writes, and the files GitHub last listed. */
const models = tabState<{ marks: ViewedMarks; files: Files | undefined } | undefined>(
  () => undefined,
);

/** Whether GitHub's mark on `path` is kept: its path is short enough to key a map by. */
function keyable(path: string): boolean {
  return pathBytes({ text: path }) <= PATH_LIMIT;
}

/** `tab`'s marks, made the first time, from the files main last listed. */
function modelOf(tab: string): { marks: ViewedMarks; files: Files | undefined } {
  let model = models.get(tab);
  if (!model) {
    model = { marks: new ViewedMarks(), files: undefined };
    models.set(tab, model);
    const files = changedFiles(tab);
    if (files) take(tab, model, files);
  }
  return model;
}

/** Takes the files GitHub listed, with its marks, as they reached the window just now. */
function take(
  tab: string,
  model: { marks: ViewedMarks; files: Files | undefined },
  files: Files,
): void {
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
function show(tab: string, model: { marks: ViewedMarks; files: Files | undefined }): void {
  const byPath = new Map<string, Mark>();
  let viewed = 0;
  for (const [path, state] of model.marks.shown()) {
    const mark: Mark =
      state === 'VIEWED' ? 'viewed' : state === 'DISMISSED' ? 'dismissed' : 'unviewed';
    byPath.set(path, mark);
    if (mark === 'viewed') viewed += 1;
  }
  const total = model.files?.total;
  shownMarks.set(tab, { byPath, count: total === undefined ? undefined : { viewed, total } });
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

const refused = (why: string): Toggled => ({ kind: 'refused', why });

/** A time later today, or on another day, as a note says when a pause ends. */
function timeOf(at: number): string {
  const when = new Date(at);
  const time = when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return when.toDateString() === new Date().toDateString()
    ? time
    : `${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`;
}

/** Why marks can't be written as `pull` stands with GitHub, if they can't. */
function connectionRefusal(pull: PullView, what: string): string | undefined {
  const { connection } = pull;
  switch (connection.kind) {
    case 'signedOut':
      return `${connection.login} is signed out, so Lo can’t ${what}. Sign in again from Settings.`;
    case 'offline':
      return `Lo can’t reach GitHub, so it can’t ${what} until it’s back.`;
    case 'rateLimited':
      return `GitHub asked Lo to hold off until ${timeOf(connection.until)}, so it can’t ${what} until then.`;
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
  const pull = pullOf(tab);
  if (pull?.acting?.kind !== 'account') {
    return refused('Sign in to mark files viewed: this pull request opened without an account.');
  }
  const name = file.path.text;
  const own = textOf(file.path);
  if (own === undefined) {
    return refused(
      file.path.hex === undefined
        ? `Lo marks files viewed by paths of up to ${PATH_LIMIT.toLocaleString('en-US')} bytes, and this one’s is longer.`
        : `${name}’s path isn’t UTF-8, so GitHub can’t name it, and Lo can’t mark it viewed.`,
    );
  }
  const model = modelOf(tab);
  if (!model.files) {
    return refused('GitHub hasn’t listed this pull request’s files yet. Try again in a moment.');
  }
  const old = file.previous ? textOf(file.previous) : undefined;
  const path = model.marks.githubPath(own, old);
  if (path === undefined) {
    return refused(
      `GitHub doesn’t list ${name} in this pull request, so Lo can’t mark it viewed. GitHub and the local copy see its change differently.`,
    );
  }
  const marking = model.marks.state(path) !== 'VIEWED';
  const what = marking ? `mark ${name} viewed` : `clear the viewed mark on ${name}`;
  const unwritable = connectionRefusal(pull, what);
  if (unwritable !== undefined) return refused(unwritable);
  const at = headOf(tab, pull);
  if (at === undefined) return refused('The pull request hasn’t opened yet.');
  if (marking && pull.newer !== null) {
    return refused(
      `There’s a newer push, and GitHub marks a file viewed as of the newest one, so Lo can’t ${what} until it’s loaded.`,
    );
  }
  if (marking && at !== pull.shown) {
    return refused(
      `This diff goes up to an older revision than the newest push, and GitHub marks a file viewed as of the newest one, so Lo can’t ${what} here. Compare up to the newest with g v.`,
    );
  }
  const made = model.marks.toggle(path);
  show(tab, model);
  void write(tab, model, made, at, what);
  return { kind: marking ? 'marking' : 'clearing' };
}

/** Sends a toggle to main, and takes its answer: GitHub's mark again, with a note, if it failed. */
async function write(
  tab: string,
  model: { marks: ViewedMarks; files: Files | undefined },
  made: ViewedToggle,
  at: string,
  what: string,
): Promise<void> {
  let why: string | undefined;
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
        why = `GitHub asked Lo to hold off until ${timeOf(marked.until)}, so it didn’t ${what}.`;
        break;
      case 'moved':
        why = `There’s a newer push, and GitHub marks a file viewed as of the newest one, so Lo didn’t ${what}.`;
        break;
      default:
        marked satisfies never;
        why = `Lo didn’t ${what}.`;
    }
  } catch (error) {
    why = error instanceof Error ? error.message : String(error);
  }
  model.marks.finish(made, why === undefined, Date.now());
  // Unless the tab closed meanwhile.
  if (models.get(tab) === model) show(tab, model);
  if (why !== undefined) notify(made.mark ? 'Mark viewed' : 'Clear the viewed mark', why);
}
