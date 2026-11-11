/**
 * Plans "Make this a GitHub stack" (`docs/design.md`, "Turning chains into GitHub stacks"): the
 * base-branch changes and the Stacks API call that turn a chain of layers into a GitHub stack.
 *
 * A GitHub stack is a straight chain, so in a tree the plan converts one path: from the stack's
 * bottom layer up through the layer you're on, then on up while each layer has exactly one layer
 * on it. A fork in the tree ends the path.
 *
 * The plan is data: the steps say what to send GitHub, and running them is up to the caller.
 */

import type { ConversionStep } from '@lo/github';

import { layerOf, type Gap, type Retarget, type Stacks } from './stacks.ts';

/**
 * What "Make this a GitHub stack" will do. Show the steps in its confirmation, then run them in
 * order and stop at the first that fails; {@link rollback} says how to undo the ones that ran.
 */
export interface Plan {
  /** The root branch the stack sits on: the bottom layer's base branch once the plan has run. */
  readonly root: string;
  /** The pull requests it converts, bottom to top. */
  readonly path: readonly number[];
  /**
   * The steps, in the order to run them: every base-branch change, bottom layer first, then one
   * stack step, last.
   */
  readonly steps: readonly Step[];
}

/**
 * One request in a {@link Plan}, as `@lo/github`'s `runConversionStep` runs it: a base-branch
 * change, to the head branch of the layer below or to the root branch for the bottom layer, as each
 * layer of a GitHub stack must have; creating a GitHub stack from pull requests, bottom to top; or
 * adding them, bottom to top, to the top of an existing one.
 */
export type Step = ConversionStep;

/** What only the caller knows, beyond the stacks. */
export interface Facts {
  /**
   * Whether the repository has the Stacks API: false once `GET /repos/{owner}/{repo}/stacks` has
   * answered 404, as on a GitHub Enterprise Server without stacks. GitHub has no setting that turns
   * stacks on.
   */
  readonly stacksApi: boolean;
  /** The open pull requests in a merge queue: `isInMergeQueue`. */
  readonly queued: readonly number[];
}

/** Why "Make this a GitHub stack" isn't offered, in the order they're listed. */
export type Reason =
  /**
   * The reads the stacks were found from left something out (`gaps`), so a layer may sit on the
   * wrong pull request or branch. The only reason given when it applies.
   */
  | { readonly kind: 'incomplete'; readonly gaps: readonly Gap[] }
  /**
   * The pull request asked about isn't a layer: it isn't open, or wasn't passed to `findStacks`.
   * The only reason given when it applies.
   */
  | { readonly kind: 'notOpen' }
  /**
   * The path is already a GitHub stack, or part of one, so there's nothing to do. The only reason
   * given when it applies.
   */
  | { readonly kind: 'alreadyStacked'; readonly stack: number }
  /** The repository doesn't have the Stacks API. */
  | { readonly kind: 'noStacksApi' }
  /**
   * The path holds one pull request, and a stack needs two. On a bottom layer with several layers
   * on it, the tree forks right above it, so the path is that layer alone.
   */
  | { readonly kind: 'tooShort' }
  /**
   * The bottom of the path is already GitHub stack `stack`, but the stack goes on above `past` with
   * layers that aren't in the path. A stack takes new layers only at its top.
   *
   * Known limit: only open layers are seen. If the stack's top is a closed layer above `past`, the
   * Stacks API refuses the add, because the first layer added must sit on the stack's top.
   */
  | { readonly kind: 'stackGoesOn'; readonly stack: number; readonly past: number }
  /**
   * A pull request in the path comes from a fork. A GitHub stack holds only pull requests from the
   * repository itself.
   */
  | { readonly kind: 'fromFork'; readonly pr: number }
  /** A pull request in the path is in a merge queue, which is already merging it. */
  | { readonly kind: 'queued'; readonly pr: number }
  /**
   * A pull request in the path is based on `base`, a trunk other than the root, such as a protected
   * release branch, and Lo never moves a pull request off a trunk.
   */
  | { readonly kind: 'onTrunk'; readonly pr: number; readonly base: string }
  /**
   * A pull request in the path is already in GitHub stack `stack`, which doesn't hold the layers
   * below it. A pull request can be in only one stack.
   */
  | { readonly kind: 'inAnotherStack'; readonly pr: number; readonly stack: number };

/** A plan, or every reason there's none. */
export type Conversion =
  | { readonly kind: 'plan'; readonly plan: Plan }
  | { readonly kind: 'notOffered'; readonly reasons: readonly Reason[] };

function notOffered(reasons: readonly Reason[]): Conversion {
  return { kind: 'notOffered', reasons };
}

/**
 * Plans converting the path through `layer` into a GitHub stack. Each layer that isn't on the
 * branch the stack needs moves there first (its `retargetTo`), and then the stack is created.
 *
 * When the bottom of the path is already a GitHub stack, the rest of the path is added to it
 * instead, and only the layers added move. A GitHub stack's own layers keep their base branches,
 * even when a closed layer between them means `retargetTo` would move one: GitHub holds them as
 * they are.
 *
 * When it isn't offered, it lists every reason in the order {@link Reason} gives them, except that
 * those about one pull request are grouped, bottom to top.
 */
export function planConversion(stacks: Stacks, layer: number, facts: Facts): Conversion {
  if (stacks.gaps.length > 0) return notOffered([{ kind: 'incomplete', gaps: stacks.gaps }]);
  const through = pathThrough(stacks, layer);
  if (through === undefined) return notOffered([{ kind: 'notOpen' }]);
  const { root, path } = through;
  const { stack, stacked } = stackedBottom(stacks, path);
  if (stack !== undefined && stacked === path.length) {
    return notOffered([{ kind: 'alreadyStacked', stack }]);
  }
  const added = path.slice(stacked);

  const reasons: Reason[] = [];
  if (!facts.stacksApi) reasons.push({ kind: 'noStacksApi' });
  if (path.length < 2) reasons.push({ kind: 'tooShort' });
  const past = path[stacked - 1];
  if (stack !== undefined && past !== undefined && goesOn(stacks, stack, past, path)) {
    reasons.push({ kind: 'stackGoesOn', stack, past });
  }
  path.forEach((pr, index) => {
    const known = layerOf(stacks, pr);
    if (known && !known.headInBaseRepo) reasons.push({ kind: 'fromFork', pr });
    if (facts.queued.includes(pr)) reasons.push({ kind: 'queued', pr });
    if (known?.onTrunk && known.baseRef !== root) {
      reasons.push({ kind: 'onTrunk', pr, base: known.baseRef });
    }
    const entry = known?.nativeStack;
    if (entry && index >= stacked) {
      reasons.push({ kind: 'inAnotherStack', pr, stack: entry.stack });
    }
  });
  if (reasons.length > 0) return notOffered(reasons);

  const steps: Step[] = added.flatMap((pr) => {
    const change = retarget(stacks, pr);
    return change ? [{ kind: 'retarget', retarget: change }] : [];
  });
  steps.push(
    stack === undefined
      ? { kind: 'createStack', prs: added }
      : { kind: 'addToStack', stack, prs: added },
  );
  return { kind: 'plan', plan: { root, path, steps } };
}

/**
 * How to undo the steps of a {@link Plan} that ran before one failed (`docs/design.md`, "Stacks"
 * under "Errors and edge cases").
 */
export interface Rollback {
  /** The base-branch changes that put back the ones made, the last made first. */
  readonly steps: readonly Retarget[];
  /** The stack step, if it ran. Putting base branches back doesn't undo it. */
  readonly kept: Kept | undefined;
}

/** A stack step that ran, which rolling back leaves in place. */
export type Kept =
  /**
   * The stack was created from these pull requests. It can be unstacked:
   * `POST /repos/{owner}/{repo}/stacks/{number}/unstack`, with the number GitHub gave it when it
   * was created. Unstacking it, then putting the base branches back, undoes the whole plan.
   */
  | { readonly kind: 'created'; readonly prs: readonly number[] }
  /**
   * These pull requests were added to GitHub stack `stack`, and can't be taken out alone:
   * unstacking removes every open layer, those that were there before too.
   */
  | { readonly kind: 'added'; readonly stack: number; readonly prs: readonly number[] };

/**
 * Undoes the first `done` steps of `plan`: the ones that succeeded before a step failed. If it's
 * unclear whether a step went through, count it: putting back a base branch that never changed
 * changes nothing.
 */
export function rollback(plan: Plan, done: number): Rollback {
  const steps: Retarget[] = [];
  let kept: Kept | undefined;
  for (const step of plan.steps.slice(0, Math.max(0, done)).toReversed()) {
    switch (step.kind) {
      case 'retarget': {
        const { pr, from, to } = step.retarget;
        steps.push({ pr, from: to, to: from });
        break;
      }
      case 'createStack':
        kept = { kind: 'created', prs: step.prs };
        break;
      case 'addToStack':
        kept = { kind: 'added', stack: step.stack, prs: step.prs };
        break;
      default:
        step satisfies never;
    }
  }
  return { steps, kept };
}

/**
 * The path through `layer`, bottom to top, and the root branch it sits on. Nothing when `layer`
 * isn't a layer.
 */
function pathThrough(stacks: Stacks, layer: number): { root: string; path: number[] } | undefined {
  const below: number[] = [];
  let at = layerOf(stacks, layer);
  // `findStacks` broke every cycle, so both walks end.
  let root: string | undefined;
  while (at !== undefined && root === undefined) {
    below.push(at.number);
    if (at.parent.kind === 'branch') root = at.parent.branch;
    else at = layerOf(stacks, at.parent.number);
  }
  if (root === undefined) return undefined;
  const path = below.toReversed();
  at = layerOf(stacks, layer);
  for (let above = only(at?.children); above !== undefined; above = only(at?.children)) {
    path.push(above);
    at = layerOf(stacks, above);
    if (at === undefined) return undefined;
  }
  return { root, path };
}

/** The one number in `numbers`, if it holds exactly one. */
function only(numbers: readonly number[] | undefined): number | undefined {
  return numbers?.length === 1 ? numbers[0] : undefined;
}

/**
 * The GitHub stack the bottom layer of `path` is in, if any, and how many layers from the bottom up
 * are in it, at rising positions.
 */
function stackedBottom(
  stacks: Stacks,
  path: readonly number[],
): { stack: number | undefined; stacked: number } {
  const entry = (pr: number) => layerOf(stacks, pr)?.nativeStack;
  const bottom = path[0] === undefined ? undefined : entry(path[0]);
  if (!bottom) return { stack: undefined, stacked: 0 };
  let position = bottom.position;
  let stacked = 1;
  for (const pr of path.slice(1)) {
    const next = entry(pr);
    if (!next || next.stack !== bottom.stack || next.position <= position) break;
    position = next.position;
    stacked += 1;
  }
  return { stack: bottom.stack, stacked };
}

/** Whether GitHub stack `stack` has an open layer above `past` that isn't in `path`. */
function goesOn(stacks: Stacks, stack: number, past: number, path: readonly number[]): boolean {
  const top = layerOf(stacks, past)?.nativeStack;
  if (!top) return false;
  return Object.values(stacks.layers).some(
    (layer) =>
      layer.nativeStack?.stack === stack &&
      layer.nativeStack.position > top.position &&
      !path.includes(layer.number),
  );
}

/** The base-branch change `pr` needs to be a layer of the stack, if any. */
function retarget(stacks: Stacks, pr: number): Retarget | undefined {
  const layer = layerOf(stacks, pr);
  if (layer?.retargetTo === undefined) return undefined;
  return { pr, from: layer.baseRef, to: layer.retargetTo };
}
