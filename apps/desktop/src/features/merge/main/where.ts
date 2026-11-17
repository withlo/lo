// Where a pull request sits before it merges: alone, a GitHub stack's layer, or a chain's bottom
// layer or a layer above it, from its repository's stacks as the stacks feature has them. Lo merges
// a pull request only once it knows, and it knows only while the list of open pull requests the
// stacks were found among is recent, holds every open pull request, and holds this one where
// GitHub's latest merge facts put it: the stacks are listed less often than the facts are read. A
// pull request opened since the list, from a branch its merge would go into, would sit below it, so
// those branches are asked about afresh. Nothing here calls Electron or GitHub.

import { MAX_OPEN_PULL_REQUESTS, type MergeFacts } from '@lo/github';
import { layerOf, stackOf, type Layer, type NativeStackEntry, type Stacks } from '@lo/stacks';

import type { Forest } from '../../stacks/service.ts';

/** How much longer than the time between lists the stacks' list may go unconfirmed: a minute. */
export const LIST_SLACK = 60_000;

/** Where GitHub's merge facts put a pull request. */
export interface Placed {
  /** The branch it merges into: the facts' `pullRequest.base`. */
  readonly base: string;
  /**
   * The GitHub stack it's a layer of, if it's in one: the facts' `stack.number`, its place there
   * from 1 at the bottom (`stack.position`), and the branch the whole stack merges into
   * (`stack.base`), which the list has as its bottom open layer's base.
   */
  readonly stack:
    { readonly number: number; readonly position: number; readonly base: string } | undefined;
}

/** Where `facts` put their pull request. */
export function placedBy(facts: MergeFacts): Placed {
  const { stack } = facts;
  return {
    base: facts.pullRequest.base,
    stack: stack && { number: stack.number, position: stack.position, base: stack.base },
  };
}

/**
 * The open pull requests from a branch, as `@lo/github`'s `openPullsFromHead` reads them, which can
 * be passed in as they come.
 */
export interface OpenFromHead {
  readonly pullRequests: readonly {
    readonly number: number;
    /** Whether its head branch is in the repository itself: a fork's is never a base branch. */
    readonly sameRepository: boolean;
  }[];
  /** Whether GitHub gave only some of them: over 100, or some it answered as nothing. */
  readonly cutShort: boolean;
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
   * The open pull requests from each branch it, or the stack it merges with, merges into, read from
   * GitHub when it's to merge, so one opened since the list was read isn't missed: its base branch
   * and its stack's root, and its GitHub stack's base. A trunk needs none, since no pull request
   * sits on a layer below one.
   */
  readonly openFrom: ReadonlyMap<string, OpenFromHead>;
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
   * Its merge would go into `branch`, which isn't a trunk, and the open pull requests from it
   * haven't been read since it was asked to merge ({@link WhereView.openFrom}).
   */
  | { readonly kind: 'unconfirmed'; readonly branch: string }
  /** GitHub gave only some of the open pull requests from `branch`, a branch its merge goes into. */
  | { readonly kind: 'cutShort'; readonly branch: string }
  /** Pull request `pr` comes from `branch`, a branch its merge goes into, but isn't in the list. */
  | { readonly kind: 'unlistedBelow'; readonly pr: number; readonly branch: string };

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
  const entry = layer.nativeStack;
  const listed: Placed = {
    base: layer.baseRef,
    stack: entry && {
      number: entry.stack,
      position: entry.position,
      base: githubBottom(stacks, layer, entry).baseRef,
    },
  };
  if (!samePlace(listed, facts)) return unknown({ kind: 'moved', listed }, view);
  const cycle = stacks.cycles.find((each) => each.prs.some((pr) => stack.layers.includes(pr)));
  if (cycle) return unknown({ kind: 'cycle', prs: cycle.prs }, view);
  // What merges with a GitHub stack's layer is GitHub's to say, and its Stacks API is read again
  // before the merge: a merged pull request its stack sits on changes none of it.
  const unlooked = stacks.gaps.some((gap) => gap.kind === 'mergedPullRequests');
  if (unlooked && !entry && !trunks.includes(stack.root)) {
    return unknown({ kind: 'lookups' }, view);
  }
  return readAfresh(view, stacks, trunks, layer) ?? placed(stacks, layer);
}

/**
 * What the open pull requests read afresh from the branches `layer`'s merge would go into say, when
 * that isn't what the list says: that they weren't read, or only in part; that one opened since the
 * list sits below it; or that one the list has sits below where the list sits a layer on a branch.
 * Nothing when they agree.
 */
function readAfresh(
  view: WhereView,
  stacks: Stacks,
  trunks: readonly string[],
  layer: Layer,
): Where | undefined {
  // It, and its GitHub stack's bottom layer, which a stack merges into the base of.
  const entry = layer.nativeStack;
  const bottom = entry && githubBottom(stacks, layer, entry);
  const layers = [layer, ...(bottom && bottom !== layer ? [bottom] : [])];
  // The branches the list says nothing comes from: a stack's root, and a layer's base it sits on.
  const roots = layers.flatMap((each) => [
    stackOf(stacks, each.number)?.root ?? each.baseRef,
    ...(each.parent.kind === 'branch' ? [each.baseRef] : []),
  ]);
  const into = [...new Set([...layers.map((each) => each.baseRef), ...roots])].filter(
    (branch) => !trunks.includes(branch),
  );
  const from = new Map<string, number[]>();
  for (const branch of into) {
    const read = view.openFrom.get(branch);
    if (!read) return unknown({ kind: 'unconfirmed', branch }, view);
    if (read.cutShort) return unknown({ kind: 'cutShort', branch }, view);
    const numbers = read.pullRequests
      .filter((pr) => pr.sameRepository && pr.number !== layer.number)
      .map((pr) => pr.number)
      .toSorted((a, b) => b - a);
    const pr = numbers.find((number) => !layerOf(stacks, number));
    if (pr !== undefined) return unknown({ kind: 'unlistedBelow', pr, branch }, view);
    from.set(branch, numbers);
  }
  const own = stackOf(stacks, layer.number)?.layers ?? [layer.number];
  for (const branch of new Set(roots)) {
    // It sits on the newest, as finding stacks would put it, and as far down as the list goes.
    const [newest] = from.get(branch) ?? [];
    if (newest === undefined) continue;
    if (own.includes(newest)) {
      return unknown({ kind: 'cycle', prs: [own[0] ?? layer.number, newest] }, view);
    }
    return { kind: 'chainAbove', bottom: stackOf(stacks, newest)?.layers[0] ?? newest };
  }
  return undefined;
}

/** The open layers of the GitHub stack `entry` names below its place, bottom first. */
function githubBelow(stacks: Stacks, entry: NativeStackEntry): number[] {
  return Object.values(stacks.layers)
    .filter(
      (other) =>
        other.nativeStack?.stack === entry.stack && other.nativeStack.position < entry.position,
    )
    .toSorted((a, b) => (a.nativeStack?.position ?? 0) - (b.nativeStack?.position ?? 0))
    .map((other) => other.number);
}

/** The lowest open layer of `layer`'s GitHub stack, whose base the whole stack merges into. */
function githubBottom(stacks: Stacks, layer: Layer, entry: NativeStackEntry): Layer {
  return layerOf(stacks, githubBelow(stacks, entry)[0] ?? layer.number) ?? layer;
}

/** Whether `a` and `b` put a pull request in the same place. */
function samePlace(a: Placed, b: Placed): boolean {
  if (a.base !== b.base) return false;
  if (a.stack === undefined || b.stack === undefined) return a.stack === b.stack;
  return (
    a.stack.number === b.stack.number &&
    a.stack.position === b.stack.position &&
    a.stack.base === b.stack.base
  );
}

/** Where `layer` sits among `stacks`, which Lo can be sure of. */
function placed(stacks: Stacks, layer: Layer): Where {
  const entry = layer.nativeStack;
  if (entry) {
    // GitHub's stack, as the open layers say it: a closed layer between them doesn't split it.
    const below = githubBelow(stacks, entry);
    const bottom = githubBottom(stacks, layer, entry);
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
    // Still being listed; nothing settles it; a loop stays one; they wait for their own reads.
    case 'unread':
    case 'tooMany':
    case 'cycle':
    case 'unconfirmed':
    case 'cutShort':
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
      return `Lo hasn't asked GitHub yet which open pull requests come from ${why.branch}.`;
    case 'cutShort':
      return `GitHub gave only some of the open pull requests from ${why.branch}, so Lo can't tell what this one sits on. Merge it on GitHub.`;
    case 'unlistedBelow':
      return `#${why.pr} comes from ${why.branch} but isn't in Lo's list yet, so Lo can't tell what #${number} sits on. ${again}`;
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
  if (said && has && said.number === has.number && said.position !== has.position) {
    return `GitHub says #${number} is layer ${said.position} of GitHub stack #${said.number}, but Lo's list has it as layer ${has.position}.`;
  }
  if (said && has && said.number === has.number) {
    return `GitHub says GitHub stack #${said.number} merges into ${said.base}, but Lo's list says ${has.base}.`;
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
