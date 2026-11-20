// What approve and ship's dialog says: each step as the confirmation lists it, how each stands as it
// runs, where it stopped and why, and what the auto-merge watch says of a push after your approval.
// Pure functions, so they're tested without a window.

import type { StepState } from '@lo/ui';

import type { RevisionRow } from '../../revisions/contract.ts';
import type {
  JobView,
  Method,
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
  counted,
  doneLine,
  inTheWayOf,
  layersOf,
  mergeLabel,
  methodLabel,
  outcomeDetail,
  outcomeTitle,
  pendingLine,
  pushWarning,
  queueLine,
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

/** The first step: the revision on screen is still the newest push. */
function checkStep(plan: Pick<ShipPlan, 'head'>, label: Label, state: StepState): StepWords {
  const shown = revision(label, plan.head);
  return state === 'done'
    ? { key: 'check', state, title: `Newest push is ${shown}` }
    : {
        key: 'check',
        state,
        title: `Check that ${shown} is still the newest push`,
        detail: 'If anyone pushed since you looked, Lo stops here and approves nothing.',
      };
}

/** What goes with the approval: "With your summary and 1 pending comment." */
function withWords(approval: ShipApproval, summary: boolean): string | undefined {
  const comments = approval.kind === 'submitPending' ? approval.comments : 0;
  if (comments > 0) {
    return `With your ${summary ? 'summary and ' : ''}${counted(comments, 'pending comment')}.`;
  }
  return summary ? 'With your summary.' : undefined;
}

/** The approval step, as the confirmation lists it, or as it stands once run. */
function approveStep(
  approval: ShipApproval,
  login: string,
  head: string,
  summary: boolean,
  label: Label,
  state: StepState,
): StepWords {
  const key = 'approve';
  switch (approval.kind) {
    case 'ownPullRequest':
      return {
        key,
        state: 'skipped',
        title: 'Approve',
        detail: 'It’s your pull request, so GitHub takes no approval from you.',
      };
    case 'alreadyApproved':
      return {
        key,
        state: 'done',
        title: `Approved as ${login}`,
        detail: `You approved ${revision(label, head)} already.`,
      };
    case 'approve':
    case 'submitPending':
    case 'reapproveDismissed': {
      const again = approval.kind === 'reapproveDismissed';
      if (state === 'done') return { key, state, title: `Approved as ${login}` };
      const dismissed = again ? 'Your approval was dismissed.' : undefined;
      const goes = withWords(approval, summary);
      return {
        key,
        state,
        title: `${again ? 'Approve again' : 'Approve'} as ${login}`,
        detail: [dismissed, goes].filter((each) => each !== undefined).join(' ') || undefined,
      };
    }
    default:
      approval satisfies never;
      return { key, state, title: 'Approve' };
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

/** Why a step stopped, in words. */
export function stopWords(stop: ShipStop, base: string): string {
  switch (stop.kind) {
    case 'headMoved':
      return 'Someone pushed after the approval, so Lo merged nothing.';
    case 'headUnknown':
      return 'GitHub didn’t say which commit it’s at, so Lo merged nothing.';
    case 'blocked':
      return stop.autoMerge
        ? `Can’t merge: ${inTheWayOf(stop.blockers)}. Auto-merge is on, so GitHub merges it if that clears.`
        : `Can’t merge: ${inTheWayOf(stop.blockers)}. Your approval stays.`;
    case 'noAutoMerge':
      return `It waits on ${inTheWayOf(stop.blockers)}, and GitHub doesn’t let you turn on auto-merge for it.`;
    case 'noPermission':
      return `GitHub doesn’t let you merge into ${base}.`;
    case 'noMethod':
      return 'The repository allows no merge method.';
    case 'incomplete':
      return stop.incomplete === 'checksCutShort'
        ? 'GitHub has over 1,000 checks here, so Lo merged nothing. Merge it on GitHub.'
        : 'GitHub left part of its answer out, so Lo merged nothing.';
    case 'where':
      return stop.text;
    default:
      stop satisfies never;
      return 'Lo stopped.';
  }
}

/** A method as GitHub doing it: "squashes". */
function merges(method: Method | null): string {
  switch (method) {
    case 'SQUASH':
      return 'squashes';
    case 'REBASE':
      return 'rebases';
    case 'MERGE':
    case null:
      return 'merges';
    default:
      method satisfies never;
      return 'merges';
  }
}

/** The step after the approval, as the confirmation lists it. */
function shipStep(
  plan: Pick<ShipPlan, 'base' | 'afterPush' | 'approval' | 'together'>,
  step: ShipStep,
  state: StepState,
): StepWords {
  const key = 'ship';
  const { base } = plan;
  // A GitHub stack's layers below merge with it.
  const layers = layersOf(plan.together);
  switch (step.kind) {
    case 'merge':
      return {
        key,
        state,
        title:
          layers > 1
            ? `Merge ${layers} layers into ${base}`
            : `${mergeLabel(step.method)} into ${base}`,
      };
    case 'enqueue':
      return {
        key,
        state,
        title:
          layers > 1
            ? `Add ${layers} layers to the merge queue for ${base}`
            : `Add to the merge queue for ${base}`,
        detail: queueLine(step.method),
      };
    case 'autoMerge':
      return {
        key,
        state,
        title: `Turn on auto-merge, ${methodLabel(step.method).toLowerCase()} into ${base}`,
        detail: `GitHub ${merges(step.method)} it once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'enqueueWhenReady':
      return {
        key,
        state,
        title: `Merge when ready, through the merge queue for ${base}`,
        detail: `GitHub adds it to the queue once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'autoMergeAlreadyOn':
      return {
        key,
        state,
        title: 'Nothing more: auto-merge is on already',
        detail:
          step.waitingOn.length === 0
            ? 'GitHub merges it now.'
            : `GitHub merges it once ${waitsFor(namedOf(plan, step))}.`,
      };
    case 'alreadyQueued':
      return { key, state, title: `Nothing more: it’s in the merge queue for ${base} already` };
    case 'stop':
      return {
        key,
        state: state === 'todo' ? 'todo' : 'stopped',
        title: plan.approval.kind === 'ownPullRequest' ? 'Stop there' : 'Stop after approving',
        detail: stopWords(step.stop, base),
      };
    default:
      step satisfies never;
      return { key, state, title: 'Ship' };
  }
}

/** The confirmation's title. */
export function shipTitle(number: number): string {
  return `Approve and ship #${number}?`;
}

/** The confirmation's main button: it approves, or only ships. */
export function shipLabel(approval: ShipApproval): string {
  return approval.kind === 'ownPullRequest' || approval.kind === 'alreadyApproved'
    ? 'Ship'
    : 'Approve and ship';
}

/** The steps the confirmation lists, none done yet. */
export function plannedSteps(plan: ShipPlan, label: Label): StepWords[] {
  return [
    checkStep(plan, label, 'todo'),
    approveStep(plan.approval, plan.login, plan.head, plan.summary, label, 'todo'),
    shipStep(plan, plan.likely, 'todo'),
  ];
}

/**
 * What the confirmation warns of a push before it merges, when auto-merge may follow your
 * approval: and that Lo turns it off when one comes, while it runs.
 */
export function shipWarning(plan: ShipPlan): string | undefined {
  if (!plan.warning) return undefined;
  const warning = pushWarning({ afterPush: plan.afterPush, base: plan.base });
  if (warning === undefined) return undefined;
  return `${warning} While Lo runs, it turns auto-merge off if someone pushes after your approval.`;
}

/** Who pushed `head`, and when, as the revisions have it: "mira-chen pushed r3 2 min ago". */
export function pushedWords(
  revisions: readonly RevisionRow[] | undefined,
  head: string,
  label: Label,
  now: number,
): string {
  const found = revisions?.find((each) => each.head === head.toLowerCase());
  const shown = revision(label, head);
  const who = found?.pusher ?? 'Someone';
  const when =
    found?.pushedAt.kind === 'exact' || found?.pushedAt.kind === 'by'
      ? ` ${ago(found.pushedAt.at, now)}`
      : '';
  return `${who} pushed ${shown}${when}`;
}

/**
 * The dialog when a newer push stopped it before approving: who pushed what, the revision you
 * reviewed, and nothing approved.
 */
export function newerSteps(
  from: string,
  to: string | undefined,
  revisions: readonly RevisionRow[] | undefined,
  label: Label,
  now: number,
): StepWords[] {
  return [
    {
      key: 'check',
      state: 'stopped',
      title: to === undefined ? 'A newer push arrived' : pushedWords(revisions, to, label, now),
      detail: `You reviewed ${revision(label, from)}.`,
    },
    { key: 'approve', state: 'skipped', title: 'Approve' },
    { key: 'ship', state: 'skipped', title: 'Merge' },
  ];
}

/** Whether approve and ship from `approval` sends an approval. */
export function approves(approval: ShipApproval): boolean {
  return approval.kind !== 'ownPullRequest' && approval.kind !== 'alreadyApproved';
}

/** A stopped step's title, as the dialog names where it stopped: "Can’t merge: conflicts". */
export function stopTitle(stop: ShipStop, base: string): string {
  switch (stop.kind) {
    case 'headMoved':
      return 'Someone pushed after the approval';
    case 'headUnknown':
      return 'GitHub didn’t say which commit it’s at';
    case 'blocked':
      return `Can’t merge: ${inTheWayOf(stop.blockers)}`;
    case 'noAutoMerge':
      return 'Can’t turn on auto-merge';
    case 'noPermission':
      return `Can’t merge into ${base}`;
    case 'noMethod':
      return 'No merge method is allowed';
    case 'incomplete':
      return 'GitHub left part of its answer out';
    case 'where':
      return 'Can’t merge it from here';
    default:
      stop satisfies never;
      return 'Stopped';
  }
}

/**
 * What the dialog's main button does once it ran: nothing while it runs or once it's done; "Done"
 * where it stopped, with "Merge panel" too after approving; "See r2 → r3" for a newer push; "Ask
 * GitHub again" for a merge Lo can't tell the end of.
 */
export type End =
  | { readonly kind: 'running' }
  | { readonly kind: 'done' }
  | { readonly kind: 'stopped'; readonly panel: boolean }
  | { readonly kind: 'newer'; readonly refusal: Refusal; readonly head: string }
  | { readonly kind: 'unsure'; readonly job: JobView };

/** What the dialog shows once it runs: its title, a line under it, and the steps as they stand. */
export interface Running {
  readonly title: string;
  readonly description: string;
  readonly steps: StepWords[];
  readonly end: End;
}

/** What tells who pushed a revision, and when: `revisions`, as of `now`. */
export interface Pushes {
  readonly label: Label;
  readonly revisions: readonly RevisionRow[] | undefined;
  readonly now: number;
}

/** The line under the dialog's title: the repository and the pull request, then `more`. */
function repoLine(plan: Pick<ShipPlan, 'repo' | 'number'>, more?: string): string {
  return `${plan.repo} #${plan.number}${more === undefined ? '' : ` · ${more}`}`;
}

/** The dialog for a newer push than the revision on screen, which stopped it before approving. */
export function newerShown(
  plan: Pick<ShipPlan, 'repo' | 'number'>,
  refusal: Refusal,
  head: string,
  pushes: Pushes,
): Running {
  const from = refusal.newer?.from ?? head;
  const to = refusal.newer?.to ?? undefined;
  return {
    title: 'A newer push arrived',
    description: repoLine(plan, 'nothing was approved'),
    steps: newerSteps(from, to, pushes.revisions, pushes.label, pushes.now),
    end: { kind: 'newer', refusal, head },
  };
}

/**
 * How approve and ship from `plan` stands, as main last said (`view`, nothing before it said), and
 * the merge it sent (`job`), if it sent one.
 */
export function runningOf(
  plan: ShipPlan,
  view: ShipView | undefined,
  job: JobView | undefined,
  pushes: Pushes,
): Running {
  const { label } = pushes;
  const approving = approves(plan.approval);
  const approved = view?.approved === true || plan.approval.kind === 'alreadyApproved';
  const title = approving ? `Approving and shipping #${plan.number}` : `Shipping #${plan.number}`;
  const check = checkStep(plan, label, 'done');
  const approval = (state: StepState) =>
    approveStep(plan.approval, plan.login, plan.head, plan.summary, label, state);
  const running: End = { kind: 'running' };
  const phase = view?.phase;
  switch (phase?.kind) {
    case undefined:
    case 'approving':
      return {
        title,
        description: repoLine(plan),
        steps: [check, approval(approving ? 'now' : 'todo'), shipStep(plan, plan.likely, 'todo')],
        end: running,
      };
    case 'reading':
      return {
        title,
        description: repoLine(plan),
        steps: [
          check,
          approval('done'),
          {
            ...shipStep(plan, plan.likely, 'now'),
            detail: approving ? 'Waiting for GitHub to show your approval.' : 'Reading it again.',
          },
        ],
        end: running,
      };
    case 'done':
      return {
        title,
        description: repoLine(plan),
        steps: [check, approval('done'), shipStep(plan, phase.step, 'done')],
        end: { kind: 'done' },
      };
    case 'sending':
      return sendingOf(plan, phase.step, job, approved, {
        title,
        steps: [check, approval('done')],
      });
    case 'stopped': {
      const { refusal, stop } = phase;
      if (phase.at === 'approve') {
        if (refusal.newer !== null) return newerShown(plan, refusal, plan.head, pushes);
        return {
          title: 'Not approved',
          description: repoLine(plan, 'nothing was approved'),
          steps: [
            check,
            { ...approval('stopped'), state: 'stopped', detail: refusal.text },
            { ...shipStep(plan, plan.likely, 'todo'), state: 'skipped', detail: undefined },
          ],
          end: { kind: 'stopped', panel: false },
        };
      }
      const planned = shipStep(plan, plan.likely, 'stopped');
      return {
        title: approved ? 'Approved, but not merged' : 'Not merged',
        description: repoLine(
          plan,
          approving && approved ? 'your approval stays' : 'nothing was merged',
        ),
        steps: [
          check,
          approval(approved ? 'done' : 'skipped'),
          {
            key: 'ship',
            state: 'stopped',
            title: stop === null ? planned.title : stopTitle(stop, plan.base),
            detail: stop === null ? refusal.text : stopWords(stop, plan.base),
          },
        ],
        end:
          refusal.newer === null
            ? { kind: 'stopped', panel: true }
            : { kind: 'newer', refusal, head: plan.head },
      };
    }
    default:
      phase satisfies never;
      return { title, description: repoLine(plan), steps: [], end: running };
  }
}

/** The run once its step after approving went through the merge jobs, as `job` says it goes. */
function sendingOf(
  plan: ShipPlan,
  step: ShipStep,
  job: JobView | undefined,
  approved: boolean,
  before: { title: string; steps: StepWords[] },
): Running {
  const going = shipStep(plan, step, 'now');
  const state = job?.state;
  const now = (detail: string): Running => ({
    title: before.title,
    description: repoLine(plan),
    steps: [...before.steps, { ...going, detail }],
    end: { kind: 'running' },
  });
  switch (state?.kind) {
    case undefined:
    case 'sending':
      return now('Sending');
    case 'pending':
      return now(pendingLine({ kind: job?.kind ?? 'merge' }));
    case 'refused': {
      if (state.refusal.kind === 'canMergeNow') {
        return now('GitHub can merge it now, so Lo reads it again and merges it instead.');
      }
      return {
        title: approved ? 'Approved, but not merged' : 'Not merged',
        description: repoLine(
          plan,
          approved && approves(plan.approval) ? 'your approval stays' : 'nothing was merged',
        ),
        steps: [
          ...before.steps,
          {
            ...going,
            state: 'stopped',
            detail: job ? outcomeDetail(job) : state.refusal.text,
          },
        ],
        end:
          state.refusal.newer === null
            ? { kind: 'stopped', panel: true }
            : { kind: 'newer', refusal: state.refusal, head: plan.head },
      };
    }
    case 'unknown':
      return {
        title: (job && outcomeTitle(job)) ?? before.title,
        description: repoLine(plan, approved ? 'your approval stays' : undefined),
        steps: [...before.steps, { ...going, detail: job ? outcomeDetail(job) : undefined }],
        end: job ? { kind: 'unsure', job } : { kind: 'running' },
      };
    case 'merged':
    case 'enqueued':
    case 'autoMergeOn':
    case 'autoMergeOff':
      return {
        title: before.title,
        description: repoLine(plan),
        steps: [...before.steps, { ...going, state: 'done' }],
        end: { kind: 'done' },
      };
    default:
      state satisfies never;
      return now('Sending');
  }
}

/**
 * What the toast says once approve and ship is done: "Approved and merged #4821 into main", or
 * without the approval, the merge's own words. With nothing more to send, what was there already.
 */
export function shipDoneLine(view: ShipView, job: JobView | undefined): string {
  const approved = view.approved && approves(view.approval);
  const line = job ? doneLine(job) : undefined;
  if (line !== undefined) {
    if (!approved) return line;
    return line.startsWith('#')
      ? `Approved #${view.number}. ${line}`
      : `Approved and ${line.charAt(0).toLowerCase()}${line.slice(1)}`;
  }
  const step = view.phase.kind === 'done' ? view.phase.step : undefined;
  const already =
    step?.kind === 'alreadyQueued'
      ? `#${view.number} is in the merge queue for ${view.base} already`
      : `Auto-merge is on for #${view.number} already`;
  return approved ? `Approved #${view.number}. ${already}` : already;
}

/** The banner the auto-merge watch shows on the pull request's tab, or the toast without one. */
export interface WatchedWords {
  readonly tone: 'danger' | 'warn';
  readonly title: string;
  readonly detail: string;
}

/** What the auto-merge watch says of `watched`, a push after your approval. */
export function watchedWords(
  watched: Watched,
  revisions: readonly RevisionRow[] | undefined,
  label: Label,
  now: number,
): WatchedWords {
  const pushed = pushedWords(revisions, watched.head, label, now);
  const approved = revision(label, watched.approved);
  const number = `#${watched.number}`;
  switch (watched.kind) {
    case 'turnedOff':
      return {
        tone: 'warn',
        title: `Lo turned off auto-merge: ${pushed} after you approved ${approved}.`,
        detail: `${number} would have merged with your approval. Review the push, then turn auto-merge on again from the merge panel.`,
      };
    case 'notTurnedOff':
      return {
        tone: 'danger',
        title: `Lo couldn’t turn off auto-merge for ${number}: ${pushed} after you approved ${approved}.`,
        detail: `${watched.why ?? 'GitHub didn’t take it.'} The push would merge with your approval. Turn auto-merge off from the merge panel.`,
      };
    case 'cantTell':
      return {
        tone: 'warn',
        title: `Lo can’t tell whether ${number} would merge ${pushed.charAt(0).toLowerCase()}${pushed.slice(1)} with your approval.`,
        detail:
          'GitHub left part of its answer out. Lo reads it again, and turns auto-merge off if it would.',
      };
    default:
      watched.kind satisfies never;
      return { tone: 'warn', title: 'Auto-merge', detail: '' };
  }
}
