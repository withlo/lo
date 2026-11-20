// What changing the queue does in the window: `x` and `J` ask main for a plan for the row the
// keyboard is on, and show it in the queue's dialog to confirm; the dialog confirms its key, and
// says how it went, or a note does once it's closed. The window never sends a change itself. A
// question drops when its entry leaves the queue, is pushed to, or its account goes, as main reads
// the queue. `a` turns auto-merge off at once for a pull request waiting to join; for one that left
// the queue, it opens its tab, and asks there, through the merge panel's own confirmation.

import type { NoTarget, RowTarget } from '@lo/ui/commands';
import { createStore } from 'zustand/vanilla';

import { announce, notify } from '../../../window/commands/notices.tsx';
import { askAutoMerge } from '../../merge/window/shared.ts';
import { withoutBidi } from '../../tab/window/shared.ts';
import type { Acted, ActKind, ActPlan, QueueRead, QueueState } from '../contract.ts';
import { drawnQueue, queueOnScreen, rowsIn } from './actions.ts';
import { main } from './main.ts';
import type { Row } from './rows.ts';
import { queueOf, queuesStore } from './store.ts';

/**
 * The queue's dialog:
 *
 * - `planning`: main is planning `asked` for pull request `number` in `branch`'s queue, from merge
 *   queue tab `id`;
 * - `confirm`: the plan, for the reader to confirm, with `note`, what changed since one before it,
 *   while `sending` the confirmation to main;
 * - `ended`: main answered that nothing changed, or not all of it, or it can't tell, as `why` says.
 */
export type QueueDialog =
  | {
      readonly kind: 'planning';
      readonly id: string;
      readonly branch: string;
      readonly number: number;
      readonly asked: ActKind;
    }
  | {
      readonly kind: 'confirm';
      readonly plan: ActPlan;
      readonly note: string | undefined;
      readonly sending: boolean;
    }
  | {
      readonly kind: 'ended';
      readonly plan: ActPlan;
      readonly how: 'refused' | 'partly' | 'unknown';
      readonly why: string;
    };

export const acting = createStore<{ readonly dialog: QueueDialog | undefined }>()(() => ({
  dialog: undefined,
}));

function setDialog(dialog: QueueDialog | undefined): void {
  acting.setState({ dialog });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/** What `x` or `J` asks, as the dialog's title: "Take #4810 out of the merge queue for main?". */
export function confirmTitle(plan: Pick<ActPlan, 'kind' | 'number' | 'branch'>): string {
  switch (plan.kind) {
    case 'remove':
      return `Take #${plan.number} out of the merge queue for ${plan.branch}?`;
    case 'jump':
      return `Move #${plan.number} to the front of the merge queue for ${plan.branch}?`;
    default:
      plan.kind satisfies never;
      return `Change #${plan.number} in the merge queue for ${plan.branch}?`;
  }
}

/** The dialog's main button for `kind`. */
export function confirmLabel(kind: ActKind): string {
  switch (kind) {
    case 'remove':
      return 'Remove from the queue';
    case 'jump':
      return 'Move to the front';
    default:
      kind satisfies never;
      return 'Change the queue';
  }
}

/** What else the change does, beyond its title, a line each. */
export function effectsOf(plan: ActPlan): string[] {
  switch (plan.kind) {
    case 'remove':
      return plan.above.length === 0
        ? []
        : [
            `${numbers(plan.above)}, above it in GitHub stack #${plan.stack ?? '?'}, ${plan.above.length === 1 ? 'leaves' : 'leave'} the queue with it.`,
          ];
    case 'jump':
      return [
        ...(plan.position === 1 ? [`#${plan.number} is at the front already.`] : []),
        'It leaves the queue and joins again at the front, so it’s tested again from the start.',
      ];
    default:
      plan.kind satisfies never;
      return [];
  }
}

/** What finished, as its note says: "Took #4810 out of the merge queue for main". */
export function doneLine(plan: ActPlan, acted: Acted): string | undefined {
  switch (acted.kind) {
    case 'removed':
      return `Took ${numbers(acted.numbers)} out of the merge queue for ${plan.branch}`;
    case 'moved':
      return acted.position <= 1
        ? `Moved #${plan.number} to the front of the merge queue for ${plan.branch}`
        : `Moved #${plan.number} up to ${ordinal(acted.position)} in the merge queue for ${plan.branch}, behind what GitHub is testing`;
    case 'autoMergeOff':
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

/** The dialog's title once it ended without doing what was asked. */
export function endedTitle(plan: ActPlan, how: 'refused' | 'partly' | 'unknown'): string {
  switch (how) {
    case 'refused':
      return 'Nothing changed';
    case 'partly':
      return `#${plan.number} is out of the merge queue`;
    case 'unknown':
      return plan.kind === 'remove'
        ? `Lo can’t tell whether #${plan.number} left the merge queue`
        : `Lo can’t tell where #${plan.number} is in the merge queue`;
    default:
      how satisfies never;
      return 'Nothing changed';
  }
}

/**
 * Why `plan`'s question no longer stands, as merge queue tab `state` now is: its account went, it
 * shows another branch, or a read of the whole queue no longer lists the entry, or lists it at
 * another head, after a push. Nothing while it stands.
 */
export function dropWhy(plan: ActPlan, state: QueueState | undefined): string | undefined {
  if (state === undefined) return 'The merge queue’s tab is closed.';
  if (state.away) return state.failure?.message ?? `${plan.login} is signed out.`;
  if (state.branch !== plan.branch) return `The tab shows ${state.branch}’s queue now.`;
  const { read } = state;
  if (read.kind !== 'queue') return undefined;
  const entry = read.entries.find((each) => each.number === plan.number);
  if (entry === undefined) {
    return read.leftOut || read.more > 0
      ? undefined
      : `#${plan.number} left the merge queue for ${plan.branch}.`;
  }
  if (entry.head !== plan.head) return `#${plan.number} has a newer push.`;
  return undefined;
}

/** The row `target` names in the merge queue's tab on screen, with its tab's id, or why there's none. */
function rowAt(
  target: RowTarget,
): { id: string; branch: string; row: Row; read: QueueRead | undefined } | string {
  const tab = queueOnScreen();
  if (typeof tab === 'string') return tab;
  const row = rowsIn(tab.id).find((each) => each.key === target.row);
  if (!row) return 'That pull request isn’t in the queue any more.';
  return { id: tab.id, branch: tab.branch, row, read: queueOf(tab.id)?.read };
}

/** Why `x` or `J`, as `asked`, can't act on `row` of a queue Lo read as `read`, or `true`. */
export function actOn(asked: ActKind, row: Row, read: QueueRead | undefined): true | string {
  if (row.kind === 'waiting') {
    return `#${row.number} isn’t in the queue yet: it joins once it’s ready, with auto-merge on.`;
  }
  if (row.kind === 'left') return `#${row.number} isn’t in the queue any more.`;
  if (asked === 'jump' && (read?.kind !== 'queue' || !read.admin)) {
    return 'GitHub lets only the repository’s admins move a pull request to the front of the merge queue.';
  }
  return true;
}

/** Why `x` or `J` can't act on the row `target` names, as `asked`, or `true`. */
export function canAct(asked: ActKind, target: RowTarget): true | string {
  if (acting.getState().dialog !== undefined) return 'The queue is being changed.';
  const at = rowAt(target);
  return typeof at === 'string' ? at : actOn(asked, at.row, at.read);
}

/**
 * Whether the right-click menu of a row of the queue's table drawn now offers `J`: only on the
 * queue's entries, and only to the repository's admins.
 */
export function offersJump(target: RowTarget | NoTarget): boolean {
  const tab = drawnQueue();
  if (target.kind !== 'row' || tab === undefined) return false;
  const row = rowsIn(tab).find((each) => each.key === target.row);
  const read = queueOf(tab)?.read;
  return row?.kind === 'entry' && read?.kind === 'queue' && read.admin;
}

/**
 * `x` and `J`: asks main for a plan for the row `target` names, and shows it in the dialog to
 * confirm. A plan main refuses says why, and the dialog closes.
 */
export function act(asked: ActKind, target: RowTarget): void {
  if (canAct(asked, target) !== true) return;
  const at = rowAt(target);
  if (typeof at === 'string') return;
  const { id, branch, row } = at;
  const planning: QueueDialog = { kind: 'planning', id, branch, number: row.number, asked };
  setDialog(planning);
  const title = confirmLabel(asked);
  main()
    .plan({ id, number: row.number, kind: asked })
    .then((planned) => {
      if (acting.getState().dialog !== planning) {
        // Cancelled while it was planned.
        if (planned.kind === 'plan') void main().cancel({ key: planned.plan.key });
        return;
      }
      if (planned.kind === 'refused') {
        setDialog(undefined);
        notify(title, withoutBidi(planned.why));
        return;
      }
      setDialog({ kind: 'confirm', plan: planned.plan, note: undefined, sending: false });
    })
    .catch((error: unknown) => {
      if (acting.getState().dialog !== planning) return;
      setDialog(undefined);
      notify(title, messageOf(error));
    });
}

/**
 * Confirms the plan the dialog shows, once: main checks it again and sends it, or says why not.
 * Once it answers, a change that went closes the dialog with a note; one that didn't, or not all
 * of it, stays in the dialog while it's open, else a note says it.
 */
export function confirmAct(): void {
  const dialog = acting.getState().dialog;
  if (dialog?.kind !== 'confirm' || dialog.sending) return;
  const { plan } = dialog;
  setDialog({ ...dialog, sending: true });
  const still = () => {
    const now = acting.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === plan.key;
  };
  const title = confirmLabel(plan.kind);
  main()
    .confirm({ key: plan.key })
    .then((acted) => {
      const shown = still();
      const done = doneLine(plan, acted);
      if (done !== undefined) {
        if (shown) setDialog(undefined);
        announce(withoutBidi(done));
        return;
      }
      switch (acted.kind) {
        case 'again':
          if (shown)
            setDialog({ kind: 'confirm', plan: acted.plan, note: acted.why, sending: false });
          else void main().cancel({ key: acted.plan.key });
          return;
        case 'refused':
        case 'partly':
        case 'unknown':
          if (shown) setDialog({ kind: 'ended', plan, how: acted.kind, why: acted.why });
          else notify(endedTitle(plan, acted.kind), withoutBidi(acted.why));
          return;
        case 'removed':
        case 'moved':
        case 'autoMergeOff':
          return;
        default:
          acted satisfies never;
      }
    })
    .catch((error: unknown) => {
      if (still()) setDialog({ kind: 'ended', plan, how: 'refused', why: messageOf(error) });
      else notify(title, messageOf(error));
    });
}

/**
 * `Esc` in the dialog: a plan not confirmed is forgotten, and main stops checking one being
 * confirmed, before it's sent; one that went goes on, and a note says how it ended.
 */
export function leaveAct(): void {
  const dialog = acting.getState().dialog;
  if (!dialog) return;
  setDialog(undefined);
  if (dialog.kind === 'confirm') void main().cancel({ key: dialog.plan.key });
}

/**
 * Drops the question the dialog asks when what it named no longer stands in merge queue tab
 * `state`, as main read it, and says why.
 */
export function heardQueue(state: QueueState): void {
  const dialog = acting.getState().dialog;
  if (dialog?.kind !== 'confirm' || dialog.sending || dialog.plan.id !== state.id) return;
  const why = dropWhy(dialog.plan, state);
  if (why === undefined) return;
  setDialog(undefined);
  void main().cancel({ key: dialog.plan.key });
  notify(confirmLabel(dialog.plan.kind), withoutBidi(`${why} Lo dropped the question.`));
}

/** Drops the dialog's question when its tab closes. */
export function closedQueue(id: string): void {
  const dialog = acting.getState().dialog;
  if (!dialog) return;
  const of = dialog.kind === 'planning' ? dialog.id : dialog.plan.id;
  if (of !== id) return;
  setDialog(undefined);
  if (dialog.kind === 'confirm') void main().cancel({ key: dialog.plan.key });
}

/** Why `a` can't act on `row` of a queue Lo read as `read`, or `true`. */
export function autoMergeOn(row: Row, read: QueueRead | undefined): true | string {
  switch (row.kind) {
    case 'entry':
      return `#${row.number} is in the merge queue already.`;
    case 'waiting':
      return true;
    case 'left': {
      const left =
        read?.kind === 'queue' ? read.left.find((each) => each.number === row.number) : undefined;
      return left?.why.kind === 'merged' ? `#${row.number} merged.` : true;
    }
    default:
      row.kind satisfies never;
      return true;
  }
}

/** Why `a` can't act on the row `target` names, or `true`. */
export function canAutoMerge(target: RowTarget): true | string {
  if (acting.getState().dialog !== undefined) return 'The queue is being changed.';
  const at = rowAt(target);
  return typeof at === 'string' ? at : autoMergeOn(at.row, at.read);
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
    const title = 'Turn off auto-merge';
    main()
      .autoMergeOff({ id, number: row.number })
      .then((acted) => {
        switch (acted.kind) {
          case 'autoMergeOff':
            announce(`Turned off auto-merge for #${row.number}`);
            return;
          case 'refused':
          case 'partly':
          case 'unknown':
            notify(title, withoutBidi(acted.why));
            return;
          case 'removed':
          case 'moved':
          case 'again':
            return;
          default:
            acted satisfies never;
        }
      })
      .catch((error: unknown) => notify(title, messageOf(error)));
    return;
  }
  main()
    .open({ id, number: row.number })
    .then((view) => {
      askAutoMerge(view, row.number);
    })
    .catch((error: unknown) => notify('Merge when ready', messageOf(error)));
}

/** Follows each merge queue's tab as main says it, for the dialog's question. */
export function followQueues(): () => void {
  return queuesStore.subscribe(({ states }, before) => {
    const dialog = acting.getState().dialog;
    if (dialog?.kind !== 'confirm') return;
    const state = states.get(dialog.plan.id);
    if (state !== undefined && state !== before.states.get(dialog.plan.id)) heardQueue(state);
  });
}
