// What merging does in the window: `⏎` in the merge panel, once Lo knows where the pull request
// sits, asking again where what the panel heard keeps it from merging, asks main for a plan and
// shows it in the dialog in the panel's place, or says why not; the dialog confirms its key, and
// `Esc` goes back to the panel. Main
// says how each merge goes on `jobs`: done, a toast says so; refused, or ended without Lo knowing
// how, the dialog says so while it's open, else a banner on the pull request's tab does. A chain's
// run, which goes on after its merge, says in a toast how it ended, done or stopped. The window
// never sends a merge itself. `a` plans auto-merge, and `⌥⏎` a merge past the rules, which
// confirms only with the pull request's number typed, the same way; with auto-merge on, `a` asks
// main to turn it off at once. When GitHub won't turn auto-merge on because nothing blocks the
// merge now, the dialog shows the merge main planned in its place.

import { announce, notify } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { activeTab, pullOf, withoutBidi } from '../../tab/window/shared.ts';
import type { Asked, JobView, MergePlan, MergeState, PlanKind, Refusal } from '../contract.ts';
import { closePanel, openPanel, opened } from './actions.ts';
import { main } from './main.ts';
import { placeNow } from './placing.ts';
import {
  merging,
  panels,
  placementOf,
  pullKey,
  shipSent,
  statuses,
  type MergeDialog,
} from './store.ts';
import {
  cantAutoMerge,
  cantMerge,
  cantOverride,
  doneDetail,
  doneLine,
  mergeLabel,
  mergeTitle,
  outcomeDetail,
  outcomeTitle,
  placedLabel,
  placedWhy,
  shownMethod,
} from './words.ts';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setDialog(dialog: MergeDialog | undefined): void {
  merging.setState({ dialog });
}

/** Whether the open panel can ask for something now, as `cant` says of its status, or why not. */
function canAsk(cant: typeof cantMerge): true | string {
  const open = opened();
  if (!open) return 'The merge panel isn’t open.';
  if (merging.getState().dialog !== undefined) return 'A merge is being confirmed.';
  const tab = activeTab();
  return cant(open.state, tab?.kind === 'pull' ? tab.number : 0) ?? true;
}

/**
 * Whether `⏎` in the open panel can ask for a merge, or why not. Where the pull request sits is
 * asked as it's pressed, since what the panel last heard may be out of date.
 */
export function canMerge(): true | string {
  return canAsk(cantMerge);
}

/** Whether `a` in the open panel can turn auto-merge on, or off, or why not. */
export function canAutoMerge(): true | string {
  const can = canAsk(cantAutoMerge);
  const tab = activeTab();
  if (can !== true || tab?.kind !== 'pull') return can;
  // Auto-merge turned off is a merge write too, one at a time.
  const job = merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
  return job?.state.kind === 'sending' || job?.state.kind === 'pending'
    ? `Lo is already merging #${tab.number}.`
    : true;
}

/** Whether `⌥⏎` in the open panel can merge past the rules, or why not. */
export function canOverride(): true | string {
  return canAsk(cantOverride);
}

/** The views whose `⏎` waits to hear where their pull request sits. */
const pressed = new Set<string>();

/**
 * Asks main for the merge the open panel offers, with the method shown and the squash text typed,
 * and shows it in the dialog, in the panel's place, to confirm, once Lo knows where the pull
 * request sits: as the panel heard it, unless that keeps the merge from going, which main is asked
 * again, so it never refuses for where the pull request sat. Where it sits, or a plan main refuses,
 * says why, and the panel stays.
 */
export function mergeFromPanel(): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull') return;
  const { id, state } = open;
  if (pressed.has(id)) {
    notify('Merge', `Lo is checking what merges with #${tab.number}.`);
    return;
  }
  pressed.add(id);
  placeNow(id, state)
    .then((placement) => {
      // The panel closed, or another tab came on screen, while it was asked.
      if (opened()?.id !== id || merging.getState().dialog !== undefined) return;
      const why = placedWhy(placement);
      if (why === undefined) planFromPanel('merge');
      else notify('Merge', withoutBidi(why));
    })
    .catch((error: unknown) => notify('Merge', messageOf(error)))
    .finally(() => pressed.delete(id));
}

/**
 * `a` in the open panel: turns auto-merge off at once when it's on; else plans it, as `⏎` plans a
 * merge, for the dialog to confirm.
 */
export function autoMergeFromPanel(): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull') return;
  const why = canAutoMerge();
  if (why !== true) {
    notify('Merge when ready', withoutBidi(why));
    return;
  }
  if (open.state.auto.kind === 'off') {
    main()
      .autoMergeOff({ id: open.id })
      .then((done) => {
        if (done.kind === 'refused') notify('Turn off auto-merge', withoutBidi(done.refusal.text));
      })
      .catch((error: unknown) => notify('Turn off auto-merge', messageOf(error)));
    return;
  }
  planFromPanel('autoMerge');
}

/** `⌥⏎` in the open panel: plans a merge past the rules, for the dialog to confirm. */
export function overrideFromPanel(): void {
  planFromPanel('override');
}

/** What main will plan for `asked` of a panel at `state`, as far as the panel can tell. */
function kindAsked(asked: Asked, state: MergeState): PlanKind {
  switch (asked) {
    case 'merge':
      return state.action.kind === 'enqueue' ? 'enqueue' : 'merge';
    case 'autoMerge':
      return state.queue.required ? 'whenReady' : 'autoMerge';
    case 'override':
      return 'override';
    default:
      asked satisfies never;
      return 'merge';
  }
}

/** What the dialog's main button says while main plans `asked`: what it will say once planned. */
function labelAsked(asked: Asked, label: string): string {
  switch (asked) {
    case 'merge':
      return label;
    case 'autoMerge':
      return 'Merge when ready';
    case 'override':
      return 'Merge anyway';
    default:
      asked satisfies never;
      return label;
  }
}

/** Asks main for what the open panel offers as `asked`, and shows it in the dialog to confirm. */
function planFromPanel(asked: Asked): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull') return;
  const can = { merge: canMerge, autoMerge: canAutoMerge, override: canOverride }[asked];
  const why = can();
  if (why !== true) {
    notify(asked === 'override' ? 'Merge without the rules' : 'Merge', withoutBidi(why));
    return;
  }
  const panel = panels.get(open.id);
  const { action } = open.state;
  const method = shownMethod(open.state, panel.method);
  const kind = kindAsked(asked, open.state);
  const placement = placementOf(open.id);
  // Auto-merge and a merge past the rules take nothing with them.
  const layers = asked === 'merge' && placement?.kind === 'stack' ? placement.below.length + 1 : 1;
  const pull = pullOf(open.id);
  const login = pull?.acting?.kind === 'account' ? pull.acting.login : undefined;
  const head = pull?.shown ?? undefined;
  const planning: MergeDialog = {
    kind: 'planning',
    id: open.id,
    number: tab.number,
    label: labelAsked(
      asked,
      placedLabel(
        placement,
        action.kind !== 'merge',
        action.kind === 'merge' ? mergeLabel(method ?? action.method) : 'Add to merge queue',
      ),
    ),
    title: mergeTitle(kind, tab.number, layers),
    // What the dialog states is known here already, so it says it while main checks.
    ...(login !== undefined &&
      head !== undefined && {
        sketch: {
          id: open.id,
          number: tab.number,
          login,
          kind,
          method: method ?? null,
          base: open.state.base,
          head,
          title: panel.title,
          stack: layers > 1,
        },
      }),
  };
  closePanel(open.id);
  setDialog(planning);
  const back = (said: string) => {
    if (merging.getState().dialog !== planning) return;
    setDialog(undefined);
    openPanel(open.id, tab.number);
    notify('Merge', withoutBidi(said));
  };
  main()
    .plan({
      id: open.id,
      method: method ?? null,
      title: panel.title,
      message: panel.message,
      ...(asked === 'merge' ? {} : { asked }),
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

/** The number typed in the dialog that confirms a merge past the rules. */
export function typeNumber(typed: string): void {
  const dialog = merging.getState().dialog;
  if (dialog?.kind === 'confirm' && !dialog.sending) setDialog({ ...dialog, typed });
}

/**
 * Confirms the plan the dialog shows, once: main checks it again, and sends it, or says why not. A
 * merge past the rules goes only with its number typed.
 */
export function confirmMerge(): void {
  const dialog = merging.getState().dialog;
  if (dialog?.kind !== 'confirm' || dialog.sending) return;
  const { plan } = dialog;
  const typed = dialog.typed ?? '';
  if (plan.kind === 'override' && typed !== String(plan.number)) return;
  setDialog({ ...dialog, sending: true });
  const still = () => {
    const now = merging.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === plan.key;
  };
  main()
    .confirm(plan.kind === 'override' ? { key: plan.key, typed } : { key: plan.key })
    .then((confirmed) => {
      if (!still()) {
        // Left as main sent it: it goes on, and the tab shows how it ends.
        if (confirmed.kind === 'sent') {
          notify(
            'Merge',
            `Lo had sent #${plan.number}’s ${plan.kind === 'autoMerge' || plan.kind === 'whenReady' ? 'auto-merge' : 'merge'} already. The tab shows how it ends.`,
          );
        }
        return;
      }
      switch (confirmed.kind) {
        case 'sent':
          setDialog({ kind: 'sent', plan });
          // It may have ended before main answered.
          settled(jobsByKey(plan.key));
          return;
        case 'again':
          // Asked again, the number is typed again.
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
      if (job && outcomeTitle(job) !== undefined) seen(job.key);
      return;
    }
    default:
      dialog satisfies never;
  }
}

/** Opens pull request `number` of `job`'s repository in its tab, as "Open #4824" does. */
export function openPull(job: Pick<JobView, 'owner' | 'repo'>, number: number): void {
  setDialog(undefined);
  client(tabContract)
    .open({ kind: 'pull', owner: job.owner, repo: job.repo, number })
    .catch((error: unknown) => notify(`Open #${number}`, messageOf(error)));
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
    const stopped = job.together?.kind === 'chain' && job.together.phase === 'stopped';
    if (doneLine(job) !== undefined || stopped) toasted.add(job.key);
    return;
  }
  settled(job);
}

/**
 * Whether a merge that's done stays in the dialog showing it, to offer what comes next: a GitHub
 * stack's merge, with the layers above it, which moved onto the base.
 */
export function staysShown(job: JobView): boolean {
  const { together } = job;
  return together?.kind === 'stack' && together.above.length > 0 && job.state.kind === 'merged';
}

/**
 * A merge that's done closes the dialog showing it, and says so in a toast, once. Auto-merge GitHub
 * wouldn't turn on, since the pull request can merge as it is, shows in the dialog the merge main
 * planned in its place, to confirm as any merge.
 */
function settled(job: JobView | undefined): void {
  if (!job) return;
  const dialog = merging.getState().dialog;
  const offer = job.state.kind === 'refused' ? job.state.refusal.offer : undefined;
  if (offer && dialog?.kind === 'sent' && dialog.plan.key === job.key) {
    seen(job.key);
    setDialog({
      kind: 'confirm',
      plan: offer,
      note: job.state.kind === 'refused' ? job.state.refusal.text : undefined,
      sending: false,
    });
    return;
  }
  const line = doneLine(job);
  if (toasted.has(job.key)) return;
  const shown = dialog && dialog.kind !== 'planning' && dialog.plan.key === job.key;
  if (line === undefined) {
    // A chain's run that stopped after its merge went says so wherever the reader is.
    const { together } = job;
    if (together?.kind !== 'chain' || together.phase !== 'stopped') return;
    if (job.state.kind === 'refused') return;
    toasted.add(job.key);
    if (!shown) notify(outcomeTitle(job) ?? '', withoutBidi(outcomeDetail(job)));
    return;
  }
  toasted.add(job.key);
  // The auto-merge watch's banner says what it did, and approve and ship's toast what it did.
  if (job.watch === true || shipSent(job.key)) return;
  if (shown && !staysShown(job)) setDialog(undefined);
  // What was typed went with it.
  const plan = dialog && dialog.kind !== 'planning' ? dialog.plan : undefined;
  if (plan?.key === job.key && job.state.kind === 'merged') forgetTyped(plan);
  announce(withoutBidi(line), withoutBidi(doneDetail(job)));
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
