// Acting on a view's review threads in its diff, from their keys, menus and buttons: replying (a
// box right after the thread's card), resolving or unresolving, editing your comment (a box with
// GitHub's text) and deleting it, after a dialog asks. Each acts on the thread `]t` landed on, the
// only one the diff draws on the cursor's line or under the header, or the card that was pressed or
// right-clicked: never on one placed there that hasn't come on screen yet.
// A write main sends claims its thread in the diff, so what it changes there comes at once. How a
// change main sent stands, while Lo checks whether it went after GitHub's answer was lost, shows
// on its thread's card.

import { deleteFacts, newestYours, changeRefusal, type ThreadComment } from '@lo/review';
import type { HeaderTarget, LineTarget, ThreadTarget } from '@lo/ui/commands';

import { notify } from '../../../window/commands/notices.tsx';
import { writingDiff } from '../../diff/window/shared.ts';
import { tabState, type PullTab } from '../../tab/window/shared.ts';
import type { ActRefusal, ActRow, ActsView, ThreadRow } from '../contract.ts';
import { canWrite, claimBriefly, knowPull, loginOf, offline, openAt } from './boxes.ts';
import { main } from './main.ts';
import { threadOf } from './placing.ts';
import { held, shownAt } from './threads.ts';
import { wrotePull } from './written.ts';
import { actText, NO_REPLY, type Doing } from './writing.ts';

/** Why a change to a thread can't go while GitHub can't be reached. */
export const OFFLINE_ACT = 'Offline. Try again once GitHub can be reached.';

/**
 * How each view's changes to its threads stand, as main last sent them, by thread, or by comment
 * for a comment on the pull request itself.
 */
export const acting = tabState<ReadonlyMap<string, ActRow>>(() => new Map());

/** The changes whose note the reader closed, by view. */
export const closedActs = tabState<ReadonlySet<ActRow>>(() => new Set());

/** What a change is kept by: its thread, or the comment on the pull request itself it's to. */
export function actKey(row: Pick<ActRow, 'thread' | 'comment'>): string {
  return row.thread ?? row.comment ?? '';
}

/**
 * Takes how view's changes to its threads stand, as main sent it. A card that changes because of
 * it is the reader's doing: it's their write.
 */
export function takeActs(view: ActsView): void {
  const was = acting.get(view.id);
  const now = new Map(view.acts.map((row) => [actKey(row), row]));
  const diff = writingDiff(view.id);
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const before = was.get(key);
    const after = now.get(key);
    const thread = (before ?? after)?.thread;
    if (before?.stands !== after?.stands && diff && thread != null) claimBriefly(diff, thread);
  }
  acting.set(view.id, now);
}

/** Closes the note of `row`, a change of view `view`'s that didn't go, or may not have. */
export function closeAct(view: string, row: ActRow): void {
  closedActs.update(view, (was) => new Set([...was, row]));
}

/** What a card says of a change asked of it, while it says anything. */
export interface ActNote {
  readonly text: string;
  readonly again: boolean;
  readonly checking: boolean;
}

/**
 * What a thread's card says of the change asked of it, if anything: that Lo is checking whether it
 * went, or that it didn't, or may not have, until the reader closes the note. Nothing once the
 * thread shows what was asked anyway.
 */
export function actNote(
  row: ActRow | undefined,
  thread: ThreadRow,
  isClosed: boolean,
): ActNote | undefined {
  if (!row) return undefined;
  const asked =
    row.change === 'delete'
      ? !thread.comments.some((each) => each.id === row.comment)
      : thread.resolved === (row.change === 'resolve');
  return noteOf(row, asked, isClosed);
}

/**
 * What a card says of the change `row` asked of it, if anything: nothing once the card shows it
 * done (`asked`), or the reader closed the note.
 */
export function noteOf(row: ActRow, asked: boolean, isClosed: boolean): ActNote | undefined {
  if (isClosed) return undefined;
  if (row.stands === 'waiting' || row.stands === 'sending') return undefined;
  const what = {
    resolve: 'resolved the thread',
    unresolve: 'unresolved the thread',
    delete: 'deleted your comment',
  }[row.change];
  switch (row.stands) {
    case 'checking':
      return asked
        ? undefined
        : {
            text: `GitHub’s answer was lost. Lo is checking whether it ${what}.`,
            again: false,
            checking: true,
          };
    case 'notDone':
      return asked
        ? undefined
        : {
            text: `GitHub’s answer was lost, and it hadn’t ${what}. Try again?`,
            again: true,
            checking: false,
          };
    case 'unknown':
      return asked
        ? undefined
        : {
            text: `GitHub’s answer was lost, and Lo can’t tell whether it ${what}.`,
            again: true,
            checking: false,
          };
    default:
      row.stands satisfies never;
      return undefined;
  }
}

/** A key's target that names a thread, or may, as `]t` or the cursor's line does. */
export type ThreadKeyTarget = LineTarget | HeaderTarget | ThreadTarget;

/**
 * The thread `target` names in view `view`'s diff, as main last sent it: the thread a card, the
 * panel or `]t` named, or the only one the diff draws under the cursor's line, or under the
 * header. Why there's none otherwise.
 */
export function threadFor(view: string, target: ThreadKeyTarget): ThreadRow | string {
  let id: string | undefined;
  if (target.kind === 'thread' || target.thread !== undefined) id = target.thread;
  else {
    const diff = writingDiff(view, true) ?? writingDiff(view);
    if (!diff) return 'The diff isn’t drawn yet.';
    const under = diff.threadsDrawn(
      target.kind === 'header'
        ? { file: target.file }
        : {
            file: target.at.file,
            side: target.at.side,
            line: 'line' in target.at ? target.at.line : target.at.to,
          },
    );
    if (under.length > 1) return `There are ${under.length} threads here. Press ]t to pick one.`;
    id = under[0];
    if (id === undefined) {
      return target.kind === 'header'
        ? 'There’s no thread on this file.'
        : 'There’s no thread on this line.';
    }
  }
  const row = held.get(view).threads?.threads.find((each) => each.id === id);
  return row ?? 'The thread is gone from GitHub.';
}

/** The tab's thread `target` names, or says why there's none, under `title`. */
function found(tab: PullTab, target: ThreadKeyTarget, title: string): ThreadRow | undefined {
  const can = canWrite(tab.id);
  if (can !== true) {
    notify(title, can);
    return undefined;
  }
  const row = threadFor(tab.id, target);
  if (typeof row === 'string') {
    notify(title, row);
    return undefined;
  }
  return row;
}

/** `r`: a reply box in the thread, right after its card, which opens first if it's collapsed. */
export function reply(tab: PullTab, target: ThreadKeyTarget): void {
  const title = 'Reply';
  const row = found(tab, target, title);
  if (!row) return;
  if (!row.viewerCanReply) {
    notify(title, `${NO_REPLY}.`);
    return;
  }
  const diff = writingDiff(tab.id, true) ?? writingDiff(tab.id);
  if (!diff || shownAt(tab.id, row.id) === undefined) {
    notify(title, 'The thread isn’t in the diff on screen.');
    return;
  }
  knowPull(tab);
  diff.openThread(row.id, true);
  openAt(tab.id, diff, { kind: 'reply', thread: row.id }, 'review');
}

/** Whether every comment of a thread waits in your pending review: nothing's on GitHub yet. */
function pendingOnly(row: ThreadRow): boolean {
  return row.comments.every((each) => each.state === 'PENDING');
}

/** Says why a change wasn't made, under `title`. */
function refused(title: string, refusal: ActRefusal, doing: Doing): void {
  notify(title, actText(refusal, doing));
}

/**
 * `x`: resolves the thread, or unresolves it once it's resolved, where GitHub lets you. It's
 * claimed in the diff, so it changes there at once.
 */
export function resolve(tab: PullTab, target: ThreadKeyTarget): void {
  const row = found(tab, target, 'Resolve');
  if (row) void resolveThread(tab, row);
}

/** Resolves thread `row` of tab `tab`, or unresolves it once it's resolved: `x` on it anywhere. */
export async function resolveThread(tab: PullTab, row: ThreadRow): Promise<void> {
  const view = tab.id;
  const resolved = !row.resolved;
  const doing = resolved ? 'resolve' : 'unresolve';
  const title = resolved ? 'Resolve' : 'Unresolve';
  if (pendingOnly(row)) {
    notify(
      title,
      'It’s in your pending review: there’s nothing on GitHub to resolve until you send it.',
    );
    return;
  }
  if (!(resolved ? row.viewerCanResolve : row.viewerCanUnresolve)) {
    refused(title, { kind: 'cantResolve', resolved }, doing);
    return;
  }
  if (offline(view)) {
    notify(title, OFFLINE_ACT);
    return;
  }
  const release = writingDiff(view)?.claimThread(row.id) ?? (() => {});
  try {
    const outcome = await main().resolve({ id: view, thread: row.id, resolved });
    if (outcome.kind === 'refused') {
      release();
      refused(title, outcome.refusal, doing);
    }
  } catch (error) {
    release();
    notify(title, error instanceof Error ? error.message : String(error));
  }
}

/**
 * Your comment in `row` that `change` acts on: `comment` when a card's button named it, or your
 * newest. Says why there's none, under `title`.
 */
function yours(
  view: string,
  row: ThreadRow,
  change: 'edit' | 'delete',
  title: string,
  comment?: string,
): ThreadComment | undefined {
  const login = loginOf(view);
  if (login === undefined) return undefined;
  const thread = threadOf(row);
  let chosen;
  if (comment === undefined) {
    chosen = newestYours(thread, login, change);
  } else {
    const named = thread.comments.find((each) => each.id === comment);
    if (!named) {
      notify(title, 'It’s gone from GitHub.');
      return undefined;
    }
    chosen = changeRefusal(named, login, change) ?? named;
  }
  if (!('refusal' in chosen)) return chosen;
  switch (chosen.refusal) {
    case 'noneOfYours':
      notify(
        title,
        'None of this thread’s comments are yours. You can edit and delete only your own.',
      );
      return undefined;
    case 'theirs':
      refused(title, { kind: 'theirs', author: chosen.author ?? null }, change);
      return undefined;
    case 'notAllowed':
      refused(title, { kind: 'notAllowed', reasons: [] }, change);
      return undefined;
    default:
      chosen satisfies never;
      return undefined;
  }
}

/**
 * `i`: a box with your newest comment in the thread, or the one a card's Edit named, right after
 * its card, to edit it. What it starts from is GitHub's text as the card shows it, kept with the
 * draft, and the edit is saved over it only if GitHub still has it.
 */
export async function edit(tab: PullTab, target: ThreadKeyTarget, comment?: string): Promise<void> {
  const view = tab.id;
  const title = 'Edit your comment';
  const row = found(tab, target, title);
  if (!row) return;
  const chosen = yours(view, row, 'edit', title, comment);
  if (!chosen) return;
  const diff = writingDiff(view, true) ?? writingDiff(view);
  if (!diff || shownAt(view, row.id) === undefined) {
    notify(title, 'The thread isn’t in the diff on screen.');
    return;
  }
  const place = { kind: 'edit' as const, thread: row.id, comment: chosen.id };
  try {
    const outcome = await main().editing({ id: view, place, base: chosen.body });
    if (outcome.kind === 'refused') {
      refused(title, outcome.refusal, 'edit');
      return;
    }
  } catch (error) {
    notify(title, error instanceof Error ? error.message : String(error));
    return;
  }
  knowPull(tab);
  diff.openThread(row.id, true);
  openAt(view, diff, place, 'review', chosen.body);
}

/** What the dialog that asks before a comment is deleted shows, while it's open. */
export interface DeleteAsking {
  readonly tab: PullTab;
  /** Its thread: none for a comment on the pull request itself. */
  readonly thread: string | null;
  readonly comment: string;
  /** Its text, as the card shows it. */
  readonly body: string;
  readonly pending: boolean;
  /** It's its thread's only comment, so the thread goes too. */
  readonly onlyComment: boolean;
}

let asking: DeleteAsking | undefined;
const listeners = new Set<() => void>();

/** Opens the question to delete a comment, or closes it. */
export function setAsking(next: DeleteAsking | undefined): void {
  asking = next;
  for (const listener of listeners) listener();
}

/** The question open now, if one is. */
export function deleteAsking(): DeleteAsking | undefined {
  return asking;
}

export function subscribeAsking(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * `dd`: asks before deleting your newest comment in the thread, or the one a card's Delete named.
 * Nothing goes until the dialog's Delete is pressed.
 */
export function remove(tab: PullTab, target: ThreadKeyTarget, comment?: string): void {
  const title = 'Delete your comment';
  const row = found(tab, target, title);
  if (!row) return;
  const chosen = yours(tab.id, row, 'delete', title, comment);
  if (!chosen) return;
  // Nothing would go: it's refused now, not after the question.
  if (offline(tab.id)) {
    notify(title, OFFLINE_ACT);
    return;
  }
  const facts = deleteFacts(threadOf(row), chosen, undefined);
  setAsking({
    tab,
    thread: row.id,
    comment: chosen.id,
    body: chosen.body,
    pending: facts.pending,
    onlyComment: facts.onlyComment,
  });
}

/** Closes the question with nothing deleted. */
export function cancelDelete(): void {
  setAsking(undefined);
}

/**
 * The question's Delete: deletes the comment, if GitHub still has it as the question showed it.
 * Its thread is claimed in the diff, so it changes there at once; a comment on the pull request
 * itself, in the timeline.
 */
export async function confirmDelete(): Promise<void> {
  const asked = asking;
  if (!asked) return;
  setAsking(undefined);
  const { tab, thread, comment, body, pending, onlyComment } = asked;
  const title = 'Delete your comment';
  if (offline(tab.id)) {
    notify(title, OFFLINE_ACT);
    return;
  }
  const release =
    thread === null ? () => {} : (writingDiff(tab.id)?.claimThread(thread) ?? (() => {}));
  try {
    const outcome = await main().remove({
      id: tab.id,
      thread,
      comment,
      asked: { body, pending, onlyComment },
    });
    if (outcome.kind === 'refused') {
      release();
      refused(title, outcome.refusal, 'delete');
    } else if (outcome.kind === 'done' && thread === null) {
      wrotePull(tab.id, { kind: 'deleted', comment });
    }
  } catch (error) {
    release();
    notify(title, error instanceof Error ? error.message : String(error));
  }
}

/** Asks for the change `row` names again, as its note's "Try again" does. */
export function tryAgain(tab: PullTab, row: ActRow): void {
  closeAct(tab.id, row);
  if (row.thread === null) return;
  const thread = { kind: 'thread' as const, thread: row.thread };
  if (row.change === 'delete') {
    if (row.comment !== null) remove(tab, thread, row.comment);
    return;
  }
  const now = threadFor(tab.id, thread);
  if (typeof now === 'string') {
    notify(row.change === 'resolve' ? 'Resolve' : 'Unresolve', now);
    return;
  }
  // Asked again as it was, unless the thread shows it done now.
  if (now.resolved === (row.change === 'resolve')) return;
  void resolveThread(tab, now);
}
