// Where a pull request sits before it merges, among stacks found from pull requests made up here,
// on `main`, the only trunk:
//
// - #1 alone;
// - a chain by base branch: #2 on main, #3 on #2, #4 on #3;
// - GitHub stack #90: #10 on main, #11 and #12 above it, and #13 on #11 by its base branch;
// - GitHub stack #95, #21 and #22, sitting on #20, which is on main;
// - GitHub stack #96: #41 on main and #43, whose layer between them closed;
// - #31 on the branch of #30, which was squash-merged into main.
//
// Others below make up a pull request opened below one since the list, merged pull requests that
// weren't looked up, and pull requests that sit on each other in a loop.

import {
  findStacks,
  layerOf,
  type Gap,
  type Layer,
  type NativeStackEntry,
  type PullRequest,
  type Stacks,
} from '@lo/stacks';
import { describe, expect, it } from 'vitest';

import {
  LIST_SLACK,
  unmergedIn,
  where,
  type OpenFromHead,
  type Placed,
  type Where,
  type WhereView,
} from './where.ts';

const NOW = 1_800_000_000_000;
const EVERY = 120_000;
const TRUNKS = ['main'];

/** An open pull request from `head` into `base`. */
function pull(
  number: number,
  base: string,
  head: string,
  more: Partial<PullRequest> = {},
): PullRequest {
  return {
    number,
    state: { kind: 'open' },
    baseRef: base,
    baseTip: undefined,
    headRef: head,
    headInBaseRepo: true,
    headOid: String(number).padStart(40, '0'),
    commits: [],
    createdAt: number,
    nativeStack: undefined,
    ...more,
  };
}

function inStack(stack: number, position: number): { nativeStack: NativeStackEntry } {
  return { nativeStack: { stack, position } };
}

/** Pull requests as GitHub has them, and the stacks Lo's list finds among them. */
interface Repository {
  readonly pulls: readonly PullRequest[];
  readonly stacks: Stacks;
}

/** The stacks among `pulls`, with what the reads left out. */
function repository(pulls: readonly PullRequest[], gaps: readonly Gap[] = []): Repository {
  return { pulls, stacks: { ...findStacks(pulls, TRUNKS), gaps } };
}

const squashed = pull(30, 'main', 'm30', { state: { kind: 'merged', headInBase: false } });

const MAIN = repository([
  pull(1, 'main', 'a1'),
  pull(2, 'main', 'b2'),
  pull(3, 'b2', 'b3'),
  pull(4, 'b3', 'b4'),
  pull(10, 'main', 's10', inStack(90, 1)),
  pull(11, 's10', 's11', inStack(90, 2)),
  pull(12, 's11', 's12', inStack(90, 3)),
  pull(13, 's11', 'c13'),
  pull(20, 'main', 'c20'),
  pull(21, 'c20', 'c21', inStack(95, 1)),
  pull(22, 'c21', 'c22', inStack(95, 2)),
  pull(41, 'main', 'g41', inStack(96, 1)),
  pull(43, 'g42', 'g43', inStack(96, 3)),
  squashed,
  // Its base branch still points at #30's head, as GitHub left it.
  pull(31, 'm30', 'c31', { baseTip: squashed.headOid, commits: [squashed.headOid] }),
]);

/** Where `layer` sits as the list in `at` has it, as GitHub's merge facts would agree. */
function placedIn(layer: Layer, at: Repository = MAIN): Placed {
  const entry = layer.nativeStack;
  // The stack merges into its bottom layer's base.
  const bottom = Object.values(at.stacks.layers)
    .filter((other) => other.nativeStack?.stack === entry?.stack)
    .toSorted((a, b) => (a.nativeStack?.position ?? 0) - (b.nativeStack?.position ?? 0))[0];
  return {
    base: layer.baseRef,
    stack: entry && {
      number: entry.stack,
      position: entry.position,
      base: bottom?.baseRef ?? layer.baseRef,
    },
  };
}

/** The open pull requests from each of `at`'s branches, as GitHub would answer at the press. */
function readFrom(at: Repository): Map<string, OpenFromHead> {
  const branches = new Set(at.pulls.flatMap((pr) => [pr.baseRef, pr.headRef]));
  return new Map(
    [...branches].map((branch) => [
      branch,
      {
        pullRequests: at.pulls
          .filter((pr) => pr.state.kind === 'open' && pr.headRef === branch)
          .map((pr) => ({ number: pr.number, sameRepository: pr.headInBaseRepo })),
        cutShort: false,
      },
    ]),
  );
}

/** What GitHub answers at the press in `at`, but for `branch`, which `read` comes from, or none. */
function readingFrom(
  at: Repository,
  branch: string,
  read: OpenFromHead | undefined,
): Map<string, OpenFromHead> {
  const answers = readFrom(at);
  if (read) answers.set(branch, read);
  else answers.delete(branch);
  return answers;
}

/** Pull requests `numbers`, from branches in the repository itself, as GitHub gives them. */
function ours(...numbers: number[]): OpenFromHead {
  return {
    pullRequests: numbers.map((number) => ({ number, sameRepository: true })),
    cutShort: false,
  };
}

/** `at`'s stacks as the stacks feature gives them, listed a second ago, with `change` made. */
function forest(
  change: Partial<NonNullable<WhereView['forest']>> = {},
  at: Repository = MAIN,
): WhereView['forest'] {
  return {
    stacks: at.stacks,
    trunks: TRUNKS,
    listedAt: NOW - 1000,
    listEvery: EVERY,
    whole: true,
    ...change,
  };
}

/**
 * Pull request `number`'s view in `at`: a list confirmed a second ago, merge facts that agree with
 * it, and the open pull requests from every branch read afresh.
 */
function view(number: number, more: Partial<WhereView> = {}, at: Repository = MAIN): WhereView {
  const layer = layerOf(at.stacks, number);
  return {
    number,
    facts: layer ? placedIn(layer, at) : { base: 'main', stack: undefined },
    forest: forest({}, at),
    openFrom: readFrom(at),
    now: NOW,
    ...more,
  };
}

/** Where pull request `number` sits when GitHub's merge facts put it in `stack`. */
function stackSaid(number: number, stack: Placed['stack']): Where {
  const layer = layerOf(MAIN.stacks, number);
  if (!layer) throw new Error(`#${number} isn't listed`);
  return where(view(number, { facts: { ...placedIn(layer), stack } }));
}

function unsure(answer: Where) {
  if (answer.kind !== 'unknown') throw new Error(`Lo knew: ${JSON.stringify(answer)}`);
  return answer;
}

describe('where a pull request sits', () => {
  it('is alone on its own base branch', () => {
    expect(where(view(1))).toEqual({ kind: 'alone' });
    // Nothing sits below a pull request into a trunk, so nothing need be read for it.
    expect(where(view(1, { openFrom: new Map() }))).toEqual({ kind: 'alone' });
  });

  it("is a GitHub stack's layer, with its open layers below", () => {
    expect(where(view(10))).toEqual({ kind: 'githubStack', stack: 90, below: [] });
    expect(where(view(11))).toEqual({ kind: 'githubStack', stack: 90, below: [10] });
    expect(where(view(12))).toEqual({ kind: 'githubStack', stack: 90, below: [10, 11] });
    // A closed layer between them doesn't split the stack.
    expect(where(view(43))).toEqual({ kind: 'githubStack', stack: 96, below: [41] });
  });

  it("is a chain's bottom layer", () => {
    expect(where(view(2))).toEqual({ kind: 'chainBottom' });
    // A GitHub stack sits on it.
    expect(where(view(20))).toEqual({ kind: 'chainBottom' });
    // Alone, but on the branch of a pull request that was squash-merged.
    expect(where(view(31))).toEqual({ kind: 'chainBottom' });
  });

  it("is a chain's layer above its bottom, which it names", () => {
    expect(where(view(3))).toEqual({ kind: 'chainAbove', bottom: 2 });
    expect(where(view(4))).toEqual({ kind: 'chainAbove', bottom: 2 });
    // On a GitHub stack's layer by its base branch.
    expect(where(view(13))).toEqual({ kind: 'chainAbove', bottom: 10 });
    // A layer of a GitHub stack that sits on another pull request.
    expect(where(view(21))).toEqual({ kind: 'chainAbove', bottom: 20 });
    expect(where(view(22))).toEqual({ kind: 'chainAbove', bottom: 20 });
  });

  it('sits on a pull request opened from its base branch since the list was read', () => {
    const before = repository([pull(70, 'feat', 'c70')]);
    expect(where(view(70, {}, before))).toEqual({ kind: 'alone' });
    // #71, from feat into main, opened since: the list doesn't have it.
    const opened = readingFrom(before, 'feat', ours(71));
    expect(where(view(70, { openFrom: opened }, before))).toEqual({
      kind: 'unknown',
      why: { kind: 'unlistedBelow', pr: 71, branch: 'feat' },
      text: "#71 comes from feat but isn't in Lo's list yet, so Lo can't tell what #70 sits on. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    // Listed again, it's below.
    const after = repository([pull(70, 'feat', 'c70'), pull(71, 'main', 'feat')]);
    expect(where(view(70, {}, after))).toEqual({ kind: 'chainAbove', bottom: 71 });
    // A fork's branch of the same name is never a base.
    const fork = { pullRequests: [{ number: 71, sameRepository: false }], cutShort: false };
    expect(where(view(70, { openFrom: readingFrom(before, 'feat', fork) }, before))).toEqual({
      kind: 'alone',
    });
  });

  it('sits on a pull request from its base branch the list has but doesn’t put below it', () => {
    // As GitHub has them now, #72 comes from feat, and #73 sits on #70.
    const at = repository([
      pull(70, 'feat', 'c70'),
      pull(72, 'main', 'x72'),
      pull(73, 'c70', 'c73'),
    ]);
    expect(where(view(70, { openFrom: readingFrom(at, 'feat', ours(72)) }, at))).toEqual({
      kind: 'chainAbove',
      bottom: 72,
    });
    expect(
      unsure(where(view(70, { openFrom: readingFrom(at, 'feat', ours(73)) }, at))).why,
    ).toEqual({ kind: 'cycle', prs: [70, 73] });
  });

  it('sits on a pull request opened since from the base its GitHub stack merges into', () => {
    // GitHub stack #90 on feat: #11's own base is #10's branch, but the stack merges into feat.
    const stacked = [
      pull(10, 'feat', 's10', inStack(90, 1)),
      pull(11, 's10', 's11', inStack(90, 2)),
    ];
    const before = repository(stacked);
    expect(where(view(11, {}, before))).toEqual({ kind: 'githubStack', stack: 90, below: [10] });
    // #99, from feat, opened since.
    expect(
      unsure(where(view(11, { openFrom: readingFrom(before, 'feat', ours(99)) }, before))).why,
    ).toEqual({ kind: 'unlistedBelow', pr: 99, branch: 'feat' });
    expect(
      unsure(where(view(11, { openFrom: readingFrom(before, 'feat', undefined) }, before))).why,
    ).toEqual({ kind: 'unconfirmed', branch: 'feat' });
    // Listed again, the stack sits on it.
    const after = repository([...stacked, pull(99, 'main', 'feat')]);
    expect(where(view(11, {}, after))).toEqual({ kind: 'chainAbove', bottom: 99 });
  });

  it('sits on a pull request opened since from the root a chain merges into', () => {
    // #30 was merge-committed into feat: #31, still on #30's branch, would move onto feat.
    const merged = pull(30, 'feat', 'm30', { state: { kind: 'merged', headInBase: true } });
    const at = repository([
      merged,
      pull(31, 'm30', 'c31', { baseTip: merged.headOid, commits: [merged.headOid] }),
    ]);
    expect(where(view(31, {}, at))).toEqual({ kind: 'chainBottom' });
    expect(
      unsure(where(view(31, { openFrom: readingFrom(at, 'feat', ours(29)) }, at))).why,
    ).toEqual({
      kind: 'unlistedBelow',
      pr: 29,
      branch: 'feat',
    });
    expect(
      unsure(where(view(31, { openFrom: readingFrom(at, 'feat', undefined) }, at))).why,
    ).toEqual({
      kind: 'unconfirmed',
      branch: 'feat',
    });
  });
});

describe('where a pull request sits is unknown', () => {
  it('until the stacks are known', () => {
    expect(where(view(1, { forest: undefined }))).toEqual({
      kind: 'unknown',
      why: { kind: 'unread' },
      text: "Lo is still listing this repository's open pull requests.",
      listAgain: false,
    });
  });

  it('for good when the list holds only the newest 1,000 open pull requests', () => {
    const answer = {
      kind: 'unknown',
      why: { kind: 'tooMany' },
      text: "This repository has over 1,000 open pull requests, so Lo can't tell what this one sits on. Merge it on GitHub.",
      listAgain: false,
    };
    expect(where(view(1, { forest: forest({ whole: false }) }))).toEqual(answer);
    // However old the list is: listing again won't change it.
    expect(where(view(1, { forest: forest({ whole: false, listedAt: 0 }) }))).toEqual(answer);
  });

  it('once the list goes unconfirmed longer than the time between lists and a minute', () => {
    const listedAt = NOW - EVERY - LIST_SLACK;
    expect(where(view(1, { forest: forest({ listedAt }) }))).toEqual({ kind: 'alone' });
    expect(where(view(1, { forest: forest({ listedAt: listedAt - 1 }) }))).toEqual({
      kind: 'unknown',
      why: { kind: 'stale', listedAt: listedAt - 1 },
      text: "Lo's list of this repository's open pull requests is 3 minutes old. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    // Listed every 5 minutes, as in the background, it's still recent.
    const background = forest({ listedAt: NOW - 5.5 * 60_000, listEvery: 5 * 60_000 });
    expect(where(view(1, { forest: background }))).toEqual({ kind: 'alone' });
    expect(
      unsure(where(view(1, { forest: forest({ listedAt: NOW - 2 * 3_600_000 }) }))).text,
    ).toMatch(/ is 2 hours old\. /);
  });

  it("while the list doesn't hold the pull request", () => {
    expect(where(view(99))).toEqual({
      kind: 'unknown',
      why: { kind: 'missing' },
      text: "#99 isn't in Lo's list of this repository's open pull requests yet. Lo is listing the open pull requests again.",
      listAgain: true,
    });
  });

  it('while the list has it on another base than GitHub’s merge facts', () => {
    expect(where(view(3, { facts: { base: 'main', stack: undefined } }))).toEqual({
      kind: 'unknown',
      why: { kind: 'moved', listed: { base: 'b2', stack: undefined } },
      text: "GitHub says #3 merges into main, but Lo's list says b2. Lo is listing the open pull requests again.",
      listAgain: true,
    });
  });

  it('while the list has it in another GitHub stack than the merge facts, or none', () => {
    expect(unsure(stackSaid(2, { number: 90, position: 1, base: 'main' }))).toMatchObject({
      why: { kind: 'moved', listed: { base: 'main', stack: undefined } },
      text: "GitHub says #2 is in GitHub stack #90, but Lo's list has it in none. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    expect(unsure(stackSaid(11, undefined)).text).toBe(
      "GitHub says #11 is in no GitHub stack, but Lo's list has it in #90. Lo is listing the open pull requests again.",
    );
    expect(unsure(stackSaid(11, { number: 97, position: 2, base: 'main' })).text).toBe(
      "GitHub says #11 is in GitHub stack #97, but Lo's list has it in #90. Lo is listing the open pull requests again.",
    );
  });

  it('while the list has it at another place in its GitHub stack than the merge facts', () => {
    expect(unsure(stackSaid(11, { number: 90, position: 1, base: 'main' }))).toMatchObject({
      why: { kind: 'moved', listed: { stack: { number: 90, position: 2, base: 'main' } } },
      text: "GitHub says #11 is layer 1 of GitHub stack #90, but Lo's list has it as layer 2. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    // Never the bottom of the stack, with nothing below, while they disagree.
    expect(unsure(stackSaid(10, { number: 90, position: 2, base: 'main' })).why.kind).toBe('moved');
  });

  it('while the list has its GitHub stack merging into another branch than the merge facts', () => {
    // #10, the stack's bottom layer, moved onto release since the list was read.
    expect(unsure(stackSaid(11, { number: 90, position: 2, base: 'release' }))).toMatchObject({
      why: { kind: 'moved', listed: { stack: { number: 90, position: 2, base: 'main' } } },
      text: "GitHub says GitHub stack #90 merges into release, but Lo's list says main. Lo is listing the open pull requests again.",
      listAgain: true,
    });
  });

  it('while pull requests in its stack sit on each other in a loop', () => {
    const at = repository([
      pull(50, 'c51', 'c50'),
      pull(51, 'c50', 'c51'),
      pull(60, 'c62', 'c60'),
      pull(61, 'c60', 'c61'),
      pull(62, 'c61', 'c62'),
      pull(63, 'c62', 'c63'),
    ]);
    expect(where(view(51, {}, at))).toEqual({
      kind: 'unknown',
      why: { kind: 'cycle', prs: [50, 51] },
      text: "#50 and #51 each sit on the other, so Lo can't tell what this one sits on. Merge it on GitHub.",
      listAgain: false,
    });
    // A layer on the loop is unsure too. The loop is named in the order each sits on the next.
    expect(unsure(where(view(63, {}, at))).text).toBe(
      "#60, #62 and #61 sit on each other in a loop, so Lo can't tell what this one sits on. Merge it on GitHub.",
    );
  });

  it('while merged pull requests its stack may sit on weren’t looked up', () => {
    // #30 was squash-merged into b29, #29's branch, and wasn't looked up: #31 sits on its branch.
    const pulls = [pull(29, 'main', 'b29'), pull(31, 'm30', 'c31')];
    const unlooked = repository(pulls, [{ kind: 'mergedPullRequests' }]);
    expect(where(view(31, {}, unlooked))).toEqual({
      kind: 'unknown',
      why: { kind: 'lookups' },
      text: "Some merged pull requests weren't looked up yet, so Lo can't tell what #31 sits on. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    // A stack on a trunk sits on no merged pull request's branch.
    expect(where(view(29, {}, unlooked))).toEqual({ kind: 'alone' });
    // A GitHub stack on m30, #30's branch, would merge into it: GitHub's stack doesn't say.
    const native = (base: string) =>
      repository(
        [
          pull(70, base, 'g70', { nativeStack: { stack: 97, position: 1 } }),
          pull(71, 'g70', 'g71', { nativeStack: { stack: 97, position: 2 } }),
        ],
        [{ kind: 'mergedPullRequests' }],
      );
    expect(unsure(where(view(71, {}, native('m30')))).why).toEqual({ kind: 'lookups' });
    expect(unsure(where(view(70, {}, native('m30')))).why).toEqual({ kind: 'lookups' });
    // On a trunk, it's GitHub's stack.
    const stack97 = { kind: 'githubStack', stack: 97, below: [70] };
    expect(where(view(71, {}, native('main')))).toEqual(stack97);
    // So it is on a branch the lookups found no merged pull request from. Another branch looked
    // up says nothing of its own, and one a merged pull request was found from is no root.
    const lookups = [
      { branch: 'm29', tip: undefined, found: [], at: NOW },
      { branch: 'b29', tip: undefined, found: [], at: NOW },
      { branch: 'm30', tip: undefined, found: [30], at: NOW },
    ];
    const unmerged = unmergedIn(lookups);
    expect(where(view(71, { unmerged }, native('m29')))).toEqual(stack97);
    expect(unsure(where(view(71, { unmerged }, native('m30')))).why).toEqual({ kind: 'lookups' });
    expect(unsure(where(view(71, { unmerged }, native('m28')))).why).toEqual({ kind: 'lookups' });
    // A chain waits for every lookup, wherever it sits.
    const chain = repository(
      [pull(72, 'm29', 'g72'), pull(73, 'g72', 'g73')],
      [{ kind: 'mergedPullRequests' }],
    );
    expect(unsure(where(view(73, { unmerged }, chain))).why).toEqual({ kind: 'lookups' });
    // Rulesets that weren't read only add links, which never makes a layer look alone.
    const unruled = repository(pulls, [{ kind: 'rulesets', why: 'Forbidden' }]);
    expect(where(view(31, {}, unruled))).toEqual({ kind: 'alone' });
  });

  it('until the open pull requests from its base branch are read, unless that’s a trunk', () => {
    expect(where(view(3, { openFrom: readingFrom(MAIN, 'b2', undefined) }))).toEqual({
      kind: 'unknown',
      why: { kind: 'unconfirmed', branch: 'b2' },
      text: "Lo hasn't asked GitHub yet which open pull requests come from b2.",
      listAgain: false,
    });
  });

  it('when GitHub gave only some of the open pull requests from a branch it merges into', () => {
    const some = { ...ours(2), cutShort: true };
    expect(where(view(3, { openFrom: readingFrom(MAIN, 'b2', some) }))).toEqual({
      kind: 'unknown',
      why: { kind: 'cutShort', branch: 'b2' },
      text: "GitHub gave only some of the open pull requests from b2, so Lo can't tell what this one sits on. Merge it on GitHub.",
      listAgain: false,
    });
  });
});
