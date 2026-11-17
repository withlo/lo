// What merging does in the window: `⏎` in the merge panel asks main for a plan and shows it in the
// dialog in the panel's place; the dialog confirms its key, and `Esc` goes back to the panel. Main
// says how each merge goes on `jobs`: done, a toast says so; refused, or ended without Lo knowing
// how, the dialog says so while it's open, else a banner on the pull request's tab does. The
// window never sends a merge itself.

import { announce, notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { activeTab, pullOf } from '../../tab/window/shared.ts';
import type { JobView, MergePlan, Refusal } from '../contract.ts';
import { closePanel, openPanel, opened } from './actions.ts';
import { main } from './main.ts';
import { merging, panels, pullKey, statuses, type MergeDialog } from './store.ts';
import { cantMerge, doneLine, mergeLabel, shownMethod } from './words.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setDialog(dialog: MergeDialog | undefined): void {
  merging.setState({ dialog });
}

/** Whether `⏎` in the open panel can merge, or why not. */
export function canMerge(): true | string {
  const open = opened();
  if (!open) return 'The merge panel isn’t open.';
  if (merging.getState().dialog !== undefined) return 'A merge is being confirmed.';
  const tab = activeTab();
  return cantMerge(open.state, tab?.kind === 'pull' ? tab.number : 0) ?? true;
}

/**
 * Asks main for the merge the open panel offers, with the method shown and the squash text typed,
 * and shows it in the dialog, in the panel's place, to confirm. A plan main refuses says why, and
 * the panel stays.
 */
export function mergeFromPanel(): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull') return;
  const why = canMerge();
  if (why !== true) {
    notify('Merge', why);
    return;
  }
  const panel = panels.get(open.id);
  const { action } = open.state;
  const method = shownMethod(open.state, panel.method);
  const planning: MergeDialog = {
    kind: 'planning',
    id: open.id,
    number: tab.number,
    label: action.kind === 'merge' ? mergeLabel(method ?? action.method) : 'Add to merge queue',
  };
  closePanel(open.id);
  setDialog(planning);
  const back = (said: string) => {
    if (merging.getState().dialog !== planning) return;
    setDialog(undefined);
    openPanel(open.id, tab.number);
    notify('Merge', said);
  };
  main()
    .plan({
      id: open.id,
      method: method ?? null,
      title: panel.title,
      message: panel.message,
    })
    .then((planned) => {
      if (planned.kind === 'refused') {
        back(planned.why);
        return;
      }
      // Cancelled while it was planned.
      if (merging.getState().dialog !== planning) {
        void main().cancel({ key: planned.plan.key });
        return;
      }
      setDialog({ kind: 'confirm', plan: planned.plan, note: undefined, sending: false });
    })
    .catch((error: unknown) => back(messageOf(error)));
}

/** Confirms the plan the dialog shows, once: main checks it again, and sends it, or says why not. */
export function confirmMerge(): void {
  const dialog = merging.getState().dialog;
  if (dialog?.kind !== 'confirm' || dialog.sending) return;
  const { plan } = dialog;
  setDialog({ ...dialog, sending: true });
  const still = () => {
    const now = merging.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === plan.key;
  };
  main()
    .confirm({ key: plan.key })
    .then((confirmed) => {
      if (!still()) return;
      switch (confirmed.kind) {
        case 'sent':
          setDialog({ kind: 'sent', plan });
          // It may have ended before main answered.
          settled(jobsByKey(plan.key));
          return;
        case 'again':
          setDialog({ kind: 'confirm', plan: confirmed.plan, note: confirmed.why, sending: false });
          return;
        case 'refused':
          setDialog({ kind: 'refused', plan, refusal: confirmed.refusal });
          return;
        default:
          confirmed satisfies never;
      }
    })
    .catch((error: unknown) => {
      if (!still()) return;
      setDialog({
        kind: 'refused',
        plan,
        refusal: { kind: 'failed', text: messageOf(error), rules: [], until: null, newer: null },
      });
    });
}

/**
 * `Esc` in the dialog: a plan not confirmed is forgotten, and the panel comes back; one that went
 * goes on, and the tab shows how it ends.
 */
export function leaveDialog(): void {
  const dialog = merging.getState().dialog;
  if (!dialog) return;
  setDialog(undefined);
  switch (dialog.kind) {
    case 'planning':
      openPanel(dialog.id, dialog.number);
      return;
    case 'confirm':
      void main().cancel({ key: dialog.plan.key });
      openPanel(dialog.plan.id, dialog.plan.number);
      return;
    case 'refused':
      openPanel(dialog.plan.id, dialog.plan.number);
      return;
    case 'sent': {
      // Seen in the dialog, it needs no banner.
      const job = jobsByKey(dialog.plan.key);
      if (job && (job.state.kind === 'refused' || job.state.kind === 'unknown')) seen(job.key);
      return;
    }
    default:
      dialog satisfies never;
  }
}

/** The merge from the plan named `key`, as main last said. */
export function jobsByKey(key: string): JobView | undefined {
  return [...merging.getState().jobs.values()].find((job) => job.key === key);
}

/** Notes that the reader saw how the merge named `key` ended, so no banner says it again. */
function seen(key: string): void {
  merging.setState((state) => ({ seen: new Set([...state.seen, key]) }));
  void main()
    .dismiss({ key })
    .catch(() => undefined);
}

/** Dismisses the banner of the merge named `key`, which main forgets. */
export function dismissJob(key: string): void {
  seen(key);
}

/** Asks GitHub again how the merge named `key` went: a read, nothing sent again. */
export function askAgain(key: string): void {
  main()
    .askAgain({ key })
    .catch((error: unknown) => notify('Ask GitHub again', messageOf(error)));
}

/** A newer push than the one a merge was confirmed at: from that head, to the newer one if known. */
export interface Newer {
  readonly from: string;
  readonly to: string | undefined;
}

/**
 * The newer push to offer after `refusal` of a merge of `head`: the one the refusal names, with the
 * newer head as GitHub said, else as Lo read it since (`latest`). A refusal that names none, such
 * as GitHub's "not mergeable" just after a push, offers the newer push Lo read since, if any.
 */
export function newerFrom(
  refusal: Refusal,
  head: string,
  latest: string | undefined,
): Newer | undefined {
  const { newer } = refusal;
  const since = latest !== undefined && latest !== (newer?.from ?? head) ? latest : undefined;
  if (newer === null) return since === undefined ? undefined : { from: head, to: since };
  return { from: newer.from, to: newer.to ?? since };
}

/** The newer push to offer in view `id` after `refusal` of a merge of `head`, as {@link newerFrom}. */
export function newerOf(id: string, refusal: Refusal, head: string): Newer | undefined {
  const status = statuses.getState().views.get(id);
  const read = status?.kind === 'known' ? status.state.head : '';
  const latest = read !== '' && read !== head ? read : (pullOf(id)?.newer ?? undefined);
  return newerFrom(refusal, head, latest);
}

/** "See r5 → r6", or "See the newer push" when Lo can't name both revisions. */
export function newerLabel(id: string, newer: Newer): string {
  const view = revisionsOf(id);
  const from = revisionLabel(view, newer.from);
  const to = newer.to === undefined ? undefined : revisionLabel(view, newer.to);
  return from && to ? `See ${from} → ${to}` : 'See the newer push';
}

/** Shows what the newer push changed in view `id`: from the head on screen to the newer one. */
export function seeNewer(id: string, newer: Newer): void {
  setDialog(undefined);
  const { to } = newer;
  if (to === undefined) {
    notify('See the newer push', 'Lo hasn’t read the newer push yet.');
    return;
  }
  client(revisionsContract)
    .compare({ id, from: newer.from, to })
    .catch((error: unknown) => notify('See the newer push', messageOf(error)));
}

/** The keys of merges whose toast was shown. */
const toasted = new Set<string>();

/**
 * Takes a merge as main says it. Once it's done, a toast says so, and the dialog closes; one that
 * needs the reader stays in the dialog while it shows it, else the tab's banner says it.
 */
export function heardJob(job: JobView, quiet = false): void {
  const jobs = new Map(merging.getState().jobs);
  jobs.set(pullKey(job.owner, job.repo, job.number), job);
  merging.setState({ jobs });
  if (quiet) {
    if (doneLine(job) !== undefined) toasted.add(job.key);
    return;
  }
  settled(job);
}

/** A merge that's done closes the dialog showing it, and says so in a toast, once. */
function settled(job: JobView | undefined): void {
  if (!job) return;
  const line = doneLine(job);
  if (line === undefined || toasted.has(job.key)) return;
  toasted.add(job.key);
  const dialog = merging.getState().dialog;
  if (dialog && dialog.kind !== 'planning' && dialog.plan.key === job.key) setDialog(undefined);
  // What was typed went with it.
  const plan = dialog && dialog.kind !== 'planning' ? dialog.plan : undefined;
  if (plan?.key === job.key && job.state.kind === 'merged') forgetTyped(plan);
  announce(line);
}

/** Forgets the squash text typed for `plan`'s view, which went with the merge. */
function forgetTyped(plan: MergePlan): void {
  panels.update(plan.id, (panel) => ({ ...panel, title: '', message: '' }));
}

/** Catches up on the merges main follows, as after the window loads again: no toasts. */
export function catchUpJobs(): void {
  main()
    .sent({})
    .then((jobs) => {
      for (const job of jobs) {
        if (!merging.getState().jobs.has(pullKey(job.owner, job.repo, job.number))) {
          heardJob(job, true);
        }
      }
    })
    .catch((error: unknown) => console.error('Lo couldn’t ask how its merges go:', error));
}
