// What approve and ship does in the window: `⌘⇧⏎` asks main for a plan and shows it in its dialog
// to confirm; the dialog confirms its key, and `Esc` forgets it. Once confirmed, main runs it and
// says how it goes on `ships`, and the merge it sent, if any, goes as `jobs` says: done, a toast
// says so and the dialog closes; stopped, the dialog says where and why while it's open, else a
// toast does, and a merge GitHub refused shows in the tab's banner. The window sends nothing
// itself. What the auto-merge watch says of a push after your approval shows in a banner on the
// pull request's tab, and in a toast while another tab is on screen.

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

/** Whether `⌘⇧⏎` can approve and ship the pull request on screen, or why not. */
export function canShip(): true | string {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return 'There’s no pull request on screen.';
  const can = canOpen();
  if (can !== true) return can;
  if (shipping.getState().dialog !== undefined) return 'Approve and ship is being confirmed.';
  if (merging.getState().dialog !== undefined) return 'A merge is being confirmed.';
  const job = merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
  return job?.state.kind === 'sending' || job?.state.kind === 'pending'
    ? `Lo is already merging #${tab.number}.`
    : true;
}

/**
 * Asks main what approve and ship would do for the pull request on screen, and shows it in the
 * dialog to confirm. A plan main refuses says why, and nothing shows.
 */
export function shipFromTab(): void {
  const tab = activeTab();
  if (tab?.kind !== 'pull') return;
  const why = canShip();
  if (why !== true) {
    notify('Approve and ship', withoutBidi(why));
    return;
  }
  const planning: ShipDialog = { kind: 'planning', id: tab.id, number: tab.number };
  closePanel(tab.id);
  setDialog(planning);
  const back = (said: string) => {
    if (shipping.getState().dialog !== planning) return;
    setDialog(undefined);
    notify('Approve and ship', withoutBidi(said));
  };
  main()
    .ship({ id: tab.id })
    .then((planned) => {
      if (planned.kind === 'refused') {
        // A newer push since the revision on screen shows as the dialog's stop, to see it.
        if (planned.refusal.newer !== null && shipping.getState().dialog === planning) {
          setDialog({
            kind: 'refused',
            id: tab.id,
            number: tab.number,
            plan: undefined,
            refusal: planned.refusal,
          });
          return;
        }
        back(planned.refusal.text);
        return;
      }
      // Cancelled while it was planned.
      if (shipping.getState().dialog !== planning) {
        void main().cancel({ key: planned.plan.key });
        return;
      }
      setDialog({ kind: 'confirm', plan: planned.plan, note: undefined, sending: false });
    })
    .catch((error: unknown) => back(messageOf(error)));
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
      if (!still()) {
        // Left as main started it: it goes on, and a toast says how it ends.
        if (confirmed.kind === 'started') {
          notify(
            'Approve and ship',
            `Lo had started approving and shipping #${plan.number} already. A toast says how it ends.`,
          );
        }
        return;
      }
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
        refusal: { kind: 'failed', text: messageOf(error), rules: [], until: null, newer: null },
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

/** "Merge panel `m`", from a stop after approving: the dialog closes, and the panel opens. */
export function panelFromShip(id: string, number: number): void {
  leaveShip();
  openPanel(id, number);
}

/** "See r2 → r3", from a stop for a newer push: the dialog closes, and the diff shows it. */
export function seeShipNewer(id: string, refusal: Refusal, head: string): void {
  const newer = newerOf(id, refusal, head);
  setDialog(undefined);
  if (newer) seeNewer(id, newer);
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

/** The run the dialog shows, if it shows `key`'s. */
function showing(key: string): boolean {
  const dialog = shipping.getState().dialog;
  return dialog?.kind === 'running' && dialog.plan.key === key;
}

/**
 * A run that's done closes the dialog and says so in a toast, once. One that stopped stays in the
 * dialog while it shows it; else a toast says where it stopped. A merge it sent that GitHub refused
 * shows in the tab's banner once the dialog doesn't.
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
      if (showing(view.key)) setDialog(undefined);
      announce(withoutBidi(shipDoneLine(view, undefined)));
      return;
    case 'stopped':
      said.add(view.key);
      if (!showing(view.key)) {
        notify(
          phase.at === 'approve'
            ? `Lo didn’t approve #${view.number}`
            : phase.at === 'unsure'
              ? `Lo can’t tell yet whether it approved #${view.number}`
              : view.approved
                ? `Approved #${view.number}, but didn’t merge it`
                : `Lo didn’t merge #${view.number}`,
          withoutBidi(phase.refusal.text),
        );
      }
      return;
    default:
      phase satisfies never;
  }
}

/** A run's merge, as `jobs` says it: done, the dialog closes and a toast says so, once. */
function settleJob(view: ShipView, job: JobView | undefined): void {
  if (!job || doneLine(job) === undefined || said.has(view.key)) return;
  said.add(view.key);
  if (showing(view.key)) setDialog(undefined);
  announce(withoutBidi(shipDoneLine(view, job)));
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
  const words = watchedWords(watched, undefined, () => undefined, Date.now());
  notify(withoutBidi(words.title), withoutBidi(words.detail));
}

/** Dismisses what the auto-merge watch said of the pull request `key` names. */
export function dismissWatched(key: string): void {
  const kept = new Map(shipping.getState().watched);
  if (!kept.delete(key)) return;
  shipping.setState({ watched: kept });
}
