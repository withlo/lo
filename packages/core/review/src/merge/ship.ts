/**
 * Approve and ship, `⌘⇧⏎` (`docs/design.md`, "Approve and ship" and "Acting on what you saw").
 *
 * It runs in two steps, so what it does after approving rests on GitHub's verdict, not Lo's
 * prediction:
 *
 * 1. {@link approveAndShip}, on the snapshot read right before it runs, refuses or returns a
 *    {@link Plan}: the head to approve, whether to approve it, and what Lo expects to happen next,
 *    which only words the confirmation.
 * 2. Once the approval lands, the caller reads the pull request again and calls
 *    {@link afterApproving} with that snapshot and the plan. It merges or joins the queue only when
 *    GitHub reports the pull request can merge. Otherwise it turns on auto-merge, or stops.
 */

import {
  incomplete,
  pickedMethod,
  pushNeedsNewApproval,
  type Incomplete,
  type MergeSnapshot,
  type Review,
} from '../merge.ts';
import type { ReviewRefusal } from '../pending.ts';
import { blockers, isWait, type Blocker } from './blockers.ts';
import type { MergeMethod, ReviewDecision, ReviewState } from './github.ts';
import {
  changesRequestedBy,
  latestReviews,
  missingApprovals,
  nothingMissing,
  sameLogin,
} from './reviews.ts';

/** Your pending review is recorded on another revision than the one on screen. */
export type OtherRevision = Extract<ReviewRefusal, { refusal: 'otherRevision' }>;

/** Approve and ship's first step: nothing, and why, or the plan its one confirmation lists. */
export type ApproveAndShip =
  /**
   * Nothing: the snapshot isn't complete (`incomplete`), so a field may read as GitHub's answer
   * when it isn't. Read again first, unless reading again can't help.
   */
  | { readonly kind: 'incomplete'; readonly incomplete: Incomplete }
  /**
   * Nothing: someone pushed since the revision on screen. Lo shows the new revision, with the
   * changes since the one you saw.
   */
  | { readonly kind: 'headMoved'; readonly onScreen: string; readonly head: string }
  /**
   * Nothing: GitHub's head or the head on screen is missing, so nothing would make GitHub check
   * that the approval and the merge act on what you saw.
   */
  | { readonly kind: 'headUnknown' }
  /** Nothing: it's merged. */
  | { readonly kind: 'merged' }
  /** Nothing: it's closed. */
  | { readonly kind: 'closed' }
  /**
   * Nothing: it's a draft. Its author hasn't said it's ready, so there's nothing to ship. Approving
   * a draft is left to `⌘⏎`.
   */
  | { readonly kind: 'draft' }
  /** Nothing: GitHub doesn't let you approve it, and it isn't yours. */
  | { readonly kind: 'cannotApprove' }
  /**
   * Nothing: your pending review is recorded on another revision than the one on screen. GitHub
   * takes no other review from you while it's pending, and submitting it as an approval would
   * approve code that isn't on screen. Submit it as a comment, or switch to its revision, first.
   */
  | { readonly kind: 'pendingReviewElsewhere'; readonly refusal: OtherRevision }
  /** Approve unless that's skipped, then call {@link afterApproving}. */
  | { readonly kind: 'plan'; readonly plan: Plan };

/** What approve and ship approves, and what Lo expects to happen next. */
export interface Plan {
  /**
   * The head on screen, which is GitHub's head too. Approving approves it. Merging, joining the
   * queue or turning on auto-merge expects it, so GitHub refuses if someone pushes in between, and
   * {@link afterApproving} stops if GitHub's head is no longer it.
   */
  readonly head: string;
  /** The first step. */
  readonly approval: Approval;
  /**
   * What Lo expects {@link afterApproving} to return, from the snapshot as it expects GitHub to
   * report it once you've approved. It only words the confirmation ({@link planWording}): GitHub
   * can still block the merge for a rule Lo can't see, and then approve and ship turns on
   * auto-merge instead of merging.
   */
  readonly likely: Ship;
  /**
   * Whether the confirmation warns that a push before it merges could merge without a new review.
   * GitHub keeps auto-merge on when someone with write access pushes, so it warns when the next
   * step may be auto-merge and the base branch's rules don't want a new approval after a push
   * (`pushNeedsNewApproval`). The next step may be auto-merge when it's likely, and also when a
   * merge is likely only because Lo expects GitHub to stop blocking once you've approved, and when
   * auto-merge is on already. It doesn't warn on your own pull request, which you don't approve.
   * While Lo runs, {@link afterPush} turns off the auto-merge approve and ship turned on when such
   * a push follows your approval, but never auto-merge someone else turned on, before or after, or
   * one turned on again with another method: the confirmation words the warning for which it is.
   */
  readonly staleApprovalWarning: boolean;
  /**
   * Whether a push after the approval would still count it: you approve, or approved already,
   * rather than it being your own pull request, and the base branch's rules keep approvals after a
   * push. Auto-merge on then could merge a push with your approval, so a question that didn't warn
   * of it (a likely merge or queue entry GitHub already allows) never turns into auto-merge
   * ({@link asAsked}).
   */
  readonly approvalOutlivesPush: boolean;
}

/**
 * What the confirmation says follows the approval, from the plan's `likely`, such as "will likely
 * merge" or "will likely wait for checks, with auto-merge on", and then the stale-approval warning
 * when there is one.
 */
export function planWording(plan: Plan): string {
  const next = nextStep(plan.likely);
  return plan.staleApprovalWarning
    ? `${next}. While auto-merge is on, a push could merge without a new review`
    : next;
}

function nextStep(likely: Ship): string {
  switch (likely.kind) {
    case 'merge':
      return 'will likely merge';
    case 'enqueue':
      return 'will likely join the merge queue';
    case 'autoMerge':
      return `will likely wait for ${waitsFor(likely.waitingOn)}, with auto-merge on`;
    case 'enqueueWhenReady':
      return `will likely wait for ${waitsFor(likely.waitingOn)}, then join the merge queue`;
    case 'autoMergeAlreadyOn':
      return likely.waitingOn.length === 0
        ? 'will likely merge: auto-merge is on'
        : `will likely wait for ${waitsFor(likely.waitingOn)}, with auto-merge on already`;
    case 'alreadyQueued':
      return 'is in the merge queue already';
    case 'stop':
      return `will likely stop: ${stopReason(likely.stop)}`;
    default:
      return likely satisfies never;
  }
}

function stopReason(stop: Stop): string {
  switch (stop.kind) {
    case 'headMoved':
      return 'someone pushed after the approval';
    case 'headUnknown':
      return "GitHub didn't report the head";
    case 'blocked':
      return "something waiting won't fix blocks it";
    case 'noAutoMerge':
      return "you can't turn on auto-merge";
    case 'noPermission':
      return "you can't merge into the base branch";
    case 'noMethod':
      return 'the repository allows no merge method';
    case 'incomplete':
      return stop.incomplete === 'readAgain'
        ? 'GitHub left part of its answer out'
        : 'Lo read only the first 1,000 checks';
    default:
      return stop satisfies never;
  }
}

/**
 * What waiting blockers wait for, as a list for the confirmation: "checks", "an approval and
 * checks".
 */
function waitsFor(waiting: readonly Blocker[]): string {
  const kinds: string[] = [];
  for (const blocker of waiting) {
    const kind = waitKind(blocker);
    if (kind !== undefined && !kinds.includes(kind)) kinds.push(kind);
  }
  const last = kinds.pop();
  if (last === undefined) return 'GitHub';
  return kinds.length === 0 ? last : `${kinds.join(', ')} and ${last}`;
}

function waitKind(blocker: Blocker): string | undefined {
  switch (blocker.kind) {
    case 'approvals':
      return blocker.more === 1 && blocker.codeOwners.length === 0 ? 'an approval' : 'approvals';
    case 'check':
      return blocker.check.state === 'awaitingApproval' ? "a deployment's approval" : 'checks';
    case 'rule':
      return 'other rules';
    case 'checkingMergeability':
      return 'GitHub to check mergeability';
    case 'merged':
    case 'closed':
    case 'draft':
    case 'conflicts':
    case 'outOfDate':
    case 'changesRequested':
    case 'notReported':
    case 'conversations':
    case 'unexplained':
      return undefined;
    default:
      return blocker satisfies never;
  }
}

/** Whether approve and ship approves. */
export type Approval =
  /** Approve the head on screen. */
  | { readonly kind: 'approve' }
  /**
   * Approve the head on screen again: your latest review of it was dismissed, such as by a
   * maintainer, so the confirmation says so.
   */
  | { readonly kind: 'reapproveDismissed' }
  /**
   * Approve the head on screen by submitting your pending review, which is recorded on it and
   * holds `comments` comments: GitHub takes no other review from you while it's pending. The
   * confirmation says the comments go with the approval.
   */
  | { readonly kind: 'submitPending'; readonly comments: number }
  /** Skip it: it's your pull request, which GitHub doesn't let you approve. */
  | { readonly kind: 'ownPullRequest' }
  /** Skip it: your latest review already approves the head on screen. */
  | { readonly kind: 'alreadyApproved' };

/** Whether `approval` submits an approval. */
export function approves(approval: Approval): boolean {
  switch (approval.kind) {
    case 'approve':
    case 'reapproveDismissed':
    case 'submitPending':
      return true;
    case 'ownPullRequest':
    case 'alreadyApproved':
      return false;
    default:
      return approval satisfies never;
  }
}

/** What approve and ship does after approving. */
export type Ship =
  /**
   * Merge it with this method. {@link afterApproving} returns it only when GitHub reports the pull
   * request can merge (`CLEAN`, `HAS_HOOKS` or `UNSTABLE`) and nothing Lo sees blocks it, so it
   * never relies on an admin's bypass.
   */
  | { readonly kind: 'merge'; readonly method: MergeMethod }
  /**
   * Add it to the base branch's merge queue, on the same terms as `merge`, or when GitHub reports
   * only that the head is behind the base (`BEHIND`), which the queue handles.
   */
  | { readonly kind: 'enqueue' }
  /**
   * Turn on auto-merge with this method, so GitHub merges it once what it's waiting on clears:
   * `waitingOn`, every blocker left, each one waiting clears. A `BLOCKED` can also hide a rule Lo
   * can't see, which auto-merge waits for too.
   *
   * If GitHub refuses because the pull request can merge already ("clean status" or "unstable
   * status"), read it again and call {@link afterApproving} again. Never merge on any other
   * refusal: for an admin, that merge could skip a rule.
   */
  | {
      readonly kind: 'autoMerge';
      readonly method: MergeMethod;
      readonly waitingOn: readonly Blocker[];
    }
  /**
   * Turn on auto-merge on a branch with a merge queue (GitHub's "Merge when ready"), so GitHub adds
   * it to the queue once `waitingOn` clears. It needs permission to add to the queue, as `enqueue`
   * does, and the repository's auto-merge setting too: GitHub refuses it without, "Auto merge is
   * not allowed for this repository". Refusals are handled as for `autoMerge`.
   */
  | { readonly kind: 'enqueueWhenReady'; readonly waitingOn: readonly Blocker[] }
  /**
   * Nothing: auto-merge is on already, so GitHub merges it, or adds it to the queue, once
   * `waitingOn` clears, or straight away when it's empty.
   */
  | { readonly kind: 'autoMergeAlreadyOn'; readonly waitingOn: readonly Blocker[] }
  /** Nothing: it's in the merge queue already. */
  | { readonly kind: 'alreadyQueued' }
  /** Stop, and show why. */
  | { readonly kind: 'stop'; readonly stop: Stop };

/** Why approve and ship stops. */
export type Stop =
  /** GitHub's head isn't the one approved: someone pushed after the approval. Lo shows the new revision. */
  | { readonly kind: 'headMoved'; readonly approved: string; readonly head: string }
  /** GitHub reported no head, so Lo can't tell that it's still the one approved. */
  | { readonly kind: 'headUnknown' }
  /**
   * Something waiting won't fix blocks it. These are every blocker, those waiting won't fix first,
   * as `blockers` orders them. With `autoMerge`, auto-merge is on, so GitHub merges it if they all
   * clear while it stays on.
   */
  | { readonly kind: 'blocked'; readonly blockers: readonly Blocker[]; readonly autoMerge: boolean }
  /**
   * Only things waiting will fix block it, but you can't turn on auto-merge: the repository doesn't
   * allow it, or you lack write access, or on a branch with a merge queue, you can't add to it or
   * the repository doesn't allow auto-merge. These are the blockers.
   */
  | { readonly kind: 'noAutoMerge'; readonly blockers: readonly Blocker[] }
  /** GitHub lets it merge, but you can't merge into the base branch. */
  | { readonly kind: 'noPermission' }
  /** The repository allows no merge method. */
  | { readonly kind: 'noMethod' }
  /**
   * The snapshot read after approving isn't complete (`incomplete`): read again, unless reading
   * again can't help.
   */
  | { readonly kind: 'incomplete'; readonly incomplete: Incomplete };

function stopped(stop: Stop): Ship {
  return { kind: 'stop', stop };
}

/**
 * Approve and ship's first step, from a snapshot read right before it runs.
 *
 * - It does nothing with a snapshot that isn't complete, as {@link afterApproving} and
 *   {@link afterPush} don't: a part GitHub left out could read as its answer, such as auto-merge
 *   reading as off.
 * - It does nothing to a merged or closed pull request, or to a draft. It does nothing when
 *   GitHub's head or the head on screen is missing, or GitHub's head isn't the head on screen, so
 *   it never approves what you didn't see. Heads are full commit SHAs, compared ignoring case.
 * - It approves the head on screen. It skips that on your own pull request, and when your latest
 *   review approves that head already. An approval of an older revision is given again, so GitHub
 *   records that you approved what you saw, and so is one of that head that was dismissed, which
 *   the plan says. When GitHub doesn't let you approve someone else's pull request, it does
 *   nothing.
 * - With a pending review, which GitHub allows one of and while which it takes no other review
 *   from you, it approves by submitting that review when it's recorded on the head on screen, and
 *   does nothing when it's recorded on another revision, or on a commit GitHub no longer has.
 * - The plan's `likely` is what {@link afterApproving} would return if GitHub reported what Lo
 *   expects once you've approved. It's only a prediction, for the confirmation's wording.
 */
export function approveAndShip(snapshot: MergeSnapshot): ApproveAndShip {
  const missing = incomplete(snapshot);
  if (missing !== undefined) return { kind: 'incomplete', incomplete: missing };
  if (snapshot.state === 'MERGED') return { kind: 'merged' };
  if (snapshot.state === 'CLOSED') return { kind: 'closed' };
  if (snapshot.draft || snapshot.mergeState === 'DRAFT') return { kind: 'draft' };
  const { head, headOnScreen, viewer } = snapshot;
  if (head === '' || headOnScreen === '') return { kind: 'headUnknown' };
  if (!sameCommit(head, headOnScreen)) return { kind: 'headMoved', onScreen: headOnScreen, head };

  const yours = latestReviews(snapshot).find((review) => sameLogin(review.author, viewer.login));
  const yoursOnScreen = (state: ReviewState): boolean =>
    yours !== undefined &&
    yours.state === state &&
    yours.commit !== undefined &&
    sameCommit(yours.commit, headOnScreen);
  const pending = snapshot.pendingReview;
  let approval: Approval;
  if (viewer.didAuthor) {
    approval = { kind: 'ownPullRequest' };
  } else if (yoursOnScreen('APPROVED')) {
    approval = { kind: 'alreadyApproved' };
  } else if (!viewer.canApprove) {
    return { kind: 'cannotApprove' };
  } else if (pending !== undefined) {
    const onScreen = pending.commit !== undefined && sameCommit(pending.commit, headOnScreen);
    if (!onScreen) {
      return {
        kind: 'pendingReviewElsewhere',
        refusal: { refusal: 'otherRevision', reviewOn: pending.commit },
      };
    }
    approval = { kind: 'submitPending', comments: pending.comments };
  } else if (yoursOnScreen('DISMISSED')) {
    approval = { kind: 'reapproveDismissed' };
  } else {
    approval = { kind: 'approve' };
  }

  const likely = ship(approves(approval) ? withYourApproval(snapshot) : snapshot);
  let mayAutoMerge: boolean;
  switch (likely.kind) {
    case 'autoMerge':
    case 'enqueueWhenReady':
    case 'autoMergeAlreadyOn':
      mayAutoMerge = true;
      break;
    case 'merge':
    case 'enqueue':
      mayAutoMerge = !githubLetsItMerge(snapshot);
      break;
    case 'alreadyQueued':
    case 'stop':
      mayAutoMerge = false;
      break;
    default:
      mayAutoMerge = likely satisfies never;
  }
  const approvalOutlivesPush =
    approval.kind !== 'ownPullRequest' && !pushNeedsNewApproval(snapshot.rules);
  return {
    kind: 'plan',
    plan: {
      head: headOnScreen,
      approval,
      likely,
      staleApprovalWarning: mayAutoMerge && approvalOutlivesPush,
      approvalOutlivesPush,
    },
  };
}

/**
 * Approve and ship's second step: what to do once approved, from the pull request read again after
 * the approval, in full. When the plan's approval skips approving, the snapshot
 * {@link approveAndShip} read will do.
 *
 * - It stops when the snapshot isn't complete.
 * - It stops if GitHub reports no head, or a head that isn't the plan's.
 * - It does nothing more when the pull request is in the queue already.
 * - It stops, with the blockers, when something waiting won't fix blocks the merge.
 * - It does nothing more when auto-merge is on.
 * - It merges with the preferred method, or joins the queue on a branch that requires one, only
 *   when GitHub reports the pull request can merge (`CLEAN`, `HAS_HOOKS` or `UNSTABLE`, or
 *   `BEHIND` on a queue branch) and nothing Lo sees blocks it. In those states GitHub's rules are
 *   met, so approve and ship never merges past a rule, even for an admin GitHub would let bypass
 *   one.
 * - Otherwise only things waiting will fix block it, and it turns on auto-merge, or merge when
 *   ready on a queue branch. When Lo's explanation of a `BLOCKED` is only partial, auto-merge waits
 *   for what it can't see too.
 */
export function afterApproving(snapshot: MergeSnapshot, plan: Plan): Ship {
  const missing = incomplete(snapshot);
  if (missing !== undefined) return stopped({ kind: 'incomplete', incomplete: missing });
  if (snapshot.head === '') return stopped({ kind: 'headUnknown' });
  if (!sameCommit(snapshot.head, plan.head)) {
    return stopped({ kind: 'headMoved', approved: plan.head, head: snapshot.head });
  }
  return ship(snapshot);
}

/**
 * Whether `now`, what {@link afterApproving} returned, is what the confirmation asked about with
 * `plan`, from its `likely`: the same step, or the one it becomes when GitHub's answer differs from
 * Lo's prediction, which the confirmation's "will likely" allows. A merge and auto-merge with the
 * same method are one ask, and so are joining the queue and merge when ready: each lands on the
 * same branch the same way, sooner or later. A step that does nothing more (auto-merge on already,
 * in the queue already, or a stop) always is.
 *
 * A merge or queue entry becomes auto-merge or merge when ready only when the confirmation warned
 * that a push could then merge with your approval (`staleApprovalWarning`), or when that can't
 * happen (`approvalOutlivesPush` is false): you confirmed only what it said.
 *
 * Anything else, such as a merge after a confirmation that predicted a stop and named no method,
 * or a merge with another method, isn't: approve and ship stops after approving and says what
 * GitHub now allows (`docs/design.md`, "Merging": every merge asks first, naming the method and the
 * target, and one confirmation lists exactly what will happen).
 */
export function asAsked(plan: Plan, now: Ship): boolean {
  const asked = plan.likely;
  const warned = plan.staleApprovalWarning || !plan.approvalOutlivesPush;
  switch (now.kind) {
    case 'autoMergeAlreadyOn':
    case 'alreadyQueued':
    case 'stop':
      return true;
    case 'merge':
      return (asked.kind === 'merge' || asked.kind === 'autoMerge') && asked.method === now.method;
    case 'autoMerge':
      if (asked.kind === 'autoMerge') return asked.method === now.method;
      return asked.kind === 'merge' && asked.method === now.method && warned;
    case 'enqueue':
      return asked.kind === 'enqueue' || asked.kind === 'enqueueWhenReady';
    case 'enqueueWhenReady':
      if (asked.kind === 'enqueueWhenReady') return true;
      return asked.kind === 'enqueue' && warned;
    default:
      return now satisfies never;
  }
}

/**
 * Whether `now` is auto-merge, or merge when ready, standing in for the merge or queue entry `plan`
 * asked about without warning that a push could then merge with your approval: the one swap
 * {@link asAsked} refuses for the warning alone.
 */
export function unwarnedAutoMerge(plan: Plan, now: Ship): boolean {
  const asked = plan.likely.kind;
  const swapped =
    (asked === 'merge' && now.kind === 'autoMerge') ||
    (asked === 'enqueue' && now.kind === 'enqueueWhenReady');
  return swapped && !asAsked(plan, now);
}

/**
 * Whether the snapshot shows your approval of `head`: your latest review approves it. GitHub can
 * still answer from before an approval landed for a moment after it, with your earlier review, so
 * approve and ship reads again while it doesn't.
 */
export function showsYourApproval(snapshot: MergeSnapshot, head: string): boolean {
  return latestReviews(snapshot).some(
    (review) =>
      sameLogin(review.author, snapshot.viewer.login) &&
      review.state === 'APPROVED' &&
      review.commit !== undefined &&
      sameCommit(review.commit, head),
  );
}

/**
 * Auto-merge that approve and ship turned on after you approved, or that it may have turned on
 * (its answer was lost, or never came), as Lo keeps it to watch for a push ({@link afterPush}).
 */
export interface ShippedAutoMerge {
  /**
   * The head you approved, which auto-merge was turned on to expect, or a later head your latest
   * review approves (`youApproved`).
   */
  readonly head: string;
  /**
   * Who turned it on: the account approve and ship ran as, with GitHub's spelling once it
   * answered.
   */
  readonly enabledBy: string;
  /** The method it was turned on with: as GitHub named it once it answered, or as Lo sent it. */
  readonly method: MergeMethod;
}

/**
 * What to do about a pull request on which approve and ship turned on auto-merge after you
 * approved ({@link ShippedAutoMerge}), from a snapshot read since.
 */
export type AfterPush =
  /**
   * Turn auto-merge off, and tell the user: `head` was pushed after they approved `approved`, and
   * it would merge with their approval.
   */
  | { readonly kind: 'turnOffAutoMerge'; readonly approved: string; readonly head: string }
  /**
   * `head` was pushed after `approved`, but GitHub left out part of what says whether it would
   * merge with the approval, so Lo can't tell. Tell the user, and read again: never `ended`, which
   * would leave on an auto-merge that should go.
   */
  | { readonly kind: 'cantTell'; readonly approved: string; readonly head: string }
  /** Nothing can be decided yet: GitHub left part of the snapshot out. Read again. */
  | { readonly kind: 'incomplete'; readonly incomplete: Incomplete }
  /** Nothing to do yet: keep watching. */
  | { readonly kind: 'watch' }
  /**
   * `head` was pushed since the head watched, and your latest review approves it: you looked at
   * the push and left auto-merge on, so it may merge `head`. Keep watching from `head`, for a push
   * after that approval.
   */
  | { readonly kind: 'youApproved'; readonly head: string }
  /** Nothing more to watch, and why. */
  | { readonly kind: 'ended'; readonly ended: Ended };

/** Why Lo stops watching auto-merge approve and ship turned on. */
export type Ended =
  | { readonly kind: 'merged' }
  | { readonly kind: 'closed' }
  /**
   * Auto-merge is off: someone turned it off, GitHub did (as when someone without write access
   * pushes), or it never came on. Auto-merge turned on again after a read that saw it off isn't
   * Lo's.
   */
  | { readonly kind: 'autoMergeOff' }
  /** Someone else, `login`, turned auto-merge on since: it isn't Lo's. */
  | { readonly kind: 'turnedOnBy'; readonly login: string }
  /**
   * Auto-merge's method isn't the one Lo turned it on with: someone turned it off and on again
   * since, with this method, as GitHub has no way to change it in place. It isn't Lo's.
   */
  | { readonly kind: 'otherMethod'; readonly method: MergeMethod }
  /**
   * `head` was pushed, and the base branch's rules want a new approval after a push
   * (`pushNeedsNewApproval`), so it won't merge with yours.
   */
  | { readonly kind: 'newApprovalNeeded'; readonly head: string };

function ended(why: Ended): AfterPush {
  return { kind: 'ended', ended: why };
}

/**
 * What to do when Lo reads a pull request on which approve and ship turned on auto-merge after you
 * approved, as `shipped` says.
 *
 * GitHub keeps auto-merge on when someone with write access pushes. Unless the base branch's rules
 * want a new approval after a push (`pushNeedsNewApproval`), the new head then merges with the
 * approvals already given, yours included. So when GitHub's head isn't the one you approved and
 * auto-merge is still on, Lo turns it off and says so.
 *
 * It watches only the auto-merge Lo turned on: watching ends once the pull request is merged or
 * closed, once auto-merge reads as off, once someone else has turned it on, and once it has another
 * method than the one Lo turned it on with. A push your latest review approves isn't turned off:
 * watching goes on from it (`youApproved`). What it can't see is an auto-merge turned off and on
 * again, as the same account and with the same method, between two of Lo's reads: the snapshot
 * doesn't say when auto-merge was turned on (GitHub's `enabledAt`), so that one still reads as
 * Lo's. It decides on the state, the head, auto-merge, your latest review and the rules, so checks
 * cut short don't stop it; a part GitHub left out does (`incomplete`, `cantTell`): it could read as
 * auto-merge off when it's on.
 */
export function afterPush(snapshot: MergeSnapshot, shipped: ShippedAutoMerge): AfterPush {
  const { head } = snapshot;
  const pushed = head !== '' && !sameCommit(head, shipped.head);
  const missing = incomplete(snapshot);
  // The checks don't decide it, so checks cut short alone don't stop it.
  const decides = !(missing === 'checksCutShort' && !snapshot.leftOut);
  if (missing !== undefined && decides) {
    if (pushed) return { kind: 'cantTell', approved: shipped.head, head };
    return { kind: 'incomplete', incomplete: missing };
  }
  if (snapshot.state === 'MERGED') return ended({ kind: 'merged' });
  if (snapshot.state === 'CLOSED') return ended({ kind: 'closed' });
  const { autoMerge } = snapshot;
  if (autoMerge === undefined) return ended({ kind: 'autoMergeOff' });
  if (autoMerge.enabledBy !== undefined && !sameLogin(autoMerge.enabledBy, shipped.enabledBy)) {
    return ended({ kind: 'turnedOnBy', login: autoMerge.enabledBy });
  }
  if (autoMerge.method !== shipped.method) {
    return ended({ kind: 'otherMethod', method: autoMerge.method });
  }
  if (!pushed) return { kind: 'watch' };
  if (pushNeedsNewApproval(snapshot.rules)) return ended({ kind: 'newApprovalNeeded', head });
  if (showsYourApproval(snapshot, head)) return { kind: 'youApproved', head };
  return { kind: 'turnOffAutoMerge', approved: shipped.head, head };
}

/** Whether two full commit SHAs name the same commit. Git writes them in lowercase, but nothing here depends on it. */
function sameCommit(a: string, b: string): boolean {
  return sameLogin(a, b);
}

/** What to do once approved, from the snapshot as GitHub reports it, or as Lo expects it to. */
function ship(snapshot: MergeSnapshot): Ship {
  if (snapshot.queue.inQueue) return { kind: 'alreadyQueued' };
  const found = blockers(snapshot);
  const autoMerge = snapshot.autoMerge !== undefined;
  if (found.some((blocker) => !isWait(blocker))) {
    return stopped({ kind: 'blocked', blockers: found, autoMerge });
  }
  if (autoMerge) return { kind: 'autoMergeAlreadyOn', waitingOn: found };
  const { viewer, queue } = snapshot;
  const method = pickedMethod(snapshot);
  if (found.length === 0 && githubLetsItMerge(snapshot)) {
    if (!viewer.canMerge) return stopped({ kind: 'noPermission' });
    if (queue.required) return { kind: 'enqueue' };
    return method === undefined ? stopped({ kind: 'noMethod' }) : { kind: 'merge', method };
  }
  if (queue.required && viewer.canMerge && viewer.canEnableAutoMerge) {
    return { kind: 'enqueueWhenReady', waitingOn: found };
  }
  if (!queue.required && viewer.canEnableAutoMerge) {
    return method === undefined
      ? stopped({ kind: 'noMethod' })
      : { kind: 'autoMerge', method, waitingOn: found };
  }
  return stopped({ kind: 'noAutoMerge', blockers: found });
}

/**
 * Whether GitHub reports the pull request can merge: the merge states `gh pr merge` also merges
 * on. In each, the base branch's rules are met, so merging never relies on an admin's bypass. On a
 * branch that requires a merge queue, `BEHIND` lets it join the queue too: GitHub reports it only
 * when nothing else blocks, and the queue tests each pull request on the latest base.
 */
function githubLetsItMerge(snapshot: MergeSnapshot): boolean {
  switch (snapshot.mergeState) {
    case 'CLEAN':
    case 'HAS_HOOKS':
    case 'UNSTABLE':
      return true;
    case 'BEHIND':
      return snapshot.queue.required;
    case 'BLOCKED':
    case 'DIRTY':
    case 'DRAFT':
    case 'UNKNOWN':
      return false;
    default:
      return snapshot.mergeState satisfies never;
  }
}

/**
 * The snapshot as Lo expects GitHub to report it after you approve the head on screen. It's only
 * for the plan's `likely`.
 *
 * - Your approval replaces your latest review, and GitHub drops the request for your review.
 * - It covers the code-owner requests for you and for your teams, when it counts.
 * - GitHub's review decision stands unless your approval is provably what changes it. Approved
 *   stays approved, and no decision stays none. Changes requested stays, unless you were the only
 *   one Lo sees requesting them. Then, as from review required, it's review required while
 *   approvals are missing, or while GitHub required a review Lo couldn't attribute, which Lo
 *   assumes your approval doesn't give; else approved.
 * - A `BLOCKED` merge state that the snapshot explained becomes `CLEAN`, so what still blocks the
 *   merge comes from the other fields. One it didn't explain stays.
 */
function withYourApproval(snapshot: MergeSnapshot): MergeSnapshot {
  const { viewer } = snapshot;
  const yours = (login: string) => sameLogin(login, viewer.login);
  const approval: Review = {
    author: viewer.login,
    state: 'APPROVED',
    commit: snapshot.headOnScreen,
    counts: viewer.approvalCounts,
    onBehalfOf: viewer.approvalCounts ? viewer.teams : [],
  };
  const approved: MergeSnapshot = {
    ...snapshot,
    reviews: [...snapshot.reviews.filter((review) => !yours(review.author)), approval],
    reviewRequests: snapshot.reviewRequests.filter(
      (request) => !(request.reviewer.kind === 'user' && yours(request.reviewer.login)),
    ),
  };

  const requesters = changesRequestedBy(snapshot);
  const onlyYouRequested = requesters.length > 0 && requesters.every(yours);
  const unattributed =
    snapshot.reviewDecision === 'REVIEW_REQUIRED' && nothingMissing(missingApprovals(snapshot));
  const required = (): ReviewDecision =>
    unattributed || !nothingMissing(missingApprovals(approved)) ? 'REVIEW_REQUIRED' : 'APPROVED';
  let reviewDecision: ReviewDecision | undefined;
  switch (snapshot.reviewDecision) {
    case undefined:
    case 'APPROVED':
      reviewDecision = snapshot.reviewDecision;
      break;
    case 'CHANGES_REQUESTED':
      reviewDecision = onlyYouRequested ? required() : 'CHANGES_REQUESTED';
      break;
    case 'REVIEW_REQUIRED':
      reviewDecision = required();
      break;
    default:
      reviewDecision = snapshot.reviewDecision satisfies never;
  }

  const unexplained = blockers(snapshot).some((blocker) => blocker.kind === 'unexplained');
  const mergeState =
    snapshot.mergeState === 'BLOCKED' && !unexplained ? 'CLEAN' : snapshot.mergeState;
  return { ...approved, reviewDecision, mergeState };
}
