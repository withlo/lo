// What `a` and `⌥⏎` do in the merge panel, decided from what GitHub said, as `@lo/review`'s
// `mergeAction` decides what `⏎` does. `a` turns auto-merge on when only waits stand in the way, or
// a block Lo can't explain, which may be one: GitHub then merges the pull request, or on a branch
// with a merge queue adds it to the queue, once they clear. With auto-merge on, `a` turns it off.
// `⌥⏎` merges past the base branch's rules, for an account GitHub lets bypass them, when they're
// what's in the way: not a draft, nor conflicts, which no rule makes. Either is a merge's write, so
// it goes where a merge does: alone, or from a GitHub stack's bottom layer, never with layers below
// it, which its write can't name. Nothing here calls Electron or GitHub.

import {
  blockers,
  isWait,
  pickedMethod,
  pushNeedsNewApproval,
  type MergeSnapshot,
} from '@lo/review';

import type { AfterPush, AutoAction, OverrideAction } from '../contract.ts';
import type { Where } from './where.ts';

/** Why `a` can't do anything now, as its action. */
function noAuto(reason: Extract<AutoAction, { kind: 'notPossible' }>['reason']): AutoAction {
  return { kind: 'notPossible', reason };
}

/** Why `⌥⏎` can't merge past the rules now, as its action. */
function noOverride(
  reason: Extract<OverrideAction, { kind: 'notPossible' }>['reason'],
): OverrideAction {
  return { kind: 'notPossible', reason };
}

/** What `a` does now with the pull request `snapshot` holds. */
export function autoActionOf(snapshot: MergeSnapshot): AutoAction {
  const no = noAuto;
  if (snapshot.state === 'MERGED') return no('merged');
  if (snapshot.state === 'CLOSED') return no('closed');
  if (snapshot.queue.inQueue) return no('queued');
  const { viewer } = snapshot;
  // GitHub says whether the account may turn it off only while it's on.
  if (snapshot.autoMerge !== undefined) {
    return viewer.canDisableAutoMerge ? { kind: 'off' } : no('cantTurnOff');
  }
  const found = blockers(snapshot);
  if (found.length === 0) return no('ready');
  // A block Lo can't explain may be a wait it can't see, which auto-merge waits for too.
  if (!found.every((blocker) => isWait(blocker) || blocker.kind === 'unexplained')) {
    return no('blocked');
  }
  // Joining the queue takes what adding to it does.
  if (snapshot.queue.required && !viewer.canMerge) return no('noPermission');
  // GitHub says no when the repository doesn't allow auto-merge, or the account can't merge.
  if (!viewer.canEnableAutoMerge) return no('notAllowed');
  if (!snapshot.queue.required && pickedMethod(snapshot) === undefined) return no('noMethod');
  return { kind: 'on' };
}

/** Whether `⌥⏎` merges the pull request `snapshot` holds past its base branch's rules now. */
export function overrideActionOf(snapshot: MergeSnapshot): OverrideAction {
  const no = noOverride;
  if (snapshot.state === 'MERGED') return no('merged');
  if (snapshot.state === 'CLOSED') return no('closed');
  if (snapshot.queue.inQueue) return no('queued');
  const found = blockers(snapshot);
  if (found.length === 0) return no('nothingToSkip');
  if (!snapshot.viewer.canMergeAsAdmin) return no('noPermission');
  // Neither is a rule: GitHub merges neither past its rules.
  if (found.some((blocker) => blocker.kind === 'draft')) return no('draft');
  if (found.some((blocker) => blocker.kind === 'conflicts')) return no('conflicts');
  if (pickedMethod(snapshot) === undefined) return no('noMethod');
  return { kind: 'override' };
}

/** What a push before it merges does to the approvals, as the base branch's rules say. */
export function afterPushOf(snapshot: MergeSnapshot): AfterPush {
  const { rules } = snapshot;
  if (rules.requiredApprovals === 0 && !rules.codeOwnerReview) return 'noReview';
  return pushNeedsNewApproval(rules) ? 'newApproval' : 'keepsApprovals';
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/**
 * Why auto-merge, or a merge past the rules (`override`), doesn't go for pull request `number`
 * where `placed` says it sits: anywhere but alone or a GitHub stack's bottom layer. Nothing where it
 * does. Neither write can name a stack's layers below, which would merge with it, and a chain's
 * layers above its bottom one would be left on the branch that merged.
 */
export function aloneOrBottom(
  placed: Where,
  number: number,
  override: boolean,
): string | undefined {
  switch (placed.kind) {
    case 'alone':
      return undefined;
    case 'githubStack': {
      const [bottom] = placed.below;
      if (bottom === undefined) return undefined;
      return override
        ? `GitHub merges past the rules only a stack’s bottom layer, and ${numbers(placed.below)} ${placed.below.length === 1 ? 'is' : 'are'} below #${number} in GitHub stack #${placed.stack}.`
        : `${numbers(placed.below)}, below #${number} in GitHub stack #${placed.stack}, would merge with it when auto-merge merges it. Merge #${bottom} first.`;
    }
    case 'chainBottom':
      return `#${number} is the bottom layer of a chain that isn’t a GitHub stack: once it merged, the layers above would still sit on its branch.`;
    case 'chainAbove':
      return `Merge #${placed.bottom} first: it’s this chain’s bottom layer.`;
    case 'unknown':
      return placed.text;
    default:
      placed satisfies never;
      throw new Error(`a place Lo doesn't know: ${JSON.stringify(placed)}`);
  }
}
