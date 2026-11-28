// What merging does in the window: `⏎` in the merge panel, once Lo knows where the pull request
// sits, asking again where what the panel heard keeps it from merging, asks main for a plan and
// shows it in the dialog in the panel's place; the dialog confirms its key, and `Esc` goes back to
// the panel. "Merge…" from the app menu opens the panel first. Main says how each merge goes on
// `jobs`: done, the dialog says so while it's open, else a toast does; refused, or ended without Lo
// knowing how, the dialog says so while it's open, else a banner on the pull request's tab does. A
// chain's run, which goes on after its merge, says how it ended the same way. The window never
// sends a merge itself. `a` plans auto-merge, and `⌥⏎` a merge past the rules, which confirms only
// with the pull request's number typed, the same way; with auto-merge on, `a` asks main to turn it
// off at once. When GitHub won't turn auto-merge on because nothing blocks the merge now, the
// dialog shows the merge main planned in its place.

import { announce, refuse } from '../../../window/commands/notices.tsx';
import { client } from '../../../window/ipc.ts';
import { contract as revisionsContract } from '../../revisions/contract.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { revisionLabel, revisionsOf } from '../../revisions/window/shared.ts';
import { activeTab, pullOf, withoutBidi } from '../../tab/window/shared.ts';
import type { Asked, JobView, MergePlan, MergeState, PlanKind, Refusal } from '../contract.ts';
import {
  canOpen,
  closePanel,
  openPanel,
  opened,
  PANEL_FIRST,
  panelTrouble,
  whoOf,
} from './actions.ts';
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
  confirmLabel,
  detailsOf,
  doneLine,
  mergeLabel,
  mergeTitle,
  outcomeTitle,
  placedLabel,
  placedWhy,
  refusalText,
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
  if (!open) return PANEL_FIRST;
  const tab = activeTab();
  if (tab?.kind !== 'pull') return PANEL_FIRST;
  return cant(open.state, tab.number, whoOf(tab)) ?? true;
}

/**
 * Whether "Merge…" can run: with the panel closed, it opens it, where it can open; in the panel,
 * `⏎` asks for a merge, unless the status says why not. Where the pull request sits is asked as
 * it's pressed, since what the panel last heard may be out of date. While the dialog shows a merge,
 * there's nothing more to ask, and it does nothing.
 */
export function canMerge(): true | string {
  if (merging.getState().dialog !== undefined) return true;
  if (!opened()) return canOpen();
  return canAsk(cantMerge);
}

/**
 * Whether `a` in the open panel can turn auto-merge on, or off, or why not: not while a merge of the
 * pull request Lo sent is at work, which auto-merge turned off is too, one at a time.
 */
export function canAutoMerge(): true | string {
  const can = canAsk(cantAutoMerge);
  const tab = activeTab();
  if (can !== true || tab?.kind !== 'pull') return can;
  const job = merging.getState().jobs.get(pullKey(tab.owner, tab.repo, tab.number));
  return job && (job.state.kind === 'sending' || job.state.kind === 'pending')
    ? workingOf(job)
    : true;
}

/** What a merge Lo sent is doing while it's at work, as the reason the controls it holds are dimmed. */
function workingOf(job: JobView): string {
  switch (job.kind) {
    case 'merge':
    case 'override':
      return 'Merging…';
    case 'enqueue':
      return 'Adding…';
    case 'autoMerge':
    case 'whenReady':
      return 'Turning on…';
    case 'autoMergeOff':
      return 'Turning off…';
    default:
      job.kind satisfies never;
      return 'Merging…';
  }
}

/** Whether `⌥⏎` in the open panel can merge past the rules, or why not. */
export function canOverride(): true | string {
  return canAsk(cantOverride);
}

/** Whether auto-merge is being turned off for `tab`'s pull request now, as asked or as main says. */
export function turningOff(tab: { id: string; owner: string; repo: string; number: number }) {
  const { turningOff: asked, jobs } = merging.getState();
  if (asked.has(tab.id)) return true;
  const job = jobs.get(pullKey(tab.owner, tab.repo, tab.number));
  return (
    job?.kind === 'autoMergeOff' && (job.state.kind === 'sending' || job.state.kind === 'pending')
  );
}

/** The views whose `⏎` waits to hear where their pull request sits. */
const pressed = new Set<string>();

/**
 * "Merge…": with the panel closed, opens it, at its reasons. In the panel, asks main for the merge
 * it offers, with the method shown and the squash text typed, and shows it in the dialog, in the
 * panel's place, to confirm, once Lo knows where the pull request sits: as the panel heard it,
 * unless that keeps the merge from going, which main is asked again, so it never refuses for where
 * the pull request sat. Where it sits says why it doesn't, and the panel stays.
 */
export function mergeFromPanel(): void {
  if (merging.getState().dialog !== undefined) return;
  const open = opened();
  if (!open) {
    openPanel();
    return;
  }
  const { id, state } = open;
  // The main button reads "Checking…" meanwhile.
  if (pressed.has(id)) return;
  pressed.add(id);
  placeNow(id, state)
    .then((placement) => {
      // The panel closed, or another tab came on screen, while it was asked.
      if (opened()?.id !== id || merging.getState().dialog !== undefined) return;
      const why = placedWhy(placement);
      if (why === undefined) planFromPanel('merge');
      else refuse(withoutBidi(why));
    })
    .catch((error: unknown) => console.error('Lo couldn’t ask where the pull request sits:', error))
    .finally(() => pressed.delete(id));
}

/**
 * `a` in the open panel: turns auto-merge off at once when it's on, its button busy until main
 * answers; else plans it, as `⏎` plans a merge, for the dialog to confirm.
 */
export function autoMergeFromPanel(): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull' || canAutoMerge() !== true) return;
  if (open.state.auto.kind !== 'off') {
    planFromPanel('autoMerge');
    return;
  }
  void turnOffAutoMerge(tab);
}

/**
 * Waits for main's word on the merges it sends, from now, until `said` holds of them: main says on
 * `jobs` how a merge write it sends stands as it answers, but that can come after the answer.
 * `heard` resolves once it holds, at once if it holds now, or once `stop` ends the wait.
 */
function untilSaid(said: (jobs: ReadonlyMap<string, JobView>) => boolean): {
  readonly heard: Promise<void>;
  readonly stop: () => void;
} {
  const { promise, resolve } = Promise.withResolvers<void>();
  const stop = () => {
    unsubscribe();
    resolve();
  };
  const unsubscribe = merging.subscribe((state) => {
    if (said(state.jobs)) stop();
  });
  if (said(merging.getState().jobs)) stop();
  return { heard: promise, stop };
}

/**
 * Turns off auto-merge for `tab`'s pull request at once, asking nothing, since that merges nothing:
 * busy until main answers, and once it's sent, until main says so on `jobs`, which can come after
 * the answer. What went wrong shows in its merge panel, which opens to say it. Resolves to whether
 * main sent it.
 */
export async function turnOffAutoMerge(tab: {
  id: string;
  owner: string;
  repo: string;
  number: number;
}): Promise<boolean> {
  const { id } = tab;
  if (turningOff(tab)) return false;
  const pull = pullKey(tab.owner, tab.repo, tab.number);
  // Sent, it's a merge write of its own, under a key of its own.
  const before = merging.getState().jobs.get(pull)?.key;
  const sent = untilSaid((jobs) => {
    const job = jobs.get(pull);
    return job !== undefined && job.key !== before;
  });
  const asking = (on: boolean) =>
    merging.setState(({ turningOff: was }) => {
      const next = new Set(was);
      if (on) next.add(id);
      else next.delete(id);
      return { turningOff: next };
    });
  const failed = (reason: string | undefined, details: string | undefined) => {
    panelTrouble(id, tab.number, { title: 'Couldn’t turn off auto-merge', reason, details });
    return false;
  };
  asking(true);
  panels.update(id, (panel) => ({ ...panel, trouble: undefined }));
  try {
    const done = await main().autoMergeOff({ id });
    if (done.kind !== 'refused') {
      await sent.heard;
      return true;
    }
    const { refusal } = done;
    const said = refusalText(refusal);
    return failed(said === '' ? undefined : withoutBidi(said), detailsOf(refusal));
  } catch (error) {
    return failed(undefined, messageOf(error));
  } finally {
    sent.stop();
    asking(false);
  }
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

/** What was asked for a plan of `kind`, to ask for it again. */
function askedOf(kind: PlanKind): Asked {
  switch (kind) {
    case 'merge':
    case 'enqueue':
      return 'merge';
    case 'autoMerge':
    case 'whenReady':
      return 'autoMerge';
    case 'override':
      return 'override';
    default:
      kind satisfies never;
      return 'merge';
  }
}

/** What the dialog's main button says while main plans `asked`: what it will say once planned. */
function labelAsked(asked: Asked, label: string): string {
  switch (asked) {
    case 'merge':
      return label;
    case 'autoMerge':
      return 'Turn on auto-merge';
    case 'override':
      return 'Bypass rules and merge';
    default:
      asked satisfies never;
      return label;
  }
}

/** The dialog while main plans. */
type Planning = Extract<MergeDialog, { kind: 'planning' }>;

/** Asks main for what the open panel offers as `asked`, and shows it in the dialog to confirm. */
function planFromPanel(asked: Asked): void {
  const open = opened();
  const tab = activeTab();
  if (!open || tab?.kind !== 'pull') return;
  const can = { merge: canMerge, autoMerge: canAutoMerge, override: canOverride }[asked];
  if (can() !== true || merging.getState().dialog !== undefined) return;
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
  const planning: Planning = {
    kind: 'planning',
    id: open.id,
    number: tab.number,
    label: labelAsked(
      asked,
      placedLabel(
        placement,
        action.kind !== 'merge',
        action.kind === 'merge' ? mergeLabel(tab.number) : 'Add to merge queue',
      ),
    ),
    title: mergeTitle(kind, tab.number, layers),
    ask: { id: open.id, asked, method: method ?? null, title: panel.title, message: panel.message },
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
  plan(planning);
}

/**
 * Why the panel's status says `planning` can't go, for a refusal main gave no reason for: the
 * dimmed control's own words.
 */
function statusWhy(planning: Planning): string | undefined {
  const view = statuses.getState().views.get(planning.id);
  const tab = activeTab();
  if (view?.kind !== 'known' || tab?.kind !== 'pull' || tab.id !== planning.id) return undefined;
  const cant = { merge: cantMerge, autoMerge: cantAutoMerge, override: cantOverride }[
    planning.ask.asked
  ];
  return cant(view.state, planning.number, whoOf(tab));
}

/**
 * Shows `planning` in the dialog and asks main for its plan: shown to confirm once it comes, or why
 * there's none, in the dialog, to try again from.
 */
function plan(planning: Planning): void {
  setDialog(planning);
  const still = () => merging.getState().dialog === planning;
  const { ask } = planning;
  main()
    .plan({
      id: ask.id,
      method: ask.method,
      title: ask.title,
      message: ask.message,
      ...(ask.asked === 'merge' ? {} : { asked: ask.asked }),
    })
    .then((planned) => {
      if (planned.kind === 'refused') {
        // Still finding out, Lo says only how far it has got.
        const said = refusalText({ text: planned.why, cause: planned.cause });
        const why = said === '' && !planned.again ? statusWhy(planning) : said;
        if (still()) {
          setDialog({
            ...planning,
            failed: { why, details: planned.details, again: planned.again },
          });
        }
        return;
      }
      // Cancelled while it was planned.
      if (!still()) {
        void main().cancel({ key: planned.plan.key });
        return;
      }
      setDialog({ kind: 'confirm', plan: planned.plan, note: undefined, sending: false });
    })
    .catch((error: unknown) => {
      if (still())
        setDialog({ ...planning, failed: { why: undefined, details: messageOf(error) } });
    });
}

/**
 * "Try again" in the dialog: plans afresh what was asked, as it was asked, and asks to confirm it
 * once it comes. The title stays, and the main button says "Checking…" meanwhile.
 */
export function planAgain(): void {
  const dialog = merging.getState().dialog;
  if (!dialog || dialog.kind === 'confirm') return;
  if (dialog.kind === 'planning') {
    // While Lo is still finding out, how far it has got stays on screen as it's asked again.
    if (dialog.failed?.again === true) plan({ ...dialog });
    else if (dialog.failed !== undefined) plan({ ...dialog, failed: undefined });
    return;
  }
  const { plan: was } = dialog;
  const head = pullOf(was.id)?.shown ?? was.head;
  const together = was.together?.kind === 'stack' ? was.together : undefined;
  const stack = together !== undefined;
  plan({
    kind: 'planning',
    id: was.id,
    number: was.number,
    label: confirmLabel(was),
    title: mergeTitle(was.kind, was.number, together ? together.below.length + 1 : 1),
    ask: {
      id: was.id,
      asked: askedOf(was.kind),
      method: was.method,
      title: was.title,
      message: was.message,
    },
    sketch: {
      id: was.id,
      number: was.number,
      login: was.login,
      kind: was.kind,
      method: was.method,
      base: was.base,
      head,
      title: was.title,
      stack,
    },
    last: was,
  });
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
  const { plan: confirmed, note } = dialog;
  const typed = dialog.typed ?? '';
  if (confirmed.kind === 'override' && typed !== String(confirmed.number)) return;
  setDialog({ ...dialog, sending: true });
  const still = () => {
    const now = merging.getState().dialog;
    return now?.kind === 'confirm' && now.plan.key === confirmed.key;
  };
  main()
    .confirm(confirmed.kind === 'override' ? { key: confirmed.key, typed } : { key: confirmed.key })
    .then((answer) => {
      // Left as main sent it: it goes on, and a toast or the tab's banner says how it ends.
      if (!still()) return;
      switch (answer.kind) {
        case 'sent':
          setDialog({ kind: 'sent', plan: confirmed, note });
          // It may have ended before main answered.
          settled(jobsByKey(confirmed.key));
          return;
        case 'again':
          // Asked again, the number is typed again.
          setDialog({ kind: 'confirm', plan: answer.plan, note: answer.why, sending: false });
          return;
        case 'refused':
          setDialog({ kind: 'refused', plan: confirmed, refusal: answer.refusal, note });
          return;
        default:
          answer satisfies never;
      }
    })
    .catch((error: unknown) => {
      if (!still()) return;
      setDialog({
        kind: 'refused',
        plan: confirmed,
        refusal: { kind: 'failed', text: '', rules: [], until: null, newer: null },
        note,
        details: messageOf(error),
      });
    });
}

/**
 * `Esc` in the dialog: a plan not confirmed is forgotten, and the panel comes back; one that went
 * goes on, and a toast or the tab's banner says how it ends.
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
    .catch((error: unknown) => console.error(`Lo couldn’t open #${number}:`, error));
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

/** Whether GitHub is being asked again how the merge named `key` went. */
export function checking(key: string): boolean {
  return merging.getState().checking.has(key);
}

/** Marks the merge named `key` as being looked for again, or not. */
function markChecking(key: string, on: boolean): void {
  merging.setState(({ checking: was }) => {
    const next = new Set(was);
    if (on) next.add(key);
    else next.delete(key);
    return { checking: next };
  });
}

/**
 * "Check again": asks GitHub again how the merge named `key` went, a read, nothing sent again. Its
 * button is busy until main answers, and while main asks about the merge itself, until main says
 * on `jobs` that it's pending again, which can come after the answer; how the merge stands then
 * says the rest.
 */
export function askAgain(key: string): Promise<void> {
  if (checking(key)) return Promise.resolve();
  markChecking(key, true);
  const before = jobsByKey(key);
  const pending = untilSaid(() => jobsByKey(key) !== before);
  return main()
    .askAgain({ key })
    .then((asks) => (asks ? pending.heard : undefined))
    .catch((error: unknown) => console.error('Lo couldn’t ask GitHub again:', error))
    .finally(() => {
      pending.stop();
      markChecking(key, false);
    });
}

/** How long "Check again" waits to hear how the last merge ended before its button is its own. */
const LOOK_FOR = 30_000;

/**
 * "Check again" in the dialog, where main refused `asked` since the last merge of its pull request
 * hasn't a known end: asks GitHub how that one went, its button busy until what the look found
 * comes, then goes back to the panel, from where it may merge again. Found not to be known still,
 * the dialog stays, to check again.
 */
export function askAgainBack(asked: MergePlan): void {
  const { key } = asked;
  if (checking(key)) return;
  const pull = pullKey(asked.owner, asked.repo, asked.number);
  const before = merging.getState().jobs.get(pull);
  markChecking(key, true);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stop: (() => void) | undefined;
  const end = (leave: boolean) => {
    stop?.();
    clearTimeout(timer);
    markChecking(key, false);
    const dialog = merging.getState().dialog;
    if (leave && dialog?.kind === 'refused' && dialog.plan.key === key) leaveDialog();
  };
  stop = merging.subscribe((state, previous) => {
    if (state.dialog !== previous.dialog && state.dialog?.kind !== 'refused') {
      end(false);
      return;
    }
    if (state.jobs === previous.jobs) return;
    const job = state.jobs.get(pull);
    if (!job || job === before) return;
    if (job.state.kind === 'sending' || job.state.kind === 'pending') return;
    end(job.state.kind !== 'unknown');
  });
  // GitHub may have nothing more to say of it: the button is its own again after a while.
  timer = setTimeout(() => end(false), LOOK_FOR);
  main()
    .askAgain({ key })
    .catch((error: unknown) => {
      console.error('Lo couldn’t ask GitHub again:', error);
      end(false);
    });
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

/** "Show r6", or "Show latest" while Lo can't name the newer revision. */
export function newerLabel(id: string, newer: Newer): string {
  const to = newer.to === undefined ? undefined : revisionLabel(revisionsOf(id), newer.to);
  return to === undefined ? 'Show latest' : `Show ${to}`;
}

/**
 * Shows what the newer push changed in view `id`: from the head on screen to the newer one. Its
 * button waits, busy, until Lo has read the newer push, and does nothing before.
 */
export function seeNewer(id: string, newer: Newer): void {
  const { to } = newer;
  if (to === undefined) return;
  setDialog(undefined);
  client(revisionsContract)
    .compare({ id, from: newer.from, to })
    .catch((error: unknown) => console.error('Lo couldn’t show the newer revision:', error));
}

/** The keys of merges whose end was said, in the dialog or a toast. */
const toasted = new Set<string>();

/**
 * Takes a merge as main says it. Once it's done, the dialog says so while it shows it, else a
 * toast does; one that needs the reader stays in the dialog while it shows it, else the tab's
 * banner says it.
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

/** Whether the dialog shows the merge named `key`, from its plan. */
function shows(key: string): boolean {
  const dialog = merging.getState().dialog;
  return dialog !== undefined && dialog.kind !== 'planning' && dialog.plan.key === key;
}

/**
 * A merge that's done stays in the dialog that shows it, which says so; else a toast does, once.
 * Auto-merge GitHub wouldn't turn on, since the pull request can merge as it is, shows in the dialog
 * the merge main planned in its place, to confirm as any merge.
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
      note: job.state.kind === 'refused' ? refusalText(job.state.refusal) : undefined,
      sending: false,
    });
    return;
  }
  const line = doneLine(job);
  if (line === undefined || toasted.has(job.key)) return;
  toasted.add(job.key);
  // What was typed went with it.
  const shown = dialog && dialog.kind !== 'planning' ? dialog.plan : undefined;
  if (shown?.key === job.key && job.state.kind === 'merged') forgetTyped(shown);
  // The dialog that shows it says it's done; the auto-merge watch's banner says what it did, and
  // approve and ship's dialog or toast what it did.
  if (shows(job.key) || job.watch === true || shipSent(job.key)) return;
  announce(withoutBidi(line));
}

/** Forgets the squash text typed for `sent`'s view, which went with the merge. */
function forgetTyped(sent: MergePlan): void {
  panels.update(sent.id, (panel) => ({ ...panel, title: '', message: '' }));
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
