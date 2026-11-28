// Acting on a view's review threads in its diff, from their keys, menus and buttons: replying (a
// box right after the thread's card), resolving or unresolving, editing your comment (a box with
// GitHub's text) and deleting it, after a dialog asks. Each acts on the thread `]t` landed on, the
// only one the diff draws on the cursor's line or under the header, or the card that was pressed or
// right-clicked: never on one placed there that hasn't come on screen yet. A reply or an edit asked
// for on an overview's code block is written there beside lines, in its popover; otherwise in the
// diff on screen, as from a block between lines with the code beside. Asked for on a block while
// the diff isn't on screen and the block can't write it, it says to go to the diff first, and opens
// nothing.
// A write main sends claims its thread in the diff, so what it changes there comes at once. A
// change shows on its thread's card from the moment it's asked for, with its control at work until
// GitHub answers, and on until the view's threads show it: the card never goes back to what it was
// in between. One that didn't go, or may not have, puts the card back and says so on it, and puts
// the dot on the thread's mark while it does. Where the card isn't on screen to say it, as beside
// lines once its popover has closed, a toast says it too, whose "Show thread" shows the card.

import { deleteFacts, newestYours, changeRefusal, type ThreadComment } from '@lo/review';
import type { ThreadView } from '@lo/ui/code';
import type { HeaderTarget, LineTarget, ThreadTarget } from '@lo/ui/commands';

import { Answers, type Asked } from '../../../window/answers.ts';
import { notify, refuse } from '../../../window/commands/notices.tsx';
import { diffOnScreen, goToThread, writingDiff } from '../../diff/window/shared.ts';
import { writingBlockAsked } from '../../overview/window/shared.ts';
import { activeTab, showTabOf, tabState, type PullTab } from '../../tab/window/shared.ts';
import {
  type ActOutcome,
  type ActRefusal,
  type ActRow,
  type ActsView,
  type DraftPlaceRow,
  refusedAtOnce,
  type ThreadRow,
} from '../contract.ts';
import {
  canWrite,
  claimBriefly,
  dropStartedEdit,
  hasBox,
  homeInBlock,
  IN_DIFF,
  inputsSoFar,
  knowPull,
  loginOf,
  noDiff,
  offline,
  openAt,
  openInBlock,
} from './boxes.ts';
import { main } from './main.ts';
import { showThread } from './panel.ts';
import { threadOf } from './placing.ts';
import { tell } from './Said.tsx';
import { held, shownAt } from './threads.ts';
import { wrotePull } from './written.ts';
import { actText, noReply, type Doing } from './writing.ts';

/** Why a thread can't be acted on in the diff on screen. */
const NOT_HERE = 'This thread isn’t in this diff';

/**
 * How each view's changes to its threads stand, as main last sent them, by thread, or by comment
 * for a comment on the pull request itself.
 */
export const acting = tabState<ReadonlyMap<string, ActRow>>(() => new Map());

/** The changes whose note the reader closed, by view: each by {@link noteKey}. */
export const closedActs = tabState<ReadonlySet<string>>(() => new Set());

/** What a change is kept by: its thread, or the comment on the pull request itself it's to. */
export function actKey(row: Pick<ActRow, 'thread' | 'comment'>): string {
  return row.thread ?? row.comment ?? '';
}

/**
 * What a change's note is closed by: the change and how it stands, so that it stays closed however
 * often main says the same again, and a change asked again that fails again says so.
 */
export function noteKey(row: ActRow): string {
  return `${actKey(row)}|${row.change}|${row.stands}`;
}

/**
 * How long the control of a change GitHub took stays at work while the view's threads don't show
 * the change. The card shows what was asked for longer: until the threads are read again.
 */
export const SETTLE_WAIT = 10_000;

/**
 * The changes GitHub took that their view's threads didn't show within the wait, by
 * {@link actKey}: each card still shows what was asked, its control its own again, until the
 * threads are read again. Going back to what the threads said before would show what GitHub no
 * longer holds.
 */
export const unshown = tabState<ReadonlySet<string>>(() => new Set());

/**
 * The changes main is done with that their view's threads don't show yet, by view and by
 * {@link actKey}: each stays in {@link acting} as it stood, its control at work, until the threads
 * show it, or the wait ends.
 */
const settling = new Map<string, Map<string, ReturnType<typeof setTimeout>>>();

/** Whether view `view`'s threads show what `row` asked for: so does a thread that's gone. */
function shows(view: string, row: ActRow): boolean {
  if (row.thread === null) return true;
  const thread = held.get(view).threads?.threads.find((each) => each.id === row.thread);
  return thread === undefined || showsDone(row, thread);
}

/** Whether `thread` shows what `row` asked of it. */
function showsDone(row: ActRow, thread: ThreadRow): boolean {
  return row.change === 'delete'
    ? !thread.comments.some((each) => each.id === row.comment)
    : thread.resolved === (row.change === 'resolve');
}

/** What a change's control says while it's at work, which a screen reader hears as it starts. */
const AT_WORK: Readonly<Record<ActRow['change'], string>> = {
  resolve: 'Resolving…',
  unresolve: 'Unresolving…',
  delete: 'Deleting…',
};

/** What a screen reader hears once a change shows on its card. */
const DID: Readonly<Record<ActRow['change'], string>> = {
  resolve: 'Resolved thread',
  unresolve: 'Unresolved thread',
  delete: 'Deleted comment',
};

/** Stops the wait for view `view`'s change `key` to show, and says whether there was one. */
function endWait(view: string, key: string): boolean {
  const waits = settling.get(view);
  const timer = waits?.get(key);
  if (!waits || timer === undefined) return false;
  clearTimeout(timer);
  waits.delete(key);
  if (waits.size === 0) settling.delete(view);
  return true;
}

/** View `view`'s change `key` is no longer one the threads didn't show in time. */
function forget(view: string, key: string): void {
  if (!unshown.get(view).has(key)) return;
  unshown.update(view, (was) => new Set([...was].filter((each) => each !== key)));
}

/** View `view`'s change `key` is done with: its card is what its threads say. */
function settled(view: string, key: string, did: boolean): void {
  const waiting = endWait(view, key);
  const kept = unshown.get(view).has(key);
  if (!waiting && !kept) return;
  forget(view, key);
  const row = acting.get(view).get(key);
  if (!row) return;
  const diff = writingDiff(view);
  if (diff && row.thread !== null) claimBriefly(diff, row.thread);
  acting.update(view, (was) => new Map([...was].filter(([each]) => each !== key)));
  if (did) tell(DID[row.change]);
}

/**
 * The wait for view `view`'s change `key` to show ended: its control is its own again, and its
 * card shows what was asked until the threads are read again.
 */
function waited(view: string, key: string): void {
  if (!endWait(view, key)) return;
  const row = acting.get(view).get(key);
  if (!row) return;
  const diff = writingDiff(view);
  if (diff && row.thread !== null) claimBriefly(diff, row.thread);
  unshown.update(view, (was) => new Set([...was, key]));
  tell(DID[row.change]);
}

/**
 * View `view`'s threads were read again: a change GitHub took that they now show is done with, and
 * its card's control is its own again. One they didn't show in time is done with whatever they
 * say now.
 */
export function settleActs(view: string): void {
  // Settling one takes it out of what this goes through, which a `Map` allows.
  for (const key of settling.get(view)?.keys() ?? []) {
    const row = acting.get(view).get(key);
    if (!row || shows(view, row)) settled(view, key, true);
  }
  // Said already, as its wait ended.
  for (const key of unshown.get(view)) settled(view, key, false);
}

/** Forgets the changes of every view but those in `kept`, as their tabs close. */
export function keepActsOf(kept: ReadonlySet<string>): void {
  for (const view of answers.keys()) if (!kept.has(view)) answers.delete(view);
  for (const [view, waits] of settling) {
    if (kept.has(view)) continue;
    for (const timer of waits.values()) clearTimeout(timer);
    settling.delete(view);
  }
  for (const view of marked.keys()) if (!kept.has(view)) marked.delete(view);
}

/**
 * A change of view `view`'s ended with nothing done, as one GitHub refused: its card goes back at
 * once, with nothing to wait for, however main's acts last said it stood.
 */
function endAct(view: string, key: string): void {
  endWait(view, key);
  forget(view, key);
  const row = acting.get(view).get(key);
  if (!row) return;
  const diff = writingDiff(view);
  if (diff && row.thread !== null) claimBriefly(diff, row.thread);
  acting.update(view, (was) => new Map([...was].filter(([each]) => each !== key)));
}

/**
 * What main's acts say of each view's changes asked from here, by {@link actKey}, against main's
 * answers: main says a change is on its way, then that it isn't, before it answers, but what it
 * says can come after the answer.
 */
const answers = new Map<string, Answers>();

/** What main's acts say of view `view`'s changes asked from here. */
function answersOf(view: string): Answers {
  let own = answers.get(view);
  if (!own) {
    own = new Answers();
    answers.set(view, own);
  }
  return own;
}

/** Whether `row` says a change is on its way, as main's acts do of one until it answers. */
function onItsWay(row: ActRow | undefined): boolean {
  return row?.stands === 'waiting' || row?.stands === 'sending';
}

/**
 * Main answered the change asked of view `view`'s thread, or of its comment on the pull request
 * itself (`onPull`), `key`, as `outcome` says. Refused once on its way, the card goes back at once,
 * and what main's acts said of it on its way, still to come, changes nothing: it would show the
 * change at work, then done. So for a delete on the pull request done, which its answer says, and
 * the timeline shows. A change to a thread GitHub took shows on its card as main's acts go on to
 * say, until its threads show it, however late they come.
 */
function answered(view: string, asked: Asked, outcome: ActOutcome, onPull: boolean): void {
  const turnedDown = outcome.kind === 'refused' && !refusedAtOnce(outcome.refusal);
  const done = outcome.kind === 'done' && onPull;
  answersOf(view).answered(asked, turnedDown || done);
  if (turnedDown || done) endAct(view, asked.key);
}

/**
 * Takes how view's changes to its threads stand, as main sent it. A card that changes because of
 * it is the reader's doing: it's their write. A change main is done with, which was on its way,
 * stays as it stood until the view's threads show it ({@link settleActs}): main is done as GitHub
 * answers, and the threads are read again only after.
 */
export function takeActs(view: ActsView): void {
  const was = acting.get(view.id);
  const now = new Map(view.acts.map((row) => [actKey(row), row]));
  // What main sent before its answer to a change asked here, coming after it, changes nothing of
  // the change, until what main sent with its answer comes.
  const older = answers.get(view.id)?.take((key) => onItsWay(now.get(key))) ?? new Set();
  for (const key of older) {
    const kept = was.get(key);
    if (kept) now.set(key, kept);
    else now.delete(key);
  }
  const waits = settling.get(view.id);
  for (const [key, before] of was) {
    if (older.has(key)) continue;
    const timer = waits?.get(key);
    if (now.has(key)) {
      // Asked again: it's main's to say how it stands.
      endWait(view.id, key);
      forget(view.id, key);
      continue;
    }
    if (timer !== undefined || unshown.get(view.id).has(key)) {
      now.set(key, before);
      continue;
    }
    if (!underWay(before)) continue;
    if (shows(view.id, before)) {
      // A delete on the pull request itself that main answered says it went as its answer comes.
      // One whose answer was lost, that a look found went, says so here.
      if (before.thread !== null || before.stands === 'checking') tell(DID[before.change]);
      continue;
    }
    now.set(key, before);
    const own = settling.get(view.id) ?? new Map<string, ReturnType<typeof setTimeout>>();
    settling.set(view.id, own);
    own.set(
      key,
      setTimeout(() => waited(view.id, key), SETTLE_WAIT),
    );
  }
  const diff = writingDiff(view.id);
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const before = was.get(key);
    const after = now.get(key);
    const thread = (before ?? after)?.thread;
    if (before?.stands === after?.stands) continue;
    if (diff && thread != null) claimBriefly(diff, thread);
    // Said as it comes: the card's control and its note are drawn with their words on them. A
    // change the reader saw go that didn't, or may not have, with its card off screen, in a toast.
    if (underWay(after) && !underWay(before)) tell(AT_WORK[after.change]);
    else if (after && !underWay(after)) {
      const note = noteOf(after, false, false);
      if (note && !(underWay(before) && toastAct(view.id, after, note))) {
        tell(`${note.title}. ${note.text}`);
      }
    }
  }
  acting.set(view.id, now);
  // A closed note's change is closed while it stands as it did.
  const live = new Set([...now.values()].map(noteKey));
  const closed = closedActs.get(view.id);
  if ([...closed].some((each) => !live.has(each))) {
    closedActs.set(view.id, new Set([...closed].filter((each) => live.has(each))));
  }
}

/** Closes the note of `row`, a change of view `view`'s that didn't go, or may not have. */
export function closeAct(view: string, row: ActRow): void {
  closedActs.update(view, (was) => new Set([...was, noteKey(row)]));
}

/** What a card says of a change asked of it that didn't go, or may not have. */
export interface ActNote {
  /** What wasn't done: "Couldn’t resolve the thread", "Delete not confirmed". */
  readonly title: string;
  /** Why, in one line. */
  readonly text: string;
  /**
   * What it offers: to `try` again a change known not to have gone, or only to `check` again
   * whether one went that nobody knows about.
   */
  readonly again: 'try' | 'check';
}

/**
 * What a thread's card says of the change asked of it, if anything: that it didn't go, or may not
 * have, until the reader dismisses the note. Nothing once the thread shows what was asked anyway.
 */
export function actNote(
  row: ActRow | undefined,
  thread: ThreadRow,
  isClosed: boolean,
): ActNote | undefined {
  if (!row) return undefined;
  return noteOf(row, showsDone(row, thread), isClosed);
}

/** Whether a change asked for is still on its way, or Lo is looking whether it went. */
export function underWay(row: ActRow | undefined): row is ActRow {
  return row !== undefined && UNDER_WAY.has(row.stands);
}

/**
 * The change last asked of view `view`'s thread or comment `key`, while its card shows what that
 * asked and not what the threads say: `atWork` until GitHub took it and the threads showed it, or
 * the wait for them ended.
 */
export function askedOf(
  view: string,
  key: string,
): { readonly row: ActRow; readonly atWork: boolean } | undefined {
  const row = acting.get(view).get(key);
  return underWay(row) ? { row, atWork: !unshown.get(view).has(key) } : undefined;
}

/** What's at work on view `view`'s thread or comment `key`, as its control says it, if anything. */
export function atWork(view: string, key: string): string | undefined {
  const asked = askedOf(view, key);
  return asked?.atWork ? AT_WORK[asked.row.change] : undefined;
}

/** Whether thread `row` of view `view` shows as resolved: as last asked, while its card shows that. */
export function resolvedNow(view: string, row: ThreadRow): boolean {
  const asked = askedOf(view, row.id)?.row;
  return asked && asked.change !== 'delete' ? asked.change === 'resolve' : row.resolved;
}

const UNDER_WAY: ReadonlySet<ActRow['stands']> = new Set(['waiting', 'sending', 'checking']);

/** What a note is titled once a change is known not to have gone. */
const NOT_DONE: Readonly<Record<ActRow['change'], string>> = {
  resolve: 'Couldn’t resolve the thread',
  unresolve: 'Couldn’t unresolve the thread',
  delete: 'Couldn’t delete the comment',
};

/** What a card says when an edit of one of its comments couldn't start. */
export const COULDNT_EDIT = 'Couldn’t edit the comment';

/** What a note is titled while nobody knows whether a change went. */
const NOT_CONFIRMED: Readonly<Record<ActRow['change'], string>> = {
  resolve: 'Resolve not confirmed',
  unresolve: 'Unresolve not confirmed',
  delete: 'Delete not confirmed',
};

/**
 * What a card says of the change `row` asked of it, if anything: nothing while it's on its way,
 * when its control says so itself, nor once the card shows it done (`asked`), or the reader
 * dismissed the note. One known not to have gone offers to try it again; one nobody knows about,
 * to look again whether it went, as a comment's does.
 */
export function noteOf(row: ActRow, asked: boolean, isClosed: boolean): ActNote | undefined {
  if (isClosed || asked || UNDER_WAY.has(row.stands)) return undefined;
  const known = row.stands === 'notDone';
  return {
    title: (known ? NOT_DONE : NOT_CONFIRMED)[row.change],
    text: 'GitHub didn’t respond.',
    again: known ? 'try' : 'check',
  };
}

/**
 * What the mark of view `view`'s thread `row` says of a change the reader asked of it that didn't
 * go, or may not have, while its card says so: the card's title for it, lower case, as a mark's
 * name says it after `·`, "resolve not confirmed". Nothing otherwise.
 */
export function failureOf(view: string, row: ThreadRow): string | undefined {
  const asked = acting.get(view).get(row.id);
  const title =
    threw.get(view).get(row.id)?.title ??
    (asked && actNote(asked, row, closedActs.get(view).has(noteKey(asked))))?.title;
  return title && title.charAt(0).toLowerCase() + title.slice(1);
}

/** What each view's marks said of failed changes as its threads were last marked, by thread. */
const marked = new Map<string, string>();

/** What view `view`'s marks say of failed changes now, as one line a thread, to tell a change by. */
function failuresIn(view: string): string {
  const rows = held.get(view).threads?.threads ?? [];
  const keys = new Set([...threw.get(view).keys(), ...acting.get(view).keys()]);
  return rows
    .flatMap((row) => {
      const failure = keys.has(row.id) ? failureOf(view, row) : undefined;
      return failure === undefined ? [] : [`${row.id} ${failure}`];
    })
    .join('\n');
}

/**
 * View `view`'s `threads`, each mark saying what failed of a change asked of its thread while its
 * card says so ({@link failureOf}): `threads` itself where none did.
 */
export function markFailures(view: string, threads: readonly ThreadView[]): readonly ThreadView[] {
  marked.set(view, failuresIn(view));
  const rows = held.get(view).threads?.threads;
  if (!rows || (threw.get(view).size === 0 && acting.get(view).size === 0)) return threads;
  return threads.map((thread) => {
    const row = rows.find((each) => each.id === thread.id);
    const failure = row && failureOf(view, row);
    return failure === undefined || !thread.mark
      ? thread
      : { ...thread, mark: { ...thread.mark, failed: failure } };
  });
}

/**
 * Calls `changed` with each view whose marks no longer say what failed as its cards do, as a change
 * fails, is asked again, or its note is dismissed, so its threads are marked again.
 */
export function followFailures(changed: (view: string) => void): void {
  const check = () => {
    for (const [view, was] of marked) {
      const now = failuresIn(view);
      if (now === was) continue;
      marked.set(view, now);
      changed(view);
    }
  };
  acting.subscribe(check);
  threw.subscribe(check);
  closedActs.subscribe(check);
}

/** The toast's button that shows a thread whose card wasn't on screen to say what failed. */
const SHOW_THREAD = 'Show thread';

/**
 * Whether view `view`'s thread `thread` has its card on screen, to say what came of a change asked
 * of it: in the tab on screen, wherever a code view draws it, under its line, in a popover pinned
 * or previewed, or in an overview's code block.
 */
function cardShown(view: string, thread: string): boolean {
  if (activeTab()?.id !== view) return false;
  const cards = document.querySelectorAll(`[data-thread-id="${CSS.escape(thread)}"]`);
  return [...cards].some(seen);
}

/**
 * Whether some of `element` is on screen: drawn and visible, not in a view kept unseen and inert,
 * as a middle view not shown is, and not scrolled out of anything that clips it.
 */
function seen(element: Element): boolean {
  if (
    typeof element.checkVisibility === 'function' &&
    !element.checkVisibility({ visibilityProperty: true })
  ) {
    return false;
  }
  if (element.closest('[inert]') !== null) return false;
  const drawn = element.getBoundingClientRect();
  if (drawn.width === 0 || drawn.height === 0) return false;
  if (drawn.bottom <= 0 || drawn.top >= window.innerHeight) return false;
  for (let box = element.parentElement; box; box = box.parentElement) {
    if (getComputedStyle(box).overflowY === 'visible') continue;
    const clip = box.getBoundingClientRect();
    if (drawn.bottom <= clip.top || drawn.top >= clip.bottom) return false;
  }
  return true;
}

/**
 * Says in a toast what failed of a change asked of view `view`'s thread `thread`, where its card
 * isn't on screen to say it: its words as the card has them, at danger tone, or warning where
 * nobody knows whether it went. Its "Show thread" shows the card, which offers what to do: nothing
 * is asked of GitHub from the toast. Says whether it did.
 */
function toastAway(
  view: string,
  thread: string,
  note: { title: string; text: string; details?: string; again: 'try' | 'check' },
): boolean {
  if (cardShown(view, thread)) return false;
  notify(note.title, note.text, {
    action: { label: SHOW_THREAD, onClick: () => showActed(view, thread) },
    details: note.details,
    tone: note.again === 'check' ? 'warning' : 'danger',
  });
  return true;
}

/**
 * A toast for `row`, a change of view `view`'s that didn't go, or may not have, where its thread's
 * card says so and isn't on screen. Says whether it did.
 */
function toastAct(view: string, row: ActRow, note: ActNote): boolean {
  if (row.thread === null) return false;
  const thread = held.get(view).threads?.threads.find((each) => each.id === row.thread);
  return thread !== undefined && actNote(row, thread, false) !== undefined
    ? toastAway(view, row.thread, note)
    : false;
}

/**
 * A toast's "Show thread": the thread in its view's diff, which comes on screen first, its popover
 * pinned, focus on its line; compared first where the diff on screen doesn't have it, as the threads
 * panel shows one.
 */
function showActed(view: string, thread: string): void {
  showTabOf(view).then(
    () => {
      const tab = activeTab();
      if (tab?.kind !== 'pull' || tab.id !== view) return;
      if (!goToThread(view, thread)) showThread(tab, thread);
    },
    (error: unknown) => console.error("Lo couldn't show the tab:", error),
  );
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
    const diff = writingDiff(view);
    if (!diff) return noDiff(view);
    const under = diff.threadsDrawn(
      target.kind === 'header'
        ? { file: target.file }
        : {
            file: target.at.file,
            side: target.at.side,
            line: 'line' in target.at ? target.at.line : target.at.to,
          },
    );
    if (under.length > 1) return `Go to one of the ${under.length} threads first`;
    id = under[0];
    if (id === undefined) {
      return target.kind === 'header' ? 'No thread on this file' : 'No thread on this line';
    }
  }
  const row = held.get(view).threads?.threads.find((each) => each.id === id);
  return row ?? 'That thread was deleted elsewhere';
}

/** The tab's thread `target` names, or says why there's none. */
function found(tab: PullTab, target: ThreadKeyTarget): ThreadRow | undefined {
  const can = canWrite(tab.id);
  if (can !== true) {
    refuse(can);
    return undefined;
  }
  const row = threadFor(tab.id, target);
  if (typeof row === 'string') {
    refuse(row);
    return undefined;
  }
  return row;
}

/** `r`: a reply box in the thread, right after its card, which opens first if it's collapsed. */
export function reply(tab: PullTab, target: ThreadKeyTarget): void {
  const row = found(tab, target);
  if (!row) return;
  if (!row.viewerCanReply) {
    refuse(noReply(loginOf(tab.id)));
    return;
  }
  const where = whereToWrite(tab.id, row.id);
  if (typeof where === 'string') {
    refuse(where);
    return;
  }
  knowPull(tab);
  where.open({ kind: 'reply', thread: row.id }, '');
}

/**
 * Where a reply's or an edit's box is written: `open` opens the box at `place` with `draft`, and
 * says whether it opened.
 */
interface Writer {
  open(place: DraftPlaceRow, draft: string): boolean;
}

/**
 * Where a reply's or an edit's box in thread `thread` of view `view` is written, or why nowhere:
 * asked for on an overview's code block that shows the thread, beside lines, in the block's
 * popover; otherwise, as where the block can't draw the box, in the diff on screen ({@link inDiff}).
 */
function whereToWrite(view: string, thread: string): Writer | string {
  // Asked for in the diff, as with the code beside, it's the diff's, whatever a block has pinned.
  const block = writingBlockAsked(view, thread, writingDiff(view)?.hasFocus() ?? false);
  const home = block && homeInBlock(view, block, thread);
  const diff = inDiff(view, thread, block !== undefined);
  if (!home) return diff;
  return {
    open(place, draft) {
      if (openInBlock(view, home, place, draft, block)) return true;
      // The block couldn't draw it, as on a line it holds out of sight, and nothing's open for it
      // there.
      if (typeof diff !== 'string') return diff.open(place, draft);
      refuse(diff);
      return false;
    },
  };
}

/**
 * The diff on screen, as where a reply's or an edit's box in thread `thread` of view `view` is
 * written, where it shows the thread. Or why not: asked for on an overview's code block,
 * `fromBlock`, with the diff not on screen, to go to the diff first; otherwise, that the diff
 * doesn't have the thread. A diff drawn but hidden is none: its boxes are out of reach.
 */
function inDiff(view: string, thread: string, fromBlock: boolean): Writer | string {
  const diff = diffOnScreen(view) ? writingDiff(view) : undefined;
  if (!diff) return fromBlock ? noDiff(view) : NOT_HERE;
  if (shownAt(view, thread) === undefined) return NOT_HERE;
  return {
    open(place, draft) {
      diff.openThread(thread, true);
      return openAt(view, diff, IN_DIFF, place, 'review', draft) !== undefined;
    },
  };
}

/** Whether every comment of a thread waits in your pending review: nothing's on GitHub yet. */
function pendingOnly(row: ThreadRow): boolean {
  return row.comments.every((each) => each.state === 'PENDING');
}

/** Says why a change to a thread of view `view`'s wasn't made. */
function refused(view: string, refusal: ActRefusal, doing: Doing): void {
  refuse(actText(refusal, doing, loginOf(view)));
}

/**
 * A change asked of a thread, or of a comment on the pull request itself, that failed in Lo before
 * GitHub had it, as its card says it until it's asked again: what wasn't done, what came back, and
 * the one thing to do.
 */
export interface Threw {
  /** What wasn't done: "Couldn’t resolve the thread". */
  readonly title: string;
  /** What came back, as it came, behind Details. */
  readonly details: string;
  /** "Try again", which asks again; or "Check again", which only looks, where it may have gone. */
  readonly again: 'try' | 'check';
  /** What its button does. */
  readonly run: () => void;
}

/** Each view's changes whose write failed in Lo, by thread, or by comment on the pull request. */
export const threw = tabState<ReadonlyMap<string, Threw>>(() => new Map());

/**
 * Says on the card of view `view`'s thread or comment `key` that the change asked of it failed,
 * with `error`, what came back: its title, and `again`, the button that runs `run`. Said once, on
 * the card, which a screen reader hears as an alert.
 */
export function failed(
  view: string,
  key: string,
  title: string,
  error: unknown,
  run: () => void,
  again: Threw['again'] = 'try',
): void {
  console.error(`Lo couldn't change ${key}:`, error);
  const details = error instanceof Error ? error.message : String(error);
  threw.update(view, (was) => new Map(was).set(key, { title, details, again, run }));
  // A thread's card that isn't on screen can't say it.
  if (held.get(view).threads?.threads.some((each) => each.id === key)) {
    toastAway(view, key, { title, text: '', details, again });
  }
}

/** Takes away what the card of view `view`'s thread or comment `key` says of a write that failed. */
export function unfailed(view: string, key: string): void {
  if (!threw.get(view).has(key)) return;
  threw.update(view, (was) => {
    const now = new Map(was);
    now.delete(key);
    return now;
  });
}

/**
 * `x`: resolves the thread, or unresolves it once it's resolved, where GitHub lets you. It's
 * claimed in the diff, so it changes there at once.
 */
export function resolve(tab: PullTab, target: ThreadKeyTarget): void {
  const row = found(tab, target);
  if (row) void resolveThread(tab, row);
}

/** Resolves thread `row` of tab `tab`, or unresolves it once it's resolved: `x` on it anywhere. */
export async function resolveThread(tab: PullTab, row: ThreadRow): Promise<void> {
  const view = tab.id;
  // One at a time: while a change to it is at work, its control says so, and takes nothing.
  if (atWork(view, row.id) !== undefined) return;
  // From what its card shows: what was last asked, where the threads don't show that yet.
  const asked = askedOf(view, row.id)?.row;
  const resolved = !resolvedNow(view, row);
  const doing = resolved ? 'resolve' : 'unresolve';
  if (pendingOnly(row)) {
    refuse('Submit your review to resolve this thread');
    return;
  }
  // What the threads say you can do is of the thread as it was before a change they don't show.
  const stale = asked !== undefined && asked.change !== 'delete';
  if (!stale && !(resolved ? row.viewerCanResolve : row.viewerCanUnresolve)) {
    refused(view, { kind: 'cantResolve', resolved }, doing);
    return;
  }
  const away = offline(view);
  if (away !== undefined) {
    refuse(away);
    return;
  }
  unfailed(view, row.id);
  const release = writingDiff(view)?.claimThread(row.id) ?? (() => {});
  const ask = answersOf(view).ask(row.id);
  let answeredYet = false;
  try {
    const outcome = await main().resolve({ id: view, thread: row.id, resolved });
    answeredYet = true;
    answered(view, ask, outcome, false);
    if (outcome.kind === 'refused') {
      release();
      refused(view, outcome.refusal, doing);
    }
  } catch (error) {
    if (!answeredYet) answersOf(view).answered(ask, false);
    release();
    endAct(view, row.id);
    failed(view, row.id, NOT_DONE[doing], error, () => {
      const now = threadFor(view, { kind: 'thread', thread: row.id });
      if (typeof now === 'string') refuse(now);
      else if (resolvedNow(view, now) !== resolved) void resolveThread(tab, now);
    });
  }
}

/**
 * Your comment in `row` that `change` acts on: `comment` where its menu or the ring names it, or
 * your newest. Why there's none otherwise, in the words that refuse it; nothing while the view
 * acts as nobody.
 */
function chosenIn(
  view: string,
  row: ThreadRow,
  change: 'edit' | 'delete',
  comment?: string,
): ThreadComment | string | undefined {
  const login = loginOf(view);
  if (login === undefined) return undefined;
  const thread = threadOf(row);
  let chosen;
  if (comment === undefined) {
    chosen = newestYours(thread, login, change);
  } else {
    const named = thread.comments.find((each) => each.id === comment);
    if (!named) return actText({ kind: 'gone' }, change, login);
    chosen = changeRefusal(named, login, change) ?? named;
  }
  if (!('refusal' in chosen)) return chosen;
  switch (chosen.refusal) {
    case 'noneOfYours':
      return 'None of these comments are yours';
    case 'theirs':
      return actText({ kind: 'theirs', author: chosen.author ?? null }, change, login);
    case 'notAllowed':
      return actText({ kind: 'notAllowed', reasons: [] }, change, login);
    default:
      chosen satisfies never;
      return actText({ kind: 'notAllowed', reasons: [] }, change, login);
  }
}

/** Your comment in `row` that `change` acts on, as `chosenIn` finds it, saying why there's none. */
function yours(
  view: string,
  row: ThreadRow,
  change: 'edit' | 'delete',
  comment?: string,
): ThreadComment | undefined {
  const chosen = chosenIn(view, row, change, comment);
  if (typeof chosen !== 'string') return chosen;
  refuse(chosen);
  return undefined;
}

/**
 * Why `change` can't be made to the comment `target` names, as a right-click on it or its `⋯` does,
 * for its menu to dim Edit or Delete with: it isn't yours, GitHub doesn't let you, or it's gone.
 * Nothing where it can, or where `target` names no comment, whose key acts on your newest.
 */
export function whyNotOn(
  view: string,
  target: ThreadKeyTarget,
  change: 'edit' | 'delete',
): string | undefined {
  if (target.kind !== 'thread' || target.comment === undefined) return undefined;
  const row = threadFor(view, target);
  if (typeof row === 'string') return row;
  const chosen = chosenIn(view, row, change, target.comment);
  return typeof chosen === 'string' ? chosen : undefined;
}

/**
 * `i`: a box with your newest comment in the thread, or the one a card's Edit named, right after
 * its card, to edit it. What it starts from is GitHub's text as the card shows it, kept with the
 * draft, and the edit is saved over it only if GitHub still has it.
 */
export async function edit(tab: PullTab, target: ThreadKeyTarget, comment?: string): Promise<void> {
  const view = tab.id;
  const row = found(tab, target);
  if (!row) return;
  const chosen = yours(view, row, 'edit', comment);
  if (!chosen) return;
  const asked = whereToWrite(view, row.id);
  if (typeof asked === 'string') {
    refuse(asked);
    return;
  }
  const place = { kind: 'edit' as const, thread: row.id, comment: chosen.id };
  unfailed(view, row.id);
  // A draft of the edit kept from before stays, whatever comes; one main starts now goes if no box
  // opens for it.
  const started = !hasBox(view, place);
  const inputs = inputsSoFar();
  try {
    const outcome = await main().editing({ id: view, place, base: chosen.body });
    if (outcome.kind === 'refused') {
      refused(view, outcome.refusal, 'edit');
      return;
    }
  } catch (error) {
    failed(view, row.id, COULDNT_EDIT, error, () => void edit(tab, target, chosen.id));
    return;
  }
  // The reader moved on meanwhile, by a key, a click or the wheel, as to another tab, which may
  // have closed, or where it's written went: nothing opens, what they typed went where it went, and
  // the draft main started goes, as an untouched edit's does as its box closes.
  const moved = inputsSoFar() !== inputs || activeTab()?.id !== view;
  const where = moved ? undefined : whereToWrite(view, row.id);
  if (where !== undefined && typeof where !== 'string') {
    knowPull(tab);
    if (where.open(place, chosen.body)) return;
  }
  if (started) dropStartedEdit(view, place);
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
  /** It's its thread's only comment: the thread is deleted with it. */
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
  const row = found(tab, target);
  // One at a time: while a change to the thread is at work, its control says so.
  if (!row || atWork(tab.id, row.id) !== undefined) return;
  const chosen = yours(tab.id, row, 'delete', comment);
  if (!chosen) return;
  // Nothing would go: it's refused now, not after the question.
  const away = offline(tab.id);
  if (away !== undefined) {
    refuse(away);
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
  // One at a time: a change asked of it since the question opened is still at work.
  const busy = atWork(tab.id, thread ?? comment);
  if (busy !== undefined) {
    refuse(busy);
    return;
  }
  const away = offline(tab.id);
  if (away !== undefined) {
    refuse(away);
    return;
  }
  const key = thread ?? comment;
  unfailed(tab.id, key);
  const release =
    thread === null ? () => {} : (writingDiff(tab.id)?.claimThread(thread) ?? (() => {}));
  const ask = answersOf(tab.id).ask(key);
  let answeredYet = false;
  try {
    const outcome = await main().remove({
      id: tab.id,
      thread,
      comment,
      asked: { body, pending, onlyComment },
    });
    answeredYet = true;
    answered(tab.id, ask, outcome, thread === null);
    if (outcome.kind === 'refused') {
      release();
      refused(tab.id, outcome.refusal, 'delete');
    } else if (outcome.kind === 'done' && thread === null) {
      tell(DID.delete);
      wrotePull(tab.id, { kind: 'deleted', comment });
    }
  } catch (error) {
    if (!answeredYet) answersOf(tab.id).answered(ask, false);
    release();
    endAct(tab.id, key);
    // Asked again, it asks first again.
    failed(tab.id, thread ?? comment, NOT_DONE.delete, error, () => {
      if (thread !== null) remove(tab, { kind: 'thread', thread }, comment);
      else setAsking({ ...asked, tab });
    });
  }
}

/**
 * Looks again whether the change `row` names went, as its note's "Check again" does: nothing is
 * sent again, and the card's control is at work meanwhile.
 */
export function checkAgain(tab: PullTab, row: ActRow): void {
  const key = actKey(row);
  unfailed(tab.id, key);
  main()
    .checkAct({ id: tab.id, node: key })
    .catch((error: unknown) =>
      failed(tab.id, key, NOT_CONFIRMED[row.change], error, () => checkAgain(tab, row), 'check'),
    );
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
    refuse(now);
    return;
  }
  // Asked again as it was, unless the thread shows it done now.
  if (now.resolved === (row.change === 'resolve')) return;
  void resolveThread(tab, now);
}
