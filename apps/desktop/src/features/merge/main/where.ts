// Where a pull request sits before it merges: alone, a GitHub stack's layer, or a chain's bottom
// layer or a layer above it, from its repository's stacks as the stacks feature has them. Lo merges
// a pull request only once it knows, and it knows only while the list of open pull requests the
// stacks were found among is recent, holds every open pull request, and holds this one where
// GitHub's latest merge facts put it: the stacks are listed less often than the facts are read. A
// pull request opened since the list, from the branch this one merges into, would sit below it, so
// that branch is asked about afresh. Nothing here calls Electron or GitHub.

import { MAX_OPEN_PULL_REQUESTS, type MergeFacts } from '@lo/github';
import { layerOf, stackOf, type Layer, type Stacks } from '@lo/stacks';

import type { Forest } from '../../stacks/service.ts';

/** How much longer than the time between lists the stacks' list may go unconfirmed: a minute. */
export const LIST_SLACK = 60_000;

/** Where GitHub's merge facts put a pull request. */
export interface Placed {
  /** The branch it merges into: the facts' `pullRequest.base`. */
  readonly base: string;
  /**
   * The GitHub stack it's a layer of, if it's in one, and its place there from 1 at the bottom:
   * the facts' `stack.number` and `stack.position`.
   */
  readonly stack: { readonly number: number; readonly position: number } | undefined;
}

/** Where `facts` put their pull request. */
export function placedBy(facts: MergeFacts): Placed {
  const { stack } = facts;
  return {
    base: facts.pullRequest.base,
    stack: stack && { number: stack.number, position: stack.position },
  };
}

/** An open pull request whose head branch is a given branch, as GitHub gives it. */
export interface FromBranch {
  readonly number: number;
  /** `isCrossRepository`: whether its head branch is a fork's, which is never a base branch. */
  readonly isCrossRepository: boolean;
}

/** What {@link where} is worked out from. */
export interface WhereView {
  /** The pull request on screen. */
  readonly number: number;
  /** Where GitHub's latest merge facts put it ({@link placedBy}). */
  readonly facts: Placed;
  /**
   * Its repository's stacks, as the stacks feature has them for the account the view acts as, or
   * nothing until they're known.
   */
  readonly forest:
    Pick<Forest, 'stacks' | 'trunks' | 'listedAt' | 'listEvery' | 'whole'> | undefined;
  /**
   * The open pull requests whose head branch is the one it merges into, read from GitHub when
   * it's to merge, so one opened since the list was read isn't missed: nothing until they're read.
   * Not needed when it merges into a trunk, which no pull request sits on a layer below.
   */
  readonly openFromBase: readonly FromBranch[] | undefined;
  /** The time, in milliseconds since the Unix epoch. */
  readonly now: number;
}

/** Where a pull request sits, or why Lo can't tell. */
export type Where =
  /** It sits on its own base branch, with no layer on it, in no GitHub stack. */
  | { readonly kind: 'alone' }
  /**
   * A layer of GitHub stack `stack`, whose bottom layer sits on its own base branch. `below` are
   * the stack's open layers below it, bottom first: none for its bottom layer.
   */
  | { readonly kind: 'githubStack'; readonly stack: number; readonly below: readonly number[] }
  /**
   * The bottom layer of a chain: in no GitHub stack, with layers on it, or on a layer that merged,
   * so it isn't based on its root branch or still carries the merged layer's commits. A GitHub
   * stack's bottom layer is one only in the second case.
   */
  | { readonly kind: 'chainBottom' }
  /**
   * A layer above the bottom layer of its chain, `bottom`, which merges first: in no GitHub stack
   * and on another layer, or in a GitHub stack that sits on another pull request or a merged one.
   */
  | { readonly kind: 'chainAbove'; readonly bottom: number }
  /**
   * Lo can't tell, for the reason `why`, which `text` says. `listAgain` says whether listing the
   * repository's open pull requests again may settle it, as the text says Lo does. Branch names in
   * `text` are GitHub's text.
   */
  | {
      readonly kind: 'unknown';
      readonly why: Unsure;
      readonly text: string;
      readonly listAgain: boolean;
    };

/** Why Lo can't tell where a pull request sits. */
export type Unsure =
  /** The stacks aren't known yet: the open pull requests or the rulesets haven't been read. */
  | { readonly kind: 'unread' }
  /**
   * The repository has more open pull requests than Lo lists, so a layer below this one may be
   * among those left out. Nothing settles it.
   */
  | { readonly kind: 'tooMany' }
  /**
   * The list was last confirmed at `listedAt`, longer ago than the time between lists and
   * {@link LIST_SLACK}.
   */
  | { readonly kind: 'stale'; readonly listedAt: number }
  /** The list doesn't hold the pull request, as when it opened after the list was read. */
  | { readonly kind: 'missing' }
  /** The list has it elsewhere than the merge facts do: as `listed` says. */
  | { readonly kind: 'moved'; readonly listed: Placed }
  /**
   * The pull requests `prs`, among them this one or one its stack holds, sit on each other in a
   * loop, so where it sits depends on which link Lo drops. Listing again doesn't change that.
   */
  | { readonly kind: 'cycle'; readonly prs: readonly number[] }
  /**
   * Some merged pull requests weren't looked up, and its stack sits on a branch that isn't a
   * trunk, which may be a merged pull request's: a layer it sits on or under may be missing.
   */
  | { readonly kind: 'lookups' }
  /**
   * It merges into `base`, which isn't a trunk, and the open pull requests from `base` haven't been
   * read since it was asked to merge ({@link WhereView.openFromBase}).
   */
  | { readonly kind: 'unconfirmed'; readonly base: string }
  /** Pull request `pr` comes from `base`, the branch it merges into, but isn't in the list. */
  | { readonly kind: 'unlistedBelow'; readonly pr: number; readonly base: string };

/** Where the pull request `view` shows sits, or why Lo can't tell. */
export function where(view: WhereView): Where {
  const { number, facts, forest, now } = view;
  if (!forest) return unknown({ kind: 'unread' }, view);
  // Nothing settles a list cut short, so this goes first.
  if (!forest.whole) return unknown({ kind: 'tooMany' }, view);
  if (now - forest.listedAt > forest.listEvery + LIST_SLACK) {
    return unknown({ kind: 'stale', listedAt: forest.listedAt }, view);
  }
  const { stacks, trunks } = forest;
  const layer = layerOf(stacks, number);
  const stack = stackOf(stacks, number);
  if (!layer || !stack) return unknown({ kind: 'missing' }, view);
  const listed: Placed = {
    base: layer.baseRef,
    stack: layer.nativeStack && {
      number: layer.nativeStack.stack,
      position: layer.nativeStack.position,
    },
  };
  if (!samePlace(listed, facts)) return unknown({ kind: 'moved', listed }, view);
  const cycle = stacks.cycles.find((each) => each.prs.some((pr) => stack.layers.includes(pr)));
  if (cycle) return unknown({ kind: 'cycle', prs: cycle.prs }, view);
  const unlooked = stacks.gaps.some((gap) => gap.kind === 'mergedPullRequests');
  if (unlooked && !trunks.includes(stack.root)) return unknown({ kind: 'lookups' }, view);
  if (!trunks.includes(layer.baseRef)) {
    const below = belowRead(view, stacks, layer, stack.layers);
    if (below) return below;
  }
  return placed(stacks, layer);
}

/**
 * What the open pull requests read from `layer`'s base branch say, when that isn't what the list
 * says: that one opened since sits below it, or that they weren't read. Nothing when they agree.
 */
function belowRead(
  view: WhereView,
  stacks: Stacks,
  layer: Layer,
  stack: readonly number[],
): Where | undefined {
  const base = layer.baseRef;
  if (!view.openFromBase) return unknown({ kind: 'unconfirmed', base }, view);
  const from = view.openFromBase
    .filter((pr) => !pr.isCrossRepository && pr.number !== layer.number)
    .map((pr) => pr.number)
    .toSorted((a, b) => b - a);
  const unlisted = from.find((pr) => !layerOf(stacks, pr));
  if (unlisted !== undefined) return unknown({ kind: 'unlistedBelow', pr: unlisted, base }, view);
  // The list sits it on another pull request already, which the base branch's may be.
  const [newest] = from;
  if (newest === undefined || layer.parent.kind === 'pr') return undefined;
  // It sits on the newest, as finding stacks would put it, and as far down as the list goes.
  if (stack.includes(newest)) return unknown({ kind: 'cycle', prs: [layer.number, newest] }, view);
  return { kind: 'chainAbove', bottom: stackOf(stacks, newest)?.layers[0] ?? newest };
}

/** Whether `a` and `b` put a pull request in the same place. */
function samePlace(a: Placed, b: Placed): boolean {
  if (a.base !== b.base) return false;
  if (a.stack === undefined || b.stack === undefined) return a.stack === b.stack;
  return a.stack.number === b.stack.number && a.stack.position === b.stack.position;
}

/** Where `layer` sits among `stacks`, which Lo can be sure of. */
function placed(stacks: Stacks, layer: Layer): Where {
  const entry = layer.nativeStack;
  if (entry) {
    // GitHub's stack, as the open layers say it: a closed layer between them doesn't split it.
    const below = Object.values(stacks.layers)
      .filter(
        (other) =>
          other.nativeStack?.stack === entry.stack && other.nativeStack.position < entry.position,
      )
      .toSorted((a, b) => (a.nativeStack?.position ?? 0) - (b.nativeStack?.position ?? 0))
      .map((other) => other.number);
    const bottom = layerOf(stacks, below[0] ?? layer.number) ?? layer;
    if (onItsBase(bottom)) return { kind: 'githubStack', stack: entry.stack, below };
    // The GitHub stack sits on another pull request, or on a merged one's branch.
    return inChain(stacks, layer, bottom);
  }
  if (stackOf(stacks, layer.number)?.layers.length === 1 && onItsBase(layer)) {
    return { kind: 'alone' };
  }
  return inChain(stacks, layer, layer);
}

/**
 * Whether `layer` sits on a root branch that is its own base branch, carrying no commits of a
 * merged layer below: not on another pull request, nor where a merged one sat.
 */
function onItsBase(layer: Layer): boolean {
  return (
    layer.parent.kind === 'branch' &&
    layer.parent.branch === layer.baseRef &&
    layer.needsRebase === undefined
  );
}

/** Where `layer` sits in the chain that `from`, it or a layer below it, is in. */
function inChain(stacks: Stacks, layer: Layer, from: Layer): Where {
  // The walk starts at the bottom layer.
  const bottom = stackOf(stacks, from.number)?.layers[0] ?? from.number;
  return bottom === layer.number ? { kind: 'chainBottom' } : { kind: 'chainAbove', bottom };
}

/** Lo can't tell where the pull request `view` shows sits, for the reason `why`. */
function unknown(why: Unsure, view: WhereView): Where {
  return { kind: 'unknown', why, text: unsureText(why, view), listAgain: settlesByListing(why) };
}

/** Whether listing the repository's open pull requests again may settle `why`. */
function settlesByListing(why: Unsure): boolean {
  switch (why.kind) {
    case 'stale':
    case 'missing':
    case 'moved':
    case 'lookups':
    case 'unlistedBelow':
      return true;
    // Still being listed; nothing settles it; a loop stays one; it waits for its own read.
    case 'unread':
    case 'tooMany':
    case 'cycle':
    case 'unconfirmed':
      return false;
    default:
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** Why Lo can't tell where the pull request `view` shows sits, as the merge panel says it. */
function unsureText(why: Unsure, { number, facts, now }: WhereView): string {
  const again = 'Lo is listing the open pull requests again.';
  switch (why.kind) {
    case 'unread':
      return "Lo is still listing this repository's open pull requests.";
    case 'tooMany':
      return `This repository has over ${counted(MAX_OPEN_PULL_REQUESTS)} open pull requests, so Lo can't tell what this one sits on. Merge it on GitHub.`;
    case 'stale':
      return `Lo's list of this repository's open pull requests is ${age(now - why.listedAt)} old. ${again}`;
    case 'missing':
      return `#${number} isn't in Lo's list of this repository's open pull requests yet. ${again}`;
    case 'moved':
      return `${movedText(number, facts, why.listed)} ${again}`;
    case 'cycle':
      return `${loopText(why.prs)}, so Lo can't tell what this one sits on. Merge it on GitHub.`;
    case 'lookups':
      return `Some merged pull requests weren't looked up yet, so Lo can't tell what #${number} sits on. ${again}`;
    case 'unconfirmed':
      return `Lo hasn't asked GitHub yet whether an open pull request comes from ${why.base}, the branch #${number} merges into.`;
    case 'unlistedBelow':
      return `#${why.pr} comes from ${why.base}, the branch #${number} merges into, but isn't in Lo's list yet. ${again}`;
    default:
      throw new Error(`a reason Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** How GitHub's merge facts and Lo's list place pull request `number` differently. */
function movedText(number: number, facts: Placed, listed: Placed): string {
  if (facts.base !== listed.base) {
    return `GitHub says #${number} merges into ${facts.base}, but Lo's list says ${listed.base}.`;
  }
  const said = facts.stack;
  const has = listed.stack;
  if (said && has && said.number === has.number) {
    return `GitHub says #${number} is layer ${said.position} of GitHub stack #${said.number}, but Lo's list has it as layer ${has.position}.`;
  }
  const github = said === undefined ? 'no GitHub stack' : `GitHub stack #${said.number}`;
  const list = has === undefined ? 'none' : `#${has.number}`;
  return `GitHub says #${number} is in ${github}, but Lo's list has it in ${list}.`;
}

/** Pull requests in a loop: "#12 and #14 each sit on the other". */
function loopText(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 1
    ? `${named[0]} and ${last} each sit on the other`
    : `${named.join(', ')} and ${last} sit on each other in a loop`;
}

/** A count as the interface writes it: "1,000". */
function counted(value: number): string {
  return value.toLocaleString('en-US');
}

/** How long `ms` milliseconds is, in its largest whole unit: "a minute", "6 minutes", "2 hours". */
function age(ms: number): string {
  const minutes = Math.max(1, Math.floor(ms / 60_000));
  if (minutes < 60) return minutes === 1 ? 'a minute' : `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  return hours === 1 ? 'an hour' : `${hours} hours`;
}
