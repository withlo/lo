// What a pull request's merge takes with it, once Lo knows where it sits: nothing, for one alone or
// a GitHub stack's bottom layer; the open layers below it in its GitHub stack, which GitHub merges
// with it, as GitHub's Stacks API names them, since what GitHub says wins over Lo's list; or, for a
// chain that isn't a GitHub stack, nothing until it is one, when stacks could make it one, and
// otherwise its bottom layer alone, with the layers on it moved onto the root once it has merged.
// Nothing here calls Electron or GitHub.

import { openLayers, type GithubStack, type StackLayer as LayerRead } from '@lo/github';
import { layerOf, mergeOneLayerAtATime, type MergeBottom } from '@lo/stacks';

import type { Forest } from '../../stacks/service.ts';
import type { Method, Placement, StackLayer, Together } from '../contract.ts';
import type { Where } from './where.ts';

/** What a merge takes with it, or why Lo doesn't merge it from here. */
export type Taking =
  /** Nothing: it merges by itself, alone or as a GitHub stack's bottom layer. */
  | { readonly kind: 'alone' }
  /**
   * The open layers of GitHub stack `stack` below it, bottom first, at the heads the Stacks API
   * gave, which GitHub merges with it; `above`, its open layers above, which GitHub moves onto the
   * base.
   */
  | {
      readonly kind: 'stack';
      readonly stack: number;
      readonly below: readonly StackLayer[];
      readonly above: readonly number[];
    }
  /** It's in a chain that stacks could make a GitHub stack, as `offer` says: that comes first. */
  | { readonly kind: 'convert'; readonly offer: string }
  /**
   * It's the bottom layer of a chain that can't be a GitHub stack, for `reasons`: it merges alone,
   * by `plan`, and the layers on it move onto the root once it has.
   */
  | { readonly kind: 'chain'; readonly plan: MergeBottom; readonly reasons: readonly string[] }
  /**
   * Lo doesn't merge it from here, for `why`; `again` when Lo is listing the open pull requests
   * again, or reading what decides its merge again, which may settle it; `readAgain` when what
   * decides its merge is older than what GitHub's Stacks API says, so Lo reads it again.
   */
  | {
      readonly kind: 'refused';
      readonly why: string;
      readonly again?: boolean;
      readonly readAgain?: boolean;
    };

/** What {@link takingOf} is worked out from. */
export interface TakingView {
  /** The pull request. */
  readonly number: number;
  /**
   * The branch it merges into, as what decides its merge says: its GitHub stack's base for a
   * stack's layer. A merge is planned on that branch's rules.
   */
  readonly base: string;
  /** Where it sits, as `where` says. */
  readonly where: Where;
  /** Its repository's stacks, as `where` had them. */
  readonly forest: Pick<Forest, 'stacks' | 'conversion'> | undefined;
  /**
   * GitHub's stacks holding it, as the Stacks API answers now: nothing when it answered 404, as in
   * a repository without the API. Asked only where it decides something, else `'unread'`.
   */
  readonly github: readonly GithubStack[] | undefined | 'unread';
  /** A pull request's title, as the open pull requests' list has it: empty when it isn't there. */
  readonly title: (number: number) => string;
  /** A layer's review and checks, as the stack's layers were last read: none before they were. */
  readonly state: (number: number) => Pick<StackLayer, 'review' | 'checks'>;
  /** The pull requests in a merge queue, as the stack's layers were last read. */
  readonly queued: readonly number[];
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/**
 * A layer's review decision and how its checks stand together, from the stack's layers as read:
 * none for one not read, or for a decision or state GitHub may add that Lo doesn't know.
 */
export function layerState(
  layer: Pick<LayerRead, 'reviewDecision' | 'statusCheckRollup'> | undefined,
): Pick<StackLayer, 'review' | 'checks'> {
  return { review: reviewOf(layer?.reviewDecision), checks: checksOf(layer?.statusCheckRollup) };
}

function reviewOf(decision: LayerRead['reviewDecision'] | undefined): StackLayer['review'] {
  switch (decision) {
    case 'APPROVED':
      return 'approved';
    case 'CHANGES_REQUESTED':
      return 'changesRequested';
    case 'REVIEW_REQUIRED':
      return 'reviewRequired';
    case null:
    case undefined:
      return null;
    default:
      decision satisfies never;
      return null;
  }
}

function checksOf(rollup: LayerRead['statusCheckRollup'] | undefined): StackLayer['checks'] {
  const state = rollup?.state;
  switch (state) {
    case 'SUCCESS':
      return 'passing';
    case 'PENDING':
    case 'EXPECTED':
      return 'running';
    case 'FAILURE':
    case 'ERROR':
      return 'failing';
    case undefined:
      return null;
    default:
      state satisfies never;
      return null;
  }
}

/** Whether `taking` needs GitHub's Stacks API read to be worked out, for {@link TakingView.github}. */
export function needsStacks(where: Where): boolean {
  return (where.kind === 'githubStack' && where.below.length > 0) || where.kind === 'chainBottom';
}

/** What the merge of the pull request `view` shows takes with it, or why Lo doesn't merge it here. */
export function takingOf(view: TakingView): Taking {
  const { number, where, forest } = view;
  switch (where.kind) {
    case 'alone':
      return { kind: 'alone' };
    case 'githubStack':
      return where.below.length === 0 ? { kind: 'alone' } : stackTaking(view, where.stack);
    case 'chainBottom':
      return chainTaking(view);
    case 'chainAbove': {
      // Nothing merges from here, so the Stacks API is taken to be there, as the stack's tree does.
      const conversion = forest?.conversion(number, { stacksApi: true, queued: view.queued });
      if (conversion?.kind === 'plan') return { kind: 'convert', offer: conversion.offer };
      return {
        kind: 'refused',
        why: `Merge #${where.bottom} first: it’s this chain’s bottom layer.`,
      };
    }
    case 'unknown':
      return { kind: 'refused', why: where.text, again: where.listAgain };
    default:
      where satisfies never;
      throw new Error(`a place Lo doesn't know: ${JSON.stringify(where)}`);
  }
}

/**
 * The layers of GitHub stack `stack` below `view`'s pull request, as the Stacks API names them now,
 * which win over the list's: GitHub merges what it holds.
 */
function stackTaking(view: TakingView, stack: number): Taking {
  const { number, github } = view;
  const changed = {
    kind: 'refused',
    why: `GitHub stack #${stack} changed since Lo listed it. Lo is listing the open pull requests again; merge once it has.`,
  } as const;
  if (github === 'unread') return changed;
  if (github === undefined) {
    return {
      kind: 'refused',
      why: `GitHub’s Stacks API didn’t answer for #${number}, so Lo can’t name the layers that would merge with it. Merge it on GitHub.`,
    };
  }
  const holding = github.find((found) =>
    openLayers(found).some((layer) => layer.number === number),
  );
  if (!holding) return changed;
  // Its bottom layer moved onto another branch since what decides the merge was read, which then
  // named this one's rules: they're read again.
  if (holding.base.ref !== view.base) {
    return {
      kind: 'refused',
      why: `GitHub stack #${holding.number} merges into ${holding.base.ref} now, not ${view.base}. Lo reads #${number} again; merge once it has.`,
      again: true,
      readAgain: true,
    };
  }
  const open = openLayers(holding);
  const at = open.findIndex((layer) => layer.number === number);
  const below = open.slice(0, at).map((layer) => ({
    number: layer.number,
    title: view.title(layer.number),
    head: layer.head.sha.toLowerCase(),
    ...view.state(layer.number),
  }));
  const above = open.slice(at + 1).map((layer) => layer.number);
  if (below.length === 0) return { kind: 'alone' };
  return { kind: 'stack', stack: holding.number, below, above };
}

/**
 * A chain's bottom layer: made a GitHub stack first, when stacks could make it one, or merged alone
 * by `mergeOneLayerAtATime`, unless it needs a rebase itself, which only its author can do.
 */
function chainTaking(view: TakingView): Taking {
  const { number, forest, github } = view;
  if (!forest)
    return { kind: 'refused', why: "Lo is still listing this repository's open pull requests." };
  if (github === 'unread') {
    return {
      kind: 'refused',
      why: `Lo hasn’t asked GitHub yet whether #${number} could be in a GitHub stack.`,
    };
  }
  const conversion = forest.conversion(number, {
    stacksApi: github !== undefined,
    queued: view.queued,
  });
  if (conversion.kind === 'plan') return { kind: 'convert', offer: conversion.offer };
  const plan = mergeOneLayerAtATime(forest.stacks, number);
  if (plan === undefined || 'refusal' in plan) {
    const why =
      conversion.words.length > 0 ? conversion.words.join(' ') : 'Lo can’t tell what sits on it.';
    return { kind: 'refused', why: `Lo can’t merge #${number} a layer at a time: ${why}` };
  }
  if (plan.pr !== number) {
    return { kind: 'refused', why: `Merge #${plan.pr} first: it’s this chain’s bottom layer.` };
  }
  if (layerOf(forest.stacks, number)?.needsRebase !== undefined) {
    return {
      kind: 'refused',
      why: `Change #${number}’s base to ${plan.into} on GitHub, then merge it here.`,
    };
  }
  return { kind: 'chain', plan, reasons: conversion.words };
}

/** What a plan names it takes with it, for what `taking` says goes. Nothing for one alone. */
export function togetherOf(taking: Taking): Together | null {
  switch (taking.kind) {
    case 'stack':
      return {
        kind: 'stack',
        stack: taking.stack,
        below: [...taking.below],
        above: [...taking.above],
      };
    case 'chain': {
      const { plan } = taking;
      const before = plan.retargetBefore;
      return {
        kind: 'chain',
        before: before === undefined ? null : { pr: before.pr, from: before.from, to: before.to },
        after: plan.retargetAfter.map((move) => ({ pr: move.pr, from: move.from, to: move.to })),
        needsRebase: [...plan.needsRebase],
      };
    }
    case 'alone':
    case 'convert':
    case 'refused':
      return null;
    default:
      taking satisfies never;
      throw new Error(`a merge Lo doesn't know: ${JSON.stringify(taking)}`);
  }
}

/**
 * `together` for a merge with `method`: the layers on a chain's bottom one carry its commits, which
 * a squash or a rebase leaves out of the root, so after one they need a rebase. A merge commit
 * lands them as they are, so they need none. Into a merge queue whose method the account may not
 * read (`null`), they may.
 */
export function withMethod(together: Together | null, method: Method | null): Together | null {
  if (together?.kind !== 'chain' || method !== 'MERGE') return together;
  return { ...together, needsRebase: [] };
}

/** Where the pull request sits, as the merge panel says it. */
export function placementOf(taking: Taking): Placement {
  switch (taking.kind) {
    case 'alone':
      return { kind: 'alone' };
    case 'stack':
      return {
        kind: 'stack',
        stack: taking.stack,
        below: taking.below.map((layer) => layer.number),
      };
    case 'convert':
      return { kind: 'convert', offer: taking.offer };
    case 'chain':
      return {
        kind: 'chain',
        into: taking.plan.into,
        above: [...taking.plan.needsRebase],
        reasons: [...taking.reasons],
      };
    case 'refused':
      return { kind: 'refused', why: taking.why, again: taking.again ?? false };
    default:
      taking satisfies never;
      throw new Error(`a merge Lo doesn't know: ${JSON.stringify(taking)}`);
  }
}

/** Why Lo doesn't merge a pull request that stacks could make a GitHub stack first. */
export function convertFirst(offer: string): string {
  return `${offer} Make this a GitHub stack, then merge it.`;
}

/**
 * The pull requests a merge with `together` names, its own `number` first: each takes its turn
 * among merge writes for as long as the merge holds it, and no conversion changes their base
 * branches meanwhile.
 */
export function namesOf(number: number, together: Together | null): number[] {
  const named = [number];
  if (together?.kind === 'stack') {
    named.push(...together.below.map((layer) => layer.number), ...together.above);
  }
  if (together?.kind === 'chain') {
    named.push(...together.after.map((move) => move.pr), ...together.needsRebase);
  }
  return [...new Set(named)];
}

/** A stack's layers above, to compare. */
function aboveOf(together: Together | null): string {
  return together?.kind === 'stack' ? together.above.join(',') : '';
}

/** A chain's base branch moves, to compare. */
function movesOf(together: Together | null): string {
  return together?.kind === 'chain'
    ? JSON.stringify([together.before, together.after, together.needsRebase])
    : '';
}

/**
 * What changed between what a confirmation named, `was`, and what goes now: in words, or nothing.
 */
export function togetherChanged(was: Together | null, now: Together | null): string | undefined {
  if (was === null && now === null) return undefined;
  if (was?.kind === 'stack' || now?.kind === 'stack') {
    const before = was?.kind === 'stack' ? was.below : [];
    const after = now?.kind === 'stack' ? now.below : [];
    const same =
      before.length === after.length &&
      before.every(
        (layer, index) =>
          layer.number === after[index]?.number && layer.head === after[index]?.head,
      );
    if (!same) return 'The layers that merge with it changed.';
    return aboveOf(was) === aboveOf(now) ? undefined : 'The layers above it changed.';
  }
  return movesOf(was) === movesOf(now) ? undefined : 'The base branches Lo moves changed.';
}
