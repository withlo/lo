// Where a pull request sits before it merges, among stacks found from pull requests made up here:
//
// - #1 alone on main;
// - a chain by base branch: #2 on main, #3 on #2, #4 on #3;
// - GitHub stack #90: #10 on main, #11 and #12 above it, and #13 on #11 by its base branch;
// - GitHub stack #95, #21 and #22, sitting on #20, which is on main;
// - GitHub stack #96: #41 on main and #43, whose layer between them closed;
// - #31 on the branch of #30, which was squash-merged into main.

import { findStacks, layerOf, type NativeStackEntry, type PullRequest } from '@lo/stacks';
import { describe, expect, it } from 'vitest';

import { LIST_SLACK, where, type Placed, type Where, type WhereView } from './where.ts';

const NOW = 1_800_000_000_000;
const EVERY = 120_000;

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

const squashed = pull(30, 'main', 'm30', { state: { kind: 'merged', headInBase: false } });

const STACKS = findStacks(
  [
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
  ],
  ['main'],
);

/** Where the list puts pull request `number`, as GitHub's merge facts would agree. */
function listed(number: number): Placed {
  const layer = layerOf(STACKS, number);
  if (!layer) throw new Error(`#${number} isn't listed`);
  return { base: layer.baseRef, stack: layer.nativeStack?.stack };
}

/** Pull request `number`'s view, with a list confirmed a second ago that agrees with its facts. */
function view(number: number, more: Partial<WhereView> = {}): WhereView {
  return {
    number,
    facts: layerOf(STACKS, number) ? listed(number) : { base: 'main', stack: undefined },
    forest: forest({}),
    now: NOW,
    ...more,
  };
}

/** The forest of {@link view}, with `change` made to it. */
function forest(change: Partial<NonNullable<WhereView['forest']>>): WhereView['forest'] {
  return { stacks: STACKS, listedAt: NOW - 1000, listEvery: EVERY, whole: true, ...change };
}

/** Where pull request `number` sits when GitHub's merge facts say it's in GitHub stack `stack`. */
function inStackSaid(stack: number | undefined, number: number): Where {
  return where(view(number, { facts: { ...listed(number), stack } }));
}

function unsure(answer: Where) {
  if (answer.kind !== 'unknown') throw new Error(`Lo knew: ${JSON.stringify(answer)}`);
  return answer;
}

describe('where a pull request sits', () => {
  it('is alone on its own base branch', () => {
    expect(where(view(1))).toEqual({ kind: 'alone' });
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
      text: "Lo's list of this repository's open pull requests is 3 minutes old. Lo is listing them again.",
      listAgain: true,
    });
    // Listed every 5 minutes, as in the background, it's still recent.
    const background = forest({ listedAt: NOW - 5.5 * 60_000, listEvery: 5 * 60_000 });
    expect(where(view(1, { forest: background }))).toEqual({ kind: 'alone' });
    expect(unsure(where(view(1, { forest: forest({ listedAt: NOW - 2 * 3_600_000 }) }))).text).toBe(
      "Lo's list of this repository's open pull requests is 2 hours old. Lo is listing them again.",
    );
  });

  it("while the list doesn't hold the pull request", () => {
    expect(where(view(99))).toEqual({
      kind: 'unknown',
      why: { kind: 'missing' },
      text: "#99 isn't in Lo's list of this repository's open pull requests yet. Lo is listing them again.",
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
    expect(unsure(inStackSaid(90, 2))).toMatchObject({
      why: { kind: 'moved', listed: { base: 'main', stack: undefined } },
      text: "GitHub says #2 is in GitHub stack #90, but Lo's list has it in none. Lo is listing the open pull requests again.",
      listAgain: true,
    });
    expect(unsure(inStackSaid(undefined, 11)).text).toBe(
      "GitHub says #11 is in no GitHub stack, but Lo's list has it in #90. Lo is listing the open pull requests again.",
    );
    expect(unsure(inStackSaid(97, 11)).text).toBe(
      "GitHub says #11 is in GitHub stack #97, but Lo's list has it in #90. Lo is listing the open pull requests again.",
    );
  });
});
