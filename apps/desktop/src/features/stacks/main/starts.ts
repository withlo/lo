// Where the diff of the layer on screen starts, as the stacks feature works it out from its
// repository's stacks: with the layer below it, for a layer whose own changes start there rather
// than at its base branch. It's set before the layer's diff is first drawn, and once the diff is
// drawn a new start is only offered, in a banner, so nothing moves under the reader. Nothing here
// calls Electron.

import { openPullRequest, type OpenPullRequestList } from '@lo/github';
import { layerStart, type LayerStart, type PullRequest, type Stacks } from '@lo/stacks';

import type { Note, Offer } from '../contract.ts';

/** A layer on screen, as where its diff starts is worked out for it. */
export interface StartView {
  /** Its pull request. */
  readonly number: number;
  /** The head on screen, once known. */
  readonly head: string | undefined;
  /** The commit its diff starts from now, unless it starts at its base branch. */
  readonly compareFrom: string | undefined;
  /** Whether its diff has been drawn since it was last told where to start. */
  readonly drawn: boolean;
  /** Whether its local copy couldn't get `compareFrom`, so its diff starts at its base branch. */
  readonly missing: boolean;
}

/** A repository's stacks, and what they were found among. */
export interface StartForest {
  readonly stacks: Stacks;
  /** The pull requests they were found among, as `@lo/stacks` takes them. */
  readonly prs: readonly PullRequest[];
  /** The open pull requests, as listed. */
  readonly list: OpenPullRequestList;
}

/** What to do about where a layer's diff starts. */
export interface StartPlan {
  /** Where its stack says its own changes start, when that's known for the head on screen. */
  readonly start: LayerStart | undefined;
  /**
   * The commit to start its diff from now, before it's drawn: `null` for its base branch, or
   * nothing to leave it as it is.
   */
  readonly set: string | null | undefined;
  /** A start that came after its diff was drawn, offered in a banner. */
  readonly offer: Offer | undefined;
  /** Why its diff doesn't start where its stack says. */
  readonly note: Note | undefined;
}

/**
 * Where the diff of `view` starts, from `forest`, its repository's stacks: `@lo/stacks`' `layerStart`
 * for its head, when that's the head on screen, so the start is never another head's. While the
 * diff isn't drawn the start is set; once it's drawn a different one is offered. A start that
 * isn't known for the head on screen, as when the open pull requests were listed before a push, is
 * taken back while nothing is drawn, and else left. `kept` is the start set last, which names the
 * layer it was set for.
 */
export function planStart(
  view: StartView,
  forest: StartForest | undefined,
  kept: LayerStart | undefined,
): StartPlan {
  const start = forest && startOf(view, forest);
  const none = { start, set: undefined, offer: undefined, note: undefined };
  if (!forest || !start) {
    return !view.drawn && view.compareFrom !== undefined ? { ...none, set: null } : none;
  }
  const commit = start.kind === 'baseBranch' ? undefined : start.commit;
  if (commit === view.compareFrom) {
    return view.missing ? { ...none, note: missingNote(view, start) } : none;
  }
  if (!view.drawn) return { ...none, set: commit ?? null };
  return { ...none, offer: offerOf(view, start, kept, forest.prs) };
}

/** Where `view`'s own changes start, if its head on screen is the one its stack was found with. */
function startOf(view: StartView, { stacks, prs, list }: StartForest): LayerStart | undefined {
  const listed = openPullRequest(list, view.number);
  if (view.head === undefined || listed?.headRefOid !== view.head) return undefined;
  return layerStart(stacks, prs, view.number);
}

/** The banner that offers `start` for `view`, whose diff starts elsewhere. */
function offerOf(
  view: StartView,
  start: LayerStart,
  kept: LayerStart | undefined,
  prs: readonly PullRequest[],
): Offer {
  const layer = `#${view.number}`;
  // Compared with another layer's commit already, it's now on this one.
  if (start.kind !== 'baseBranch' && view.compareFrom !== undefined) {
    const below = start.kind === 'sharedCommits' ? start.below : start.merged;
    return {
      title: `${layer} now sits on #${below}.`,
      action: `Compare with #${below}`,
      commit: start.commit,
    };
  }
  switch (start.kind) {
    case 'sharedCommits':
      return {
        title: `${layer}'s diff includes #${start.below}'s changes.`,
        action: `Show only ${layer}'s`,
        commit: start.commit,
      };
    case 'needsRebase':
      return {
        title: `${layer}'s diff includes #${start.merged}'s, which was squash-merged.`,
        action: 'Hide them',
        commit: start.commit,
      };
    case 'baseBranch': {
      const below =
        view.compareFrom === undefined ? undefined : sittingOn(view.compareFrom, kept, prs);
      return {
        title:
          below === undefined
            ? `${layer} no longer sits on the layer it's compared with.`
            : `${layer} no longer sits on #${below}.`,
        action: `Compare with ${start.branch}`,
        commit: null,
      };
    }
    default:
      start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(start)}.`);
  }
}

/**
 * The pull request a layer compared with `commit` sat on: the one the start set last names, else
 * the open one whose head it is, else one that lists it.
 */
function sittingOn(
  commit: string,
  kept: LayerStart | undefined,
  prs: readonly PullRequest[],
): number | undefined {
  if (kept && kept.kind !== 'baseBranch' && kept.commit === commit) {
    return kept.kind === 'sharedCommits' ? kept.below : kept.merged;
  }
  const open = prs.filter((pr) => pr.state.kind === 'open');
  return (
    open.find((pr) => pr.headOid === commit)?.number ??
    prs.find((pr) => pr.headOid === commit || pr.commits.includes(commit))?.number
  );
}

/** What the stack says when the local copy couldn't get the commit `view` is compared with. */
function missingNote(view: StartView, start: LayerStart): Note | undefined {
  const layer = `#${view.number}`;
  switch (start.kind) {
    case 'sharedCommits':
      return {
        kind: 'start',
        text: `Lo couldn't fetch #${start.below}'s head, so ${layer}'s diff includes #${start.below}'s changes.`,
      };
    case 'needsRebase':
      return {
        kind: 'start',
        text: `Lo couldn't fetch #${start.merged}'s last commit, so ${layer}'s diff includes #${start.merged}'s changes.`,
      };
    case 'baseBranch':
      return undefined;
    default:
      start satisfies never;
      throw new Error(`A start Lo doesn't know: ${JSON.stringify(start)}.`);
  }
}
