// What approve and ship's dialog says: its two steps as the confirmation lists them, how each stands
// as it runs, what the main button says meanwhile, where it stopped and why, what it did once it's
// done, and what the auto-merge watch says of a push after your approval. Pure functions, so
// they're tested without a window.

import type { StepState } from '@lo/ui';

import type { RevisionRow } from '../../revisions/contract.ts';
import type {
  JobView,
  Method,
  PlanKind,
  Refusal,
  ShipApproval,
  ShipPlan,
  ShipStep,
  ShipStop,
  ShipView,
  Watched,
} from '../contract.ts';
import {
  ago,
  capitalized,
  confirmLabel,
  counted,
  detailsOf,
  doneLine,
  inTheWayOf,
  mergeTitle,
  outcomeDetail,
  outcomeTitle,
  pushWarning,
  refusalText,
  waitsFor,
  type Said,
} from './words.ts';

/** A revision's label, "r3", for its head, or nothing when Lo has no revision for it. */
export type Label = (head: string) => string | undefined;

/** A step, in words, and how it stands. */
export interface StepWords {
  readonly key: string;
  readonly state: StepState;
  readonly title: string;
  readonly detail?: string | undefined;
}

/** A revision as the dialog names it: "r2", or its commit's short ID. */
export function revision(label: Label, head: string): string {
  return label(head) ?? head.slice(0, 7);
}

/** What goes with the approval: "Your summary and 1 pending comment are submitted with it." */
function withWords(approval: ShipApproval, summary: boolean): string | undefined {
  const comments = approval.kind === 'submitPending' ? approval.comments : 0;
  if (comments > 0) {
    const pending = counted(comments, 'pending comment');
    return summary
      ? `Your summary and ${pending} are submitted with it.`
      : `${pending} ${comments === 1 ? 'is' : 'are'} submitted with it.`;
  }
  return summary ? 'Your summary is submitted with it.' : undefined;
}

/** The approval step, as the confirmation lists it, or as it stands once run. */
function approveStep(
  plan: Pick<ShipPlan, 'approval' | 'login' | 'number' | 'summary'>,
  state: StepState,
): StepWords {
  const key = 'approve';
  const { approval, login, number } = plan;
  switch (approval.kind) {
    case 'ownPullRequest':
      return {
        key,
        state: 'skipped',
        title: `Approve #${number}.`,
        detail: 'Authors can’t approve their own pull request.',
      };
    case 'alreadyApproved':
      return { key, state: 'done', title: `Approved as ${login}.` };
    // The step keeps the words it was asked with in every state: its ball says it's done.
    case 'approve':
    case 'submitPending':
    case 'reapproveDismissed': {
      const again = approval.kind === 'reapproveDismissed' ? ' again' : '';
      return {
        key,
        state,
        title: `Approve #${number}${again} as ${login}.`,
        detail: withWords(approval, plan.summary),
      };
    }
    default:
      approval satisfies never;
      return { key, state, title: `Approve #${number}.` };
  }
}

/** What a step that waits names, as the merge panel's auto-merge does. */
function namedOf(plan: Pick<ShipPlan, 'base' | 'afterPush'>, step: ShipStep): Said {
  const waitingOn = 'waitingOn' in step ? step.waitingOn : [];
  return {
    blockers: waitingOn,
    unchecked: [],
    partial: false,
    afterPush: plan.afterPush,
    queue: {
      required: step.kind === 'enqueue' || step.kind === 'enqueueWhenReady',
      method: step.kind === 'enqueue' || step.kind === 'enqueueWhenReady' ? step.method : null,
    },
    base: plan.base,
  };
}

/** Who approve and ship acts as, and where. */
type Where = Pick<ShipPlan, 'owner' | 'repo' | 'login' | 'base'>;

/** Why a step stopped, after its title, in words, if anything more. */
export function stopWords(stop: ShipStop, where: Where): string | undefined {
  switch (stop.kind) {
    case 'blocked':
      return stop.autoMerge
        ? `${capitalized(inTheWayOf(stop.blockers))}. Auto-merge is on.`
        : `${capitalized(inTheWayOf(stop.blockers))}.`;
    case 'noAutoMerge':
      return `${where.owner}/${where.repo} doesn’t allow auto-merge, or ${where.login} can’t merge.`;
    case 'incomplete':
      return stop.incomplete === 'checksCutShort' ? 'It has over 1,000 checks.' : undefined;
    case 'headMoved':
    case 'headUnknown':
    case 'noPermission':
    case 'noMethod':
    case 'where':
      return undefined;
    default:
      stop satisfies never;
      return undefined;
  }
}

/** A stopped step's title, as the dialog names where it stopped: "Can’t merge yet." */
export function stopTitle(stop: ShipStop, where: Where): string {
  switch (stop.kind) {
    case 'headMoved':
      return 'This revision is out of date.';
    case 'headUnknown':
    case 'incomplete':
      return stop.kind === 'incomplete' && stop.incomplete === 'checksCutShort'
        ? 'Can’t merge yet.'
        : 'GitHub returned an error.';
    case 'blocked':
      return 'Can’t merge yet.';
    case 'noAutoMerge':
      return 'Can’t turn on auto-merge.';
    case 'noPermission':
      return `${where.login} can’t merge into ${where.base}.`;
    case 'noMethod':
      return `${where.owner}/${where.repo} allows no merge method.`;
    case 'where':
      return stop.text;
    default:
      stop satisfies never;
      return 'GitHub returned an error.';
  }
}

/** How GitHub merges with `method`, as a step after the approval says it: "squashes and merges". */
function merges(method: Method | null): string {
  switch (method) {
    case 'SQUASH':
      return 'squashes and merges';
    case 'REBASE':
      return 'rebases and merges';
    case 'MERGE':
    case null:
      return 'merges';
    default:
      method satisfies never;
      return 'merges';
  }
}

/** The step after the approval that merges, by its method: "Squash and merge it into main." */
function mergeStepTitle(method: Method, base: string): string {
  switch (method) {
    case 'SQUASH':
      return `Squash and merge it into ${base}.`;
    case 'MERGE':
      return `Merge it into ${base} with a merge commit.`;
    case 'REBASE':
      return `Rebase and merge it into ${base}.`;
    default:
      method satisfies never;
      return `Merge it into ${base}.`;
  }
}

/** The step after the approval, as the confirmation lists it. */
function shipStep(
  plan: Where & Pick<ShipPlan, 'afterPush'>,
  step: ShipStep,
  state: StepState,
): StepWords {
  const key = 'ship';
  const { base } = plan;
  switch (step.kind) {
    case 'merge':
      return { key, state, title: mergeStepTitle(step.method, base) };
    case 'enqueue':
      return { key, state, title: `Add it to the merge queue for ${base}.` };
    case 'autoMerge':
      return {
        key,
        state,
        title: 'Turn on auto-merge.',
        detail: `GitHub ${merges(step.method)} it into ${base} once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'enqueueWhenReady':
      return {
        key,
        state,
        title: 'Turn on auto-merge.',
        detail: `It joins the merge queue for ${base} once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'autoMergeAlreadyOn':
      return {
        key,
        state,
        title: 'Auto-merge is on.',
        detail:
          step.waitingOn.length === 0
            ? 'GitHub merges it once it’s approved.'
            : `GitHub merges it once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'alreadyQueued':
      return { key, state, title: `In the merge queue for ${base}.` };
    case 'stop':
      return {
        key,
        state: state === 'todo' ? state : 'stopped',
        title: stopTitle(step.stop, plan),
        detail: stopWords(step.stop, plan),
      };
    default:
      step satisfies never;
      return { key, state, title: `Merge it into ${base}.` };
  }
}

/** What the main button says while the step after the approval runs: "Merging…". */
export function stepWorking(step: ShipStep): string {
  switch (step.kind) {
    case 'merge':
      return 'Merging…';
    case 'enqueue':
      return 'Adding…';
    case 'autoMerge':
    case 'enqueueWhenReady':
      return 'Turning on…';
    case 'autoMergeAlreadyOn':
    case 'alreadyQueued':
    case 'stop':
      return 'Approving…';
    default:
      step satisfies never;
      return 'Approving…';
  }
}

/**
 * What `plan` does as the merge panel names it, when its approval step is skipped, since you wrote
 * the pull request: nothing where it approves or has approved, before it's planned, or when the
 * step after does nothing either.
 */
function shipsOnly(plan: ShipPlan | undefined): PlanKind | undefined {
  if (plan?.approval.kind !== 'ownPullRequest') return undefined;
  switch (plan.likely.kind) {
    case 'merge':
      return 'merge';
    case 'enqueue':
      return 'enqueue';
    case 'autoMerge':
      return 'autoMerge';
    case 'enqueueWhenReady':
      return 'whenReady';
    case 'autoMergeAlreadyOn':
    case 'alreadyQueued':
    case 'stop':
      return undefined;
    default:
      plan.likely satisfies never;
      return undefined;
  }
}

/**
 * The dialog's title, the same in every state once it's planned: "Approve and ship #264?", or on
 * your own pull request, which you can't approve, only what follows: "Merge #264?"; or, where
 * nothing follows either, why: it's in the merge queue already, auto-merge is on already, or it
 * can't be merged.
 */
export function shipTitle(number: number, plan?: ShipPlan): string {
  if (plan?.approval.kind !== 'ownPullRequest') return `Approve and ship #${number}?`;
  switch (plan.likely.kind) {
    case 'merge':
    case 'enqueue':
    case 'autoMerge':
    case 'enqueueWhenReady':
      return `${mergeTitle(shipsOnly(plan) ?? 'merge', number, 1)}?`;
    case 'alreadyQueued':
      return `#${number} is already in the merge queue`;
    case 'autoMergeAlreadyOn':
      return `Auto-merge is already on for #${number}`;
    case 'stop':
      return `Can’t merge #${number}`;
    default:
      plan.likely satisfies never;
      return `Can’t merge #${number}`;
  }
}

/**
 * The dialog's main button: "Approve and ship", or on your own pull request, the merge panel's
 * button for what follows: "Merge #264".
 */
export function shipLabel(plan?: ShipPlan): string {
  const only = shipsOnly(plan);
  return plan === undefined || only === undefined
    ? 'Approve and ship'
    : confirmLabel({ kind: only, number: plan.number });
}

/** The two steps the confirmation lists, none done yet: the approval, then what follows it. */
export function plannedSteps(plan: ShipPlan): StepWords[] {
  return [approveStep(plan, 'todo'), shipStep(plan, plan.likely, 'todo')];
}

/**
 * What the confirmation warns of a commit pushed before it merges, when auto-merge may follow your
 * approval: and that auto-merge turns off when one comes, while Lo is open.
 */
export function shipWarning(plan: ShipPlan): string | undefined {
  if (!plan.warning) return undefined;
  const warning = pushWarning({ afterPush: plan.afterPush, base: plan.base });
  if (warning === undefined) return undefined;
  return `${warning} While Lo is open, auto-merge turns off if a commit is pushed after your approval.`;
}

/** Who pushed `head`, and when, as the revisions have it: "mira-chen pushed r3 2 min ago". */
export function pushedWords(
  revisions: readonly RevisionRow[] | undefined,
  head: string,
  label: Label,
  now: number | undefined,
): string {
  const found = revisions?.find((each) => each.head === head.toLowerCase());
  const shown = revision(label, head);
  const who = found?.pusher ?? 'Someone';
  const when =
    now !== undefined && (found?.pushedAt.kind === 'exact' || found?.pushedAt.kind === 'by')
      ? ` ${ago(found.pushedAt.at, now)}`
      : '';
  return `${who} pushed ${shown}${when}`;
}

/** Whether approve and ship from `approval` sends an approval. */
export function approves(approval: ShipApproval): boolean {
  return approval.kind !== 'ownPullRequest' && approval.kind !== 'alreadyApproved';
}

/**
 * What the main button does where it stopped: "Try again", which plans it afresh; "Show r6" for a
 * newer revision; "Merge panel", to merge from there once it has approved; "Check again" for a
 * merge whose end isn't known, or, for an approval whose end isn't known, `look`, which reads your
 * reviews to tell whether it went, sending nothing, and plans afresh once that's known.
 */
export type Again =
  | { readonly kind: 'try' }
  | { readonly kind: 'look' }
  | { readonly kind: 'newer'; readonly refusal: Refusal; readonly head: string }
  | { readonly kind: 'panel' }
  | { readonly kind: 'check'; readonly job: JobView };

/**
 * How a run stands, for the foot and the line above it: still at work, with what the main button
 * says meanwhile; done, with what it did; or stopped, with what went wrong and what to do.
 */
export type End =
  | { readonly kind: 'running'; readonly working: string }
  | { readonly kind: 'done'; readonly line: string }
  | {
      readonly kind: 'failed';
      readonly title: string;
      readonly reason: string | undefined;
      /** GitHub's own text, or the error's, which only Details shows. */
      readonly details?: string | undefined;
      readonly again: Again;
    };

/** What the dialog shows once it runs: the steps as they stand, and how it stands. */
export interface Running {
  readonly steps: StepWords[];
  readonly end: End;
}

/** What tells who pushed a revision, and when: `revisions`, as of `now`. */
export interface Pushes {
  readonly label: Label;
  readonly revisions: readonly RevisionRow[] | undefined;
  readonly now: number;
}

/** Where a stop after a newer revision ends: "This revision is out of date.", and "Show r6". */
export function newerEnd(number: number, refusal: Refusal, head: string): End {
  return {
    kind: 'failed',
    title: `Couldn’t approve #${number}`,
    reason: 'This revision is out of date.',
    again: { kind: 'newer', refusal, head },
  };
}

/**
 * The title of a run that stopped at its merge, in its dialog: the approval step says whether it
 * approved.
 */
function unmerged(plan: Pick<ShipPlan, 'number'>): string {
  return `Couldn’t merge #${plan.number}`;
}

/**
 * How approve and ship from `plan` stands, as main last said (`view`, nothing before it said), and
 * the merge it sent (`job`), if it sent one.
 */
export function runningOf(
  plan: ShipPlan,
  view: ShipView | undefined,
  job: JobView | undefined,
): Running {
  const approving = approves(plan.approval);
  const approved = view?.approved === true || plan.approval.kind === 'alreadyApproved';
  const approval = (state: StepState) => approveStep(plan, state);
  const phase = view?.phase;
  switch (phase?.kind) {
    case undefined:
    case 'approving':
      return {
        steps: [approval(approving ? 'now' : 'todo'), shipStep(plan, plan.likely, 'todo')],
        end: { kind: 'running', working: approving ? 'Approving…' : stepWorking(plan.likely) },
      };
    case 'reading':
      return {
        steps: [approval('done'), shipStep(plan, plan.likely, 'now')],
        end: { kind: 'running', working: stepWorking(plan.likely) },
      };
    case 'done':
      return {
        steps: [approval('done'), shipStep(plan, phase.step, 'done')],
        end: { kind: 'done', line: shipDoneLine(view ?? { ...plan, approved }, undefined) },
      };
    case 'sending':
      return sendingOf(plan, phase.step, job, approved, view, approval('done'));
    case 'stopped': {
      const { refusal, stop } = phase;
      if (phase.at === 'approve' || phase.at === 'unsure') {
        const steps = [
          { ...approval('stopped'), state: 'stopped' as const },
          { ...shipStep(plan, plan.likely, 'todo'), state: 'skipped' as const, detail: undefined },
        ];
        if (phase.at === 'approve' && refusal.newer !== null) {
          return { steps, end: newerEnd(plan.number, refusal, plan.head) };
        }
        return {
          steps,
          end: {
            kind: 'failed',
            title:
              phase.at === 'unsure' ? 'Approval not confirmed' : `Couldn’t approve #${plan.number}`,
            reason:
              refusalText(refusal) ||
              (phase.at === 'unsure' ? 'GitHub didn’t respond.' : undefined),
            details: detailsOf(refusal),
            again: phase.at === 'unsure' ? { kind: 'look' } : { kind: 'try' },
          },
        };
      }
      const planned = shipStep(plan, plan.likely, 'stopped');
      const why =
        stop === null
          ? refusalText(refusal)
          : [stopTitle(stop, plan), stopWords(stop, plan)].filter((part) => part).join(' ');
      return {
        steps: [
          approval(approved ? 'done' : 'skipped'),
          // The step stays as it was asked: the problem says why it stopped.
          {
            ...planned,
            state: 'stopped',
            detail: plan.likely.kind === 'stop' ? planned.detail : undefined,
          },
        ],
        end: {
          kind: 'failed',
          title: unmerged(plan),
          reason: why === '' ? undefined : why,
          details: detailsOf(refusal),
          again:
            refusal.newer !== null
              ? { kind: 'newer', refusal, head: plan.head }
              : approved
                ? { kind: 'panel' }
                : { kind: 'try' },
        },
      };
    }
    default:
      phase satisfies never;
      return { steps: [], end: { kind: 'running', working: 'Approving…' } };
  }
}

/** The run once its step after approving went through the merge jobs, as `job` says it goes. */
function sendingOf(
  plan: ShipPlan,
  step: ShipStep,
  job: JobView | undefined,
  approved: boolean,
  view: ShipView | undefined,
  approval: StepWords,
): Running {
  const going = shipStep(plan, step, 'now');
  const state = job?.state;
  const working: Running = {
    steps: [approval, going],
    end: { kind: 'running', working: stepWorking(step) },
  };
  switch (state?.kind) {
    case undefined:
    case 'sending':
    case 'pending':
      return working;
    case 'refused': {
      // GitHub can merge it now: Lo reads it again and merges it instead, and the step says so.
      if (state.refusal.kind === 'canMergeNow') {
        return {
          steps: [approval, { ...going, title: `Merge it into ${plan.base}.`, detail: undefined }],
          end: { kind: 'running', working: 'Merging…' },
        };
      }
      return {
        steps: [approval, { ...going, state: 'stopped' }],
        end: {
          kind: 'failed',
          title: unmerged(plan),
          reason: (job ? outcomeDetail(job) : refusalText(state.refusal)) || undefined,
          details: detailsOf(state.refusal),
          again:
            state.refusal.newer !== null
              ? { kind: 'newer', refusal: state.refusal, head: plan.head }
              : approved
                ? { kind: 'panel' }
                : { kind: 'try' },
        },
      };
    }
    case 'unknown':
      return {
        steps: [approval, going],
        end: job
          ? {
              kind: 'failed',
              title: outcomeTitle(job) ?? 'Merge not confirmed',
              reason: outcomeDetail(job) || undefined,
              again: { kind: 'check', job },
            }
          : working.end,
      };
    case 'merged':
    case 'enqueued':
    case 'autoMergeOn':
    case 'autoMergeOff':
      return {
        steps: [approval, { ...going, state: 'done' }],
        end: { kind: 'done', line: shipDoneLine(view ?? { ...plan, approved }, job) },
      };
    default:
      state satisfies never;
      return working;
  }
}

/**
 * What approve and ship did, once it's done, in its dialog or its toast: "Approved and merged
 * #4821", or without the approval, the merge's own words. With nothing more to send, what was
 * there already.
 */
export function shipDoneLine(
  view: Pick<ShipView, 'number' | 'approved' | 'approval'> & { readonly phase?: ShipView['phase'] },
  job: JobView | undefined,
): string {
  const approved = view.approved && approves(view.approval);
  const line = job ? doneLine(job) : undefined;
  if (line !== undefined && job) {
    if (!approved) return line;
    switch (job.state.kind) {
      case 'merged':
        return `Approved and merged #${view.number}`;
      case 'enqueued':
        return `Approved and added #${view.number} to merge queue`;
      case 'autoMergeOn':
        return `Approved #${view.number} and turned on auto-merge`;
      case 'autoMergeOff':
      case 'sending':
      case 'pending':
      case 'refused':
      case 'unknown':
        return `Approved #${view.number}`;
      default:
        job.state satisfies never;
        return `Approved #${view.number}`;
    }
  }
  if (approved) return `Approved #${view.number}`;
  const step = view.phase?.kind === 'done' ? view.phase.step : undefined;
  return step?.kind === 'alreadyQueued'
    ? `#${view.number} is already in the merge queue`
    : `Auto-merge is already on for #${view.number}`;
}

/**
 * The banner the auto-merge watch shows on the pull request's tab, or the toast without one: one
 * line, and its one button, which acts.
 */
export interface WatchedWords {
  readonly tone: 'danger' | 'warn';
  readonly title: string;
  /** The reason, for a failure. */
  readonly detail: string | undefined;
  /** "Show r5", or "Turn off auto-merge". */
  readonly action: 'show' | 'turnOff';
}

/** What the auto-merge watch says of `watched`, a push after your approval. */
export function watchedWords(
  watched: Watched,
  revisions: readonly RevisionRow[] | undefined,
  label: Label,
): WatchedWords {
  const pushed = pushedWords(revisions, watched.head, label, undefined);
  switch (watched.kind) {
    case 'turnedOff':
      return {
        tone: 'warn',
        title: `${pushed} after your approval · Auto-merge is off`,
        detail: undefined,
        action: 'show',
      };
    case 'notTurnedOff':
      return {
        tone: 'danger',
        title: 'Couldn’t turn off auto-merge',
        detail: `${pushed} after your approval.`,
        action: 'turnOff',
      };
    case 'cantTell':
      return {
        tone: 'warn',
        title: `${pushed} after your approval · Auto-merge is on`,
        detail: undefined,
        action: 'turnOff',
      };
    default:
      watched.kind satisfies never;
      return { tone: 'warn', title: pushed, detail: undefined, action: 'show' };
  }
}
