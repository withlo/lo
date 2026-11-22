// What approve and ship does in the window: `⌘⇧⏎` asks main for a plan and shows it in its dialog
// to confirm, or why there's none, in the dialog; the dialog confirms its key, and `Esc` forgets
// it. Once confirmed, main runs it and says how it goes on `ships`, and the merge it sent, if any,
// goes as `jobs` says: done, the dialog says so while it's open, else a toast does; stopped, the
// dialog says where and why while it's open, else a toast does, and a merge GitHub refused shows in
// the tab's banner. The window sends nothing itself. What the auto-merge watch says of a push
// after your approval shows in a banner on the pull request's tab, and in a toast while another
// tab is on screen.

import { announce, notify } from '../../../window/commands/notices.tsx';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { activeTab, withoutBidi } from '../../tab/window/shared.ts';
import type { JobView, Refusal, ShipView, Watched } from '../contract.ts';
import { canOpen, closePanel, openPanel } from './actions.ts';
import { main } from './main.ts';
import { jobsByKey, newerOf, seeNewer } from './merging.ts';
import { merging, pullKey, shipping, type ShipDialog } from './store.ts';
import { shipDoneLine, watchedWords, type Label } from './shipWords.ts';
import { doneLine } from './words.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setDialog(dialog: ShipDialog | undefined): void {
  shipping.setState({ dialog });
}

/** The labels of view `id`'s revisions, "r2", by head. */
export function labelsOf(id: string): Label {
  return (head) => revisionLabel(revisionsOf(id), head);
}

/**
 * Whether `⌘⇧⏎` can approve and ship the pull request on screen, or why not. While a dialog shows,
 * it does nothing.
 */
export function canShip(): true | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'Open a pull request first';
  const can = canOpen();
  if (can !== true) return can;
  if (shipping.getState().dialog !== undefined || merging.getState().dialog !== undefined) {
    return true;
  }
  const job = merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
  return job?.state.kind === 'sending' || job?.state.kind === 'pending'
    ? `#${tab.number} is still merging`
    : true;
}

/**
 * Asks main what approve and ship would do for the pull request on screen, and shows it in the
 * dialog to confirm. A plan main refuses says why, in the dialog.
 */
export function shipFromTab(): void {
  const tab = activeTab();
  if (tab?.kind !== 'pull' || canShip() !== true) return;
  if (shipping.getState().dialog !== undefined || merging.getState().dialog !== undefined) return;
  closePanel(tab.id);
  planShip(tab.id, tab.number);
}

/** Shows the dialog planning approve and ship for view `id`, and asks main for the plan. */
function planShip(id: string, number: number): void {
  const planning: ShipDialog = { kind: 'planning', id, number };
  setDialog(planning);
  const refused = (refusal: Refusal) => {
    if (shipping.getState().dialog !== planning) return;
    setDialog({ kind: 'refused', id, number, plan: undefined, refusal });
  };
  main()
    .ship({ id })
    .then((planned) => {
      if (planned.kind === 'refused') {
        refused(planned.refusal);
        return;
      }
      // Cancelled while it was planned.
      if (shipping.getState().dialog !== planning) {
        void main().cancel({ key: planned.plan.key });
        return;
      }
      setDialog({ kind: 'confirm', plan: planned.plan, note: undefined, sending: false });
    })
    .catch((error: unknown) =>
      refused({ kind: 'failed', text: '', rules: [messageOf(error)], until: null, newer: null }),
    );
}

/** "Try again" in the dialog: asks main afresh what approve and ship would do now. */
export function shipAgain(): void {
  const dialog = shipping.getState().dialog;
  if (!dialog || dialog.kind === 'planning' || dialog.kind === 'confirm') return;
  if (dialog.kind === 'refused') planShip(dialog.id, dialog.number);
  else planShip(dialog.plan.id, dialog.plan.number);
}

/**
 * Confirms the plan the dialog shows, once: main reads GitHub again, and runs it only at the head
 * the plan names, or says why not.
 */
export function confirmShip(): void {
  const dialog = shipping.getState().dialog;
  if (dialog?.kind !== 'confirm' || dialog.sending) return;
  const { plan } = dialog;
  setDialog({ ...dialog, sending: true });
  const still = () => {
    const now = shipping.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === plan.key;
  };
  main()
    .shipConfirm({ key: plan.key })
    .then((confirmed) => {
      // Left as main started it: it goes on, and a toast says how it ends.
      if (!still()) return;
      switch (confirmed.kind) {
        case 'started':
          setDialog({ kind: 'running', plan });
          // It may have moved on before main answered.
          settle(shipping.getState().runs.get(plan.key));
          return;
        case 'again':
          setDialog({ kind: 'confirm', plan: confirmed.plan, note: confirmed.why, sending: false });
          return;
        case 'refused':
          setDialog({
            kind: 'refused',
            id: plan.id,
            number: plan.number,
            plan,
            refusal: confirmed.refusal,
          });
          return;
        default:
          confirmed satisfies never;
      }
    })
    .catch((error: unknown) => {
      if (!still()) return;
      setDialog({
        kind: 'refused',
        id: plan.id,
        number: plan.number,
        plan,
        refusal: { kind: 'failed', text: '', rules: [messageOf(error)], until: null, newer: null },
      });
    });
}

/**
 * `Esc` in the dialog: a plan not confirmed is forgotten; one that runs goes on, and a toast says
 * how it ends. A merge refused that the dialog showed needs no banner.
 */
export function leaveShip(): void {
  const dialog = shipping.getState().dialog;
  if (!dialog) return;
  setDialog(undefined);
  switch (dialog.kind) {
    case 'planning':
    case 'refused':
      return;
    case 'confirm':
      void main().cancel({ key: dialog.plan.key });
      return;
    case 'running': {
      const phase = shipping.getState().runs.get(dialog.plan.key)?.phase;
      const job = phase?.kind === 'sending' ? jobsByKey(phase.job) : undefined;
      if (job && (job.state.kind === 'refused' || job.state.kind === 'unknown')) {
        merging.setState((state) => ({ seen: new Set([...state.seen, job.key]) }));
        void main()
          .dismiss({ key: job.key })
          .catch(() => undefined);
      }
      return;
    }
    default:
      dialog satisfies never;
  }
}

/** "Merge panel", from a stop after approving: the dialog closes, and the panel opens. */
export function panelFromShip(id: string, number: number): void {
  leaveShip();
  openPanel(id, number);
}

/** "Show r3", from a stop for a newer revision: the dialog closes, and the diff shows it. */
export function seeShipNewer(id: string, refusal: Refusal, head: string): void {
  const newer = newerOf(id, refusal, head);
  if (newer?.to === undefined) return;
  setDialog(undefined);
  seeNewer(id, newer);
}

/** The keys of runs whose end was said, in the dialog or a toast. */
const said = new Set<string>();

/** Takes a run as main says it, and says how it ended, once it has. */
export function heardShip(view: ShipView): void {
  const runs = new Map(shipping.getState().runs);
  runs.set(view.key, view);
  shipping.setState({ runs });
  settle(view);
}

/** Whether the dialog shows `key`'s run, or is confirming it, as main starts it. */
function showing(key: string): boolean {
  const dialog = shipping.getState().dialog;
  if (dialog?.kind === 'confirm') return dialog.sending && dialog.plan.key === key;
  return dialog?.kind === 'running' && dialog.plan.key === key;
}

/**
 * A run that's done stays in the dialog that shows it, which says so; else a toast says so, once.
 * One that stopped stays in the dialog while it shows it; else a toast says where it stopped. A
 * merge it sent that GitHub refused shows in the tab's banner once the dialog doesn't.
 */
function settle(view: ShipView | undefined): void {
  if (!view || said.has(view.key)) return;
  const { phase } = view;
  switch (phase.kind) {
    case 'approving':
    case 'reading':
      return;
    case 'sending':
      settleJob(view, jobsByKey(phase.job));
      return;
    case 'done':
      said.add(view.key);
      if (!showing(view.key)) announce(withoutBidi(shipDoneLine(view, undefined)));
      return;
    case 'stopped':
      said.add(view.key);
      if (!showing(view.key)) {
        notify(
          phase.at === 'approve'
            ? `Couldn’t approve #${view.number}`
            : phase.at === 'unsure'
              ? 'Approval not confirmed'
              : view.approved
                ? `Approved #${view.number}, but couldn’t merge it`
                : `Couldn’t merge #${view.number}`,
          withoutBidi(phase.refusal.text),
        );
      }
      return;
    default:
      phase satisfies never;
  }
}

/** A run's merge, as `jobs` says it: done, the dialog says so, else a toast does, once. */
function settleJob(view: ShipView, job: JobView | undefined): void {
  if (!job || doneLine(job) === undefined || said.has(view.key)) return;
  said.add(view.key);
  if (!showing(view.key)) announce(withoutBidi(shipDoneLine(view, job)));
}

/** Follows the merges approve and ship sent, as `jobs` says them. */
export function followShipJobs(): () => void {
  return merging.subscribe((state, previous) => {
    if (state.jobs === previous.jobs) return;
    for (const view of shipping.getState().runs.values()) {
      if (view.phase.kind === 'sending') settleJob(view, jobsByKey(view.phase.job));
    }
  });
}

/**
 * Takes what the auto-merge watch says of a push after your approval: the pull request's tab shows
 * it in a banner, and a toast says it while another tab is on screen.
 */
export function heardWatched(watched: Watched): void {
  const key = pullKey(watched.owner, watched.repo, watched.number);
  const kept = new Map(shipping.getState().watched);
  kept.set(key, watched);
  shipping.setState({ watched: kept });
  const tab = activeTab();
  const here =
    tab?.kind === 'pull' && pullKey(tab.owner, tab.repo, tab.number) === key ? tab : undefined;
  if (here) return;
  const words = watchedWords(watched, undefined, () => undefined);
  notify(withoutBidi(`#${watched.number}: ${words.title}`), withoutBidi(words.detail ?? ''));
}

/** Dismisses what the auto-merge watch said of the pull request `key` names. */
export function dismissWatched(key: string): void {
  const kept = new Map(shipping.getState().watched);
  if (!kept.delete(key)) return;
  shipping.setState({ watched: kept });
}
