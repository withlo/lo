// What changing the queue does in the window: `x` and `J` open the queue's dialog on the row the
// keyboard is on, naming the change and the entry from the start, and ask main for a plan to
// confirm; the dialog confirms its key, then shows the change at work, why it didn't go, or that
// GitHub's answer was lost, with "Check again", which only looks. It closes once the change went,
// and a toast says so. The window never sends a change itself. A question that no longer stands
// says why in the dialog, or is asked again where the change can be planned afresh, as main reads
// the queue. `a` turns auto-merge off at once for a pull request waiting to join, its row's button
// at work meanwhile; for one that left the queue, it opens its tab, and asks there, through the
// merge panel's own confirmation. What didn't go once the dialog was closed, and auto-merge that
// didn't go off, shows under its row, with what can be done about it.

import { runControl, type NoTarget, type RowTarget } from '@lo/ui/commands';
import { createStore } from 'zustand/vanilla';

import { announce } from '../../../window/commands/notices.tsx';
import { explain } from '../../../window/explain.ts';
import { signInAgain } from '../../accounts/window/shared.ts';
import { askAutoMerge } from '../../merge/window/shared.ts';
import type { QueueTab } from '../../tab/contract.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type {
  Acted,
  ActKind,
  ActNext,
  ActPlan,
  ActWhy,
  QueueRead,
  QueueState,
} from '../contract.ts';
import { drawnQueue, numberOf, queueOnScreen, rowsIn } from './actions.ts';
import { main } from './main.ts';
import { entryKey, type Row } from './rows.ts';
import { queueOf, queuesStore } from './store.ts';

/**
 * What the dialog names from the moment it opens, as the row the keyboard was on had it: the change
 * asked for, the entry and where it stood, in which tab's queue, and as whom.
 */
export interface Sketch {
  /** The merge queue's tab. */
  readonly id: string;
  readonly branch: string;
  readonly login: string;
  readonly kind: ActKind;
  readonly number: number;
  readonly title: string;
  readonly position: number;
  /** When the entry joined the queue, as Lo read it: one moved to the front joins it again. */
  readonly enqueuedAt: number | null;
}

/** Why a change didn't go, or isn't known to have, with what failed as its title. */
export interface Failure extends ActWhy {
  readonly title: string;
}

/**
 * Why `failure` happened, as its reason line says it: its cause, worded as the guide does, else
 * main's words, without the characters that turn text around; nothing where neither says why.
 */
export function reasonOf(failure: ActWhy): string | undefined {
  const said = failure.cause === undefined ? failure.why : (explain(failure.cause) ?? '');
  return said === '' ? undefined : withoutBidi(said);
}

/**
 * Where the dialog has got to:
 *
 * - `planning`: main is planning the change; `again` is the plan of one that didn't go, which goes
 *   at once once planned the same, as "Try again" asked; `note` says why it's asked again;
 * - `ask`: the plan, for the reader to confirm, with `note`, what changed since one before it;
 * - `checking`: confirmed, and main checks it before it's sent, which Cancel still stops;
 * - `sent`: main sent it, and it's at work;
 * - `gone`: the question no longer stands, as `why` says;
 * - `failed`: it didn't go, or not all of it;
 * - `unknown`: GitHub's answer was lost, so what it did isn't known, until "Check again" looks.
 */
export type Step =
  | {
      readonly kind: 'planning';
      readonly again: ActPlan | undefined;
      readonly note: string | undefined;
    }
  | { readonly kind: 'ask'; readonly plan: ActPlan; readonly note: string | undefined }
  | { readonly kind: 'checking'; readonly plan: ActPlan }
  | { readonly kind: 'sent'; readonly plan: ActPlan }
  | { readonly kind: 'gone'; readonly plan: ActPlan | undefined; readonly why: string }
  | { readonly kind: 'failed'; readonly plan: ActPlan | undefined; readonly failure: Failure }
  | {
      readonly kind: 'unknown';
      readonly plan: ActPlan;
      readonly failure: Failure;
      readonly looking: boolean;
    };

/** The queue's dialog: what it names, and where it has got to. */
export interface QueueDialog {
  readonly sketch: Sketch;
  readonly step: Step;
}

/** A write at work on a pull request, which its row's button shows. */
export type Working = ActKind | 'autoMergeOff';

/** What was asked of a row whose problem shows under it. */
export type Asked = ActKind | 'autoMergeOff' | 'open';

/**
 * What went wrong with what was asked of pull request `number`'s row in merge queue tab `id`, under
 * the row: once the dialog was closed, a change that didn't go or whose answer was lost; auto-merge
 * that didn't go off; or its tab that didn't open. `plan` and `enqueuedAt` are what "Check again"
 * looks for, and `busy` says it's looking.
 */
export interface RowProblem extends Failure {
  readonly id: string;
  readonly number: number;
  readonly asked: Asked;
  readonly plan?: ActPlan | undefined;
  readonly enqueuedAt?: number | null | undefined;
  /** GitHub's answer was lost: its button is "Check again". */
  readonly unknown?: boolean | undefined;
  readonly busy?: boolean | undefined;
}

interface Acting {
  readonly dialog: QueueDialog | undefined;
  /** The pull requests with a write at work, by {@link workKey}. */
  readonly working: ReadonlyMap<string, Working>;
  /** The problems under rows, by {@link problemKey}. */
  readonly problems: ReadonlyMap<string, RowProblem>;
}

export const acting = createStore<Acting>()(() => ({
  dialog: undefined,
  working: new Map(),
  problems: new Map(),
}));

function setDialog(dialog: QueueDialog | undefined): void {
  acting.setState({ dialog });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** A row's problem's key: its tab, then its pull request. */
export function problemKey(id: string, number: number): string {
  return `${id} ${number}`;
}

/** The problem under pull request `number`'s row in merge queue tab `id`, if there's one. */
export function problemOf(id: string, number: number): RowProblem | undefined {
  return acting.getState().problems.get(problemKey(id, number));
}

function setProblem(problem: RowProblem): void {
  acting.setState(({ problems }) => ({
    problems: new Map(problems).set(problemKey(problem.id, problem.number), problem),
  }));
}

function clearProblem(id: string, number: number): void {
  const key = problemKey(id, number);
  if (!acting.getState().problems.has(key)) return;
  acting.setState(({ problems }) => {
    const next = new Map(problems);
    next.delete(key);
    return { problems: next };
  });
}

/**
 * What names pull request `number` of `owner/repo` among the writes at work: by its repository
 * too, since another repository's queue may have its number.
 */
export function workKey(owner: string, repo: string, number: number): string {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

function setWorking(key: string, working: Working | undefined): void {
  acting.setState(({ working: was }) => {
    const next = new Map(was);
    if (working === undefined) next.delete(key);
    else next.set(key, working);
    return { working: next };
  });
}

/** A queue's place as a reader says it: "1st", "2nd", "23rd". */
export function ordinal(place: number): string {
  const tens = place % 100;
  if (tens >= 11 && tens <= 13) return `${place}th`;
  switch (place % 10) {
    case 1:
      return `${place}st`;
    case 2:
      return `${place}nd`;
    case 3:
      return `${place}rd`;
    default:
      return `${place}th`;
  }
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** What `x` or `J` asks, as the dialog's title: "Remove #264 from merge queue?". */
export function confirmTitle(plan: Pick<ActPlan, 'kind' | 'number'>): string {
  switch (plan.kind) {
    case 'remove':
      return `Remove #${plan.number} from merge queue?`;
    case 'jump':
      return `Move #${plan.number} to front?`;
    default:
      plan.kind satisfies never;
      return '';
  }
}

/** The dialog's main button for `kind`: the title's verb and object. */
export function confirmLabel(kind: ActKind): string {
  switch (kind) {
    case 'remove':
      return 'Remove from merge queue';
    case 'jump':
      return 'Move to front';
    default:
      kind satisfies never;
      return '';
  }
}

/** What a write says while it's at work, on its button. */
export function workingWord(working: Working): string {
  switch (working) {
    case 'remove':
      return 'Removing…';
    case 'jump':
      return 'Moving…';
    case 'autoMergeOff':
      return 'Turning off…';
    default:
      working satisfies never;
      return '';
  }
}

/** What failed, for a change that didn't go, or for what failed as it was checked first. */
export function failedTitle(kind: ActKind, number: number, checking = false): string {
  if (checking) return `Couldn’t check #${number}`;
  switch (kind) {
    case 'remove':
      return `Couldn’t remove #${number} from the merge queue`;
    case 'jump':
      return `Couldn’t move #${number} to the front`;
    default:
      kind satisfies never;
      return '';
  }
}

/** What isn't known, for a change whose answer was lost. */
export function unknownTitle(kind: ActKind): string {
  switch (kind) {
    case 'remove':
      return 'Removal not confirmed';
    case 'jump':
      return 'Move not confirmed';
    default:
      kind satisfies never;
      return '';
  }
}

/** What else the change does, beyond its title, a line each. */
export function effectsOf(plan: Pick<ActPlan, 'kind' | 'above'>): string[] {
  switch (plan.kind) {
    case 'remove':
      if (plan.above.length === 0) return [];
      return plan.above.length === 1
        ? [`The layer above it is removed too: ${numbers(plan.above)}.`]
        : [`The layers above it are removed too: ${numbers(plan.above)}.`];
    case 'jump':
      return ['Checks start again for it and the pull requests tested with it.'];
    default:
      plan.kind satisfies never;
      return [];
  }
}

/** What finished, as its toast says it: "Removed #264 from merge queue". */
export function doneLine(plan: Pick<ActPlan, 'number'>, acted: Acted): string | undefined {
  switch (acted.kind) {
    case 'removed':
      return acted.numbers.length <= 1
        ? `Removed #${plan.number} from merge queue`
        : `Removed ${acted.numbers.length} layers from merge queue`;
    case 'moved':
      return acted.position <= 1
        ? `Moved #${plan.number} to front`
        : `Moved #${plan.number} to ${ordinal(acted.position)}`;
    case 'autoMergeOff':
      return `Turned off auto-merge for #${plan.number}`;
    case 'again':
    case 'refused':
    case 'partly':
    case 'unknown':
      return undefined;
    default:
      acted satisfies never;
      return undefined;
  }
}

/**
 * Why `plan`'s question no longer stands, as merge queue tab `state` now is, and what follows: the
 * tab closed or shows another branch, so the dialog closes; its account went; a read of the whole
 * queue no longer lists the entry; or lists it at another head, after a push, so it's asked again.
 * Nothing while it stands.
 */
export function dropWhy(plan: ActPlan, state: QueueState | undefined): ActWhy | undefined {
  if (state === undefined || state.branch !== plan.branch) return { why: '', next: 'gone' };
  if (state.away) {
    return { why: state.failure?.message ?? `${plan.login} is signed out.`, next: 'signIn' };
  }
  const { read } = state;
  if (read.kind !== 'queue') return undefined;
  const entry = read.entries.find((each) => each.number === plan.number);
  if (entry === undefined) {
    return read.leftOut || read.more > 0
      ? undefined
      : { why: `#${plan.number} left the merge queue.`, next: 'gone' };
  }
  if (entry.head !== plan.head) {
    return { why: `#${plan.number}’s revision is out of date.`, next: 'ask' };
  }
  return undefined;
}

/**
 * What a read of the queue says a change whose answer was lost did, as its answer would have, or
 * nothing while it can't tell: an entry removed is no longer listed, and one moved is listed nearer
 * the front, or as having joined again, or, no longer listed, left and wasn't added back.
 */
export function settledBy(
  sketch: Pick<Sketch, 'enqueuedAt'>,
  plan: ActPlan,
  read: QueueRead | undefined,
): Acted | undefined {
  if (read?.kind !== 'queue') return undefined;
  const entry = read.entries.find((each) => each.number === plan.number);
  const whole = !read.leftOut && read.more === 0;
  if (plan.kind === 'remove') {
    if (entry !== undefined) return { kind: 'refused', why: '' };
    return whole ? { kind: 'removed', numbers: [plan.number, ...plan.above] } : undefined;
  }
  if (entry === undefined) {
    return whole
      ? { kind: 'partly', why: 'It left the merge queue and wasn’t added back.', next: 'open' }
      : undefined;
  }
  return entry.enqueuedAt !== sketch.enqueuedAt || entry.position < plan.position
    ? { kind: 'moved', position: entry.position }
    : { kind: 'refused', why: '' };
}

/** What a read of the queue says auto-merge turned off with its answer lost did, or nothing yet. */
export function autoMergeSettledBy(number: number, read: QueueRead | undefined): Acted | undefined {
  if (read?.kind !== 'queue') return undefined;
  if (read.waiting.some((each) => each.number === number)) return { kind: 'refused', why: '' };
  if (read.waitingCutShort) return undefined;
  return read.entries.some((each) => each.number === number)
    ? { kind: 'partly', why: `#${number} had already joined the merge queue.`, next: 'remove' }
    : { kind: 'autoMergeOff' };
}

/** The row `target` names in the merge queue's tab on screen, with its tab, or why there's none. */
function rowAt(target: RowTarget):
  | {
      id: string;
      tab: QueueTab;
      branch: string;
      login: string;
      row: Row;
      read: QueueRead | undefined;
    }
  | string {
  const tab = queueOnScreen();
  if (typeof tab === 'string') return tab;
  const row = rowsIn(tab.id).find((each) => each.key === target.row);
  if (!row) return `#${numberOf(target.row)} left the queue`;
  return {
    id: tab.id,
    tab,
    branch: tab.branch,
    login: tab.login,
    row,
    read: queueOf(tab.id)?.read,
  };
}

/** Why `x` or `J`, as `asked`, can't act on `row` of a queue Lo read as `read`, or `true`. */
export function actOn(asked: ActKind, row: Row, read: QueueRead | undefined): true | string {
  if (row.kind === 'waiting') return `#${row.number} is waiting to join`;
  if (row.kind === 'left') return `#${row.number} left the queue`;
  if (asked === 'jump' && (read?.kind !== 'queue' || !read.admin)) {
    return 'Only repo admins can move to front';
  }
  if (asked === 'jump' && atFront(read, row.number))
    return `#${row.number} is already at the front`;
  return true;
}

/** Whether pull request `number` is the front entry of a queue Lo read as `read`. */
export function atFront(read: QueueRead | undefined, number: number): boolean {
  return (
    read?.kind === 'queue' &&
    read.entries.some((each) => each.number === number && each.position <= 1)
  );
}

/** What's at work on pull request `number` of `tab`'s queue, as a dimmed control's reason, if anything. */
function atWork(tab: QueueTab, number: number): string | undefined {
  const working = acting.getState().working.get(workKey(tab.owner, tab.repo, number));
  return working === undefined ? undefined : workingWord(working);
}

/** Why `x` or `J` can't act on the row `target` names, as `asked`, or `true`. */
export function canAct(asked: ActKind, target: RowTarget): true | string {
  const at = rowAt(target);
  if (typeof at === 'string') return at;
  return atWork(at.tab, at.row.number) ?? actOn(asked, at.row, at.read);
}

/**
 * Whether the right-click menu of a row of the queue's table drawn now offers `J`: only on the
 * queue's entries behind the front one, and only to the repository's admins.
 */
export function offersJump(target: RowTarget | NoTarget): boolean {
  const tab = drawnQueue();
  if (target.kind !== 'row' || tab === undefined) return false;
  const row = rowsIn(tab).find((each) => each.key === target.row);
  const read = queueOf(tab)?.read;
  return (
    row?.kind === 'entry' && read?.kind === 'queue' && read.admin && !atFront(read, row.number)
  );
}

/** The dialog's sketch of `asked` on the row `at` names. */
function sketchOf(at: Exclude<ReturnType<typeof rowAt>, string>, asked: ActKind): Sketch {
  const { id, branch, login, row, read } = at;
  const entry =
    read?.kind === 'queue' ? read.entries.find((each) => each.number === row.number) : undefined;
  return {
    id,
    branch,
    login,
    kind: asked,
    number: row.number,
    title: entry?.title ?? '',
    position: entry?.position ?? 0,
    enqueuedAt: entry?.enqueuedAt ?? null,
  };
}

/** `x` and `J`: opens the dialog on the row `target` names, and asks main for a plan to confirm. */
export function act(asked: ActKind, target: RowTarget): void {
  if (acting.getState().dialog !== undefined || canAct(asked, target) !== true) return;
  const at = rowAt(target);
  if (typeof at === 'string') return;
  clearProblem(at.id, at.row.number);
  planChange(sketchOf(at, asked), undefined, undefined);
}

/** Whether two plans of one change do the same: the same layers go with it. */
function sameEffect(one: ActPlan, other: ActPlan): boolean {
  return (
    one.kind === other.kind &&
    one.above.length === other.above.length &&
    one.above.every((each, index) => each === other.above[index])
  );
}

/**
 * Asks main for a plan of `sketch`'s change, the dialog's main button busy meanwhile. Asked again
 * for one that didn't go, `again`, the same change goes at once, as "Try again" asked.
 */
function planChange(sketch: Sketch, again: ActPlan | undefined, note: string | undefined): void {
  const planning: QueueDialog = { sketch, step: { kind: 'planning', again, note } };
  setDialog(planning);
  main()
    .plan({ id: sketch.id, number: sketch.number, kind: sketch.kind })
    .then((planned) => {
      if (acting.getState().dialog !== planning) {
        // Cancelled while it was planned.
        if (planned.kind === 'plan') void main().cancel({ key: planned.plan.key });
        return;
      }
      if (planned.kind === 'refused') {
        ended(sketch, undefined, planned);
        return;
      }
      if (again !== undefined && sameEffect(again, planned.plan)) {
        setDialog({ sketch, step: { kind: 'ask', plan: planned.plan, note } });
        confirmAct();
        return;
      }
      const changed = again === undefined ? note : 'The layers removed with it have changed.';
      setDialog({ sketch, step: { kind: 'ask', plan: planned.plan, note: changed } });
    })
    .catch((error: unknown) => {
      if (acting.getState().dialog !== planning) return;
      const title = failedTitle(sketch.kind, sketch.number, true);
      const failure = { title, why: '', details: messageOf(error) };
      setDialog({ sketch, step: { kind: 'failed', plan: undefined, failure } });
    });
}

/**
 * Shows in the dialog why `sketch`'s change, planned as `planned`, if it was, didn't go, as `why`
 * says: closed where the reader can't see the question any more, one line where it no longer
 * stands, asked again where it can be planned afresh, else the failure.
 */
function ended(sketch: Sketch, planned: ActPlan | undefined, why: ActWhy): void {
  switch (why.next) {
    case 'gone':
      setDialog(
        why.why === ''
          ? undefined
          : { sketch, step: { kind: 'gone', plan: planned, why: why.why } },
      );
      return;
    case 'ask':
      planChange(sketch, undefined, why.why);
      return;
    case undefined:
    case 'none':
    case 'signIn':
    case 'open':
    case 'remove': {
      const title = failedTitle(sketch.kind, sketch.number, why.checking === true);
      setDialog({ sketch, step: { kind: 'failed', plan: planned, failure: { ...why, title } } });
      return;
    }
    default:
      why.next satisfies never;
  }
}

/** The plans confirmed whose answer hasn't come, by key. */
const confirmed = new Map<string, ActPlan>();

/** Main is sending the plan named `key`: its row's button is at work, as the dialog's is. */
export function sentPlan({ key }: { key: string }): void {
  const plan = confirmed.get(key);
  if (plan === undefined) return;
  setWorking(workKey(plan.owner, plan.repo, plan.number), plan.kind);
  const dialog = acting.getState().dialog;
  if (dialog?.step.kind === 'checking' && dialog.step.plan.key === key) {
    setDialog({ sketch: dialog.sketch, step: { kind: 'sent', plan } });
  }
}

/**
 * Confirms the plan the dialog asks about, once: main checks it again and sends it, or says why
 * not. Its answer shows in the dialog while it's open, and under the row once it's closed; a change
 * that went closes the dialog, and a toast says so.
 */
export function confirmAct(): void {
  const dialog = acting.getState().dialog;
  if (dialog?.step.kind !== 'ask') return;
  const { sketch } = dialog;
  const { plan } = dialog.step;
  setDialog({ sketch, step: { kind: 'checking', plan } });
  confirmed.set(plan.key, plan);
  void main()
    .confirm({ key: plan.key })
    // Main may have sent it before its answer was lost: what it did isn't known, and "Check
    // again" only looks.
    .catch((error: unknown): Acted => ({ kind: 'unknown', why: '', details: messageOf(error) }))
    .then((acted) => {
      confirmed.delete(plan.key);
      setWorking(workKey(plan.owner, plan.repo, plan.number), undefined);
      answered(sketch, plan, acted);
    });
}

/** Whether the dialog still shows `plan` at work, or its answer lost. */
function shows(plan: ActPlan): boolean {
  const step = acting.getState().dialog?.step;
  const shown =
    step?.kind === 'checking' || step?.kind === 'sent' || step?.kind === 'unknown'
      ? step.plan
      : undefined;
  return shown?.key === plan.key;
}

/**
 * `sketch`'s change, planned as `plan`, answered as `acted`: done, the dialog closes and a toast
 * says so; asked again, the dialog asks; else what didn't go shows in the dialog, while it shows
 * the change, or under its row.
 */
function answered(sketch: Sketch, plan: ActPlan, acted: Acted): void {
  const shown = shows(plan);
  const done = doneLine(plan, acted);
  if (done !== undefined) {
    if (shown) setDialog(undefined);
    clearProblem(sketch.id, plan.number);
    announce(withoutBidi(done));
    return;
  }
  switch (acted.kind) {
    case 'again':
      if (shown) setDialog({ sketch, step: { kind: 'ask', plan: acted.plan, note: acted.why } });
      else void main().cancel({ key: acted.plan.key });
      return;
    case 'refused':
    case 'partly': {
      if (shown) {
        ended(sketch, plan, acted);
        return;
      }
      if (acted.next === 'gone' || acted.next === 'ask') return;
      const title = failedTitle(sketch.kind, sketch.number, acted.checking === true);
      setProblem({ ...acted, title, id: sketch.id, number: plan.number, asked: plan.kind });
      return;
    }
    case 'unknown': {
      const failure = { ...acted, title: unknownTitle(plan.kind) };
      if (shown) {
        setDialog({ sketch, step: { kind: 'unknown', plan, failure, looking: false } });
        return;
      }
      setProblem({
        ...failure,
        id: sketch.id,
        number: plan.number,
        asked: plan.kind,
        plan,
        enqueuedAt: sketch.enqueuedAt,
        unknown: true,
      });
      return;
    }
    case 'removed':
    case 'moved':
    case 'autoMergeOff':
      return;
    default:
      acted satisfies never;
  }
}

/**
 * Reads merge queue tab `id`'s queue and those waiting to join again, begun now, and gives what
 * `judge` makes of the read; or, where it can't tell, nothing, with why the read failed, if it did.
 * The read is main's answer's: what it sent on `queue` can come after the answer.
 */
async function look(
  id: string,
  judge: (read: QueueRead | undefined) => Acted | undefined,
): Promise<{ acted: Acted | undefined; details: string | undefined }> {
  try {
    const { read, failed } = await main().look({ id });
    return { acted: judge(read), details: failed };
  } catch (error) {
    return { acted: judge(queueOf(id)?.read), details: messageOf(error) };
  }
}

/**
 * "Check again", in the dialog, for a change whose answer was lost: only looks, reading the queue
 * again, and shows what it did as its answer would have, else that it still isn't known.
 */
export function checkAgain(): void {
  const dialog = acting.getState().dialog;
  if (dialog?.step.kind !== 'unknown' || dialog.step.looking) return;
  const { sketch } = dialog;
  const { plan, failure } = dialog.step;
  const looking: QueueDialog = { sketch, step: { ...dialog.step, looking: true } };
  setDialog(looking);
  void look(sketch.id, (read) => settledBy(sketch, plan, read)).then(({ acted, details }) => {
    if (acting.getState().dialog !== looking) return;
    if (acted !== undefined) {
      answered(sketch, plan, acted);
      return;
    }
    const still = { ...failure, ...(details !== undefined && { details }) };
    setDialog({ sketch, step: { kind: 'unknown', plan, failure: still, looking: false } });
  });
}

/**
 * The dialog's main button after a failure: does what the reason offers, where it offers something
 * else; else tries the change again, planned afresh, which goes at once when it does the same.
 */
export function tryAgain(): void {
  const dialog = acting.getState().dialog;
  if (dialog?.step.kind !== 'failed') return;
  const { sketch } = dialog;
  const { failure, plan: failed } = dialog.step;
  const { next } = failure;
  if (next === 'signIn' || next === 'open' || next === 'remove') {
    leaveAct();
    follow(sketch.id, sketch.number, next);
    return;
  }
  planChange(sketch, failed, undefined);
}

/** What a failure's button says, for what it offers, `next`, if it has a button. */
export function nextLabel(next: ActNext | undefined): string | undefined {
  switch (next) {
    case undefined:
    case 'ask':
      return 'Try again';
    case 'signIn':
      return 'Sign in again';
    case 'open':
      return 'Open pull request';
    case 'remove':
      return 'Remove from merge queue…';
    case 'none':
    case 'gone':
      return undefined;
    default:
      next satisfies never;
      return undefined;
  }
}

/** Does what a failure's reason offers, `next`, for pull request `number` in merge queue tab `id`. */
function follow(id: string, number: number, next: 'signIn' | 'open' | 'remove'): void {
  switch (next) {
    case 'signIn':
      signInAgain();
      return;
    case 'open':
      openPull(id, number);
      return;
    case 'remove':
      runControl('queue.remove', { kind: 'row', row: entryKey(number) });
      return;
    default:
      next satisfies never;
  }
}

/**
 * Opens pull request `number` of merge queue tab `id` in its own tab; one that doesn't open says so
 * under its row.
 */
export function openPull(id: string, number: number): void {
  clearProblem(id, number);
  main()
    .open({ id, number })
    .catch((error: unknown) => cantOpen(id, number, error));
}

/**
 * `⏎`, or a double click on a row: opens the pull request of the row `target` names, as the queue's
 * account.
 */
export function openRow(target: RowTarget): void {
  const at = rowAt(target);
  if (typeof at === 'string') return;
  openPull(at.id, at.row.number);
}

/** Says under pull request `number`'s row that its tab didn't open, for `error`. */
function cantOpen(id: string, number: number, error: unknown): void {
  setProblem({
    id,
    number,
    asked: 'open',
    title: `Couldn’t open #${number}`,
    why: '',
    details: messageOf(error),
  });
}

/**
 * The button of the problem under pull request `number`'s row in merge queue tab `id`: looks
 * again for a change whose answer was lost, else does what the reason offers, or tries what was
 * asked again.
 */
export function problemAction(id: string, number: number): void {
  const problem = problemOf(id, number);
  if (problem === undefined || problem.busy) return;
  if (problem.unknown) {
    lookAgain(problem);
    return;
  }
  clearProblem(id, number);
  const { next } = problem;
  if (next === 'signIn' || next === 'open' || next === 'remove') {
    follow(id, number, next);
    return;
  }
  switch (problem.asked) {
    case 'autoMergeOff': {
      // The problem's button is on screen, in its queue's tab.
      const tab = queueOnScreen();
      if (typeof tab !== 'string' && tab.id === id) turnOff(id, number, tab);
      return;
    }
    case 'open':
      openPull(id, number);
      return;
    case 'remove':
      runControl('queue.remove', { kind: 'row', row: entryKey(number) });
      return;
    case 'jump':
      runControl('queue.jump', { kind: 'row', row: entryKey(number) });
      return;
    default:
      problem.asked satisfies never;
  }
}

/** "Check again" under a row: only looks, and shows what the change did, else that it isn't known. */
function lookAgain(problem: RowProblem): void {
  const { id, number, plan } = problem;
  const looking = { ...problem, busy: true };
  setProblem(looking);
  const judge = (read: QueueRead | undefined) =>
    plan === undefined
      ? autoMergeSettledBy(number, read)
      : settledBy({ enqueuedAt: problem.enqueuedAt ?? null }, plan, read);
  void look(id, judge).then(({ acted, details }) => {
    if (problemOf(id, number) !== looking) return;
    if (acted === undefined) {
      setProblem({ ...problem, ...(details !== undefined && { details }), busy: false });
      return;
    }
    clearProblem(id, number);
    if (plan === undefined) autoMergeAnswered(id, number, acted);
    else answered(sketchOfProblem(problem, plan), plan, acted);
  });
}

/** The sketch of a change whose problem shows under its row. */
function sketchOfProblem(problem: RowProblem, plan: ActPlan): Sketch {
  return {
    id: problem.id,
    branch: plan.branch,
    login: plan.login,
    kind: plan.kind,
    number: plan.number,
    title: plan.title,
    position: plan.position,
    enqueuedAt: problem.enqueuedAt ?? null,
  };
}

/**
 * `Esc`, Cancel or Close in the dialog: a plan not confirmed is forgotten, and main stops checking
 * one being confirmed, before it's sent; one sent goes on, and how it ends shows as a toast, or
 * under its row.
 */
export function leaveAct(): void {
  const dialog = acting.getState().dialog;
  if (!dialog) return;
  setDialog(undefined);
  const { step } = dialog;
  if (step.kind === 'ask' || step.kind === 'checking') void main().cancel({ key: step.plan.key });
}

/**
 * Says in the dialog why the question it asks no longer stands, when what it named changed in
 * merge queue tab `state`, as main read it, or asks it again; and drops the problems under rows
 * the tab no longer lists.
 */
export function heardQueue(state: QueueState): void {
  dropProblems(state);
  const dialog = acting.getState().dialog;
  if (dialog === undefined || dialog.sketch.id !== state.id) return;
  const { sketch, step } = dialog;
  // The dialog closes as its tab shows another branch, unless what it sent is still at work.
  if (state.branch !== sketch.branch && step.kind !== 'sent') {
    leaveAct();
    return;
  }
  if (step.kind !== 'ask') return;
  const why = dropWhy(step.plan, state);
  if (why === undefined) return;
  void main().cancel({ key: step.plan.key });
  ended(sketch, step.plan, why);
}

/** Drops the problems under rows of merge queue tab `state` that it no longer lists. */
function dropProblems(state: QueueState): void {
  const { problems } = acting.getState();
  if (state.read.kind !== 'queue' || problems.size === 0) return;
  const { read } = state;
  const listed = new Set([
    ...read.entries.map((each) => each.number),
    ...read.waiting.map((each) => each.number),
    ...read.left.map((each) => each.number),
  ]);
  for (const problem of problems.values()) {
    if (problem.id === state.id && !problem.busy && !listed.has(problem.number)) {
      clearProblem(problem.id, problem.number);
    }
  }
}

/** Drops the dialog's question, and the problems under rows, when their tab closes. */
export function closedQueue(id: string): void {
  for (const problem of acting.getState().problems.values()) {
    if (problem.id === id) clearProblem(id, problem.number);
  }
  if (acting.getState().dialog?.sketch.id === id) leaveAct();
}

/** Why `a` can't act on `row` of a queue Lo read as `read`, or `true`. */
export function autoMergeOn(row: Row, read: QueueRead | undefined): true | string {
  switch (row.kind) {
    case 'entry':
      return `#${row.number} is already in the merge queue`;
    case 'waiting':
      return true;
    case 'left': {
      const left =
        read?.kind === 'queue' ? read.left.find((each) => each.number === row.number) : undefined;
      return left?.why.kind === 'merged' ? `#${row.number} merged` : true;
    }
    default:
      row.kind satisfies never;
      return true;
  }
}

/** Why `a` can't act on the row `target` names, or `true`. */
export function canAutoMerge(target: RowTarget): true | string {
  const at = rowAt(target);
  if (typeof at === 'string') return at;
  return atWork(at.tab, at.row.number) ?? autoMergeOn(at.row, at.read);
}

/** What `a` is called on the row `target` names, where it turns auto-merge on, not off. */
export function autoMergeName(target: RowTarget): string | undefined {
  const at = rowAt(target);
  return typeof at !== 'string' && at.row.kind === 'left' ? 'Turn on auto-merge…' : undefined;
}

/**
 * `a`: for a pull request waiting to join, turns its auto-merge off at once, asking nothing, since
 * that merges nothing. For one that left the queue, opens it in its own tab, as the queue's account,
 * and asks there to turn auto-merge on, through the merge panel's confirmation, from what GitHub
 * says of it.
 */
export function autoMerge(target: RowTarget): void {
  if (canAutoMerge(target) !== true) return;
  const at = rowAt(target);
  if (typeof at === 'string') return;
  const { id, row } = at;
  if (row.kind === 'waiting') {
    turnOff(id, row.number, at.tab);
    return;
  }
  clearProblem(id, row.number);
  main()
    .open({ id, number: row.number })
    .then((view) => {
      askAutoMerge(view, row.number);
    })
    .catch((error: unknown) => cantOpen(id, row.number, error));
}

/** Turns off auto-merge for pull request `number`, waiting to join merge queue tab `id`'s queue. */
function turnOff(id: string, number: number, tab: QueueTab): void {
  clearProblem(id, number);
  const key = workKey(tab.owner, tab.repo, number);
  setWorking(key, 'autoMergeOff');
  void main()
    .autoMergeOff({ id, number })
    // As for a confirmation: it may have gone.
    .catch((error: unknown): Acted => ({ kind: 'unknown', why: '', details: messageOf(error) }))
    .then((acted) => {
      setWorking(key, undefined);
      autoMergeAnswered(id, number, acted);
    });
}

/** How turning off auto-merge for pull request `number` in merge queue tab `id` went, `acted`. */
function autoMergeAnswered(id: string, number: number, acted: Acted): void {
  switch (acted.kind) {
    case 'autoMergeOff':
      announce(`Turned off auto-merge for #${number}`);
      return;
    case 'refused':
    case 'partly': {
      if (acted.next === 'gone' && acted.why === '') return;
      const title = 'Couldn’t turn off auto-merge';
      setProblem({ ...acted, title, id, number, asked: 'autoMergeOff' });
      return;
    }
    case 'unknown': {
      const title = 'Auto-merge not confirmed';
      setProblem({ ...acted, title, id, number, asked: 'autoMergeOff', unknown: true });
      return;
    }
    case 'removed':
    case 'moved':
    case 'again':
      return;
    default:
      acted satisfies never;
  }
}

/** Follows each merge queue's tab as main says it, for the dialog's question and the rows' problems. */
export function followQueues(): () => void {
  return queuesStore.subscribe(({ states }, before) => {
    for (const [id, state] of states) {
      if (state !== before.states.get(id)) heardQueue(state);
    }
  });
}
