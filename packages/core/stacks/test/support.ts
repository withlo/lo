/**
 * Builders for pull requests and text renderings of the forest and of plans, so tests read as
 * trees and as the confirmations Lo shows.
 */

import { expect } from 'vitest';

import { planConversion, type Conversion, type Plan } from '../src/convert.ts';
import {
  findStacks,
  layerOf,
  type NativeStackEntry,
  type PullRequest,
  type Retarget,
  type Rule,
  type Stacks,
  type State,
} from '../src/stacks.ts';

/** A pull request built for a test, with ways to change it. */
export class TestPr implements PullRequest {
  readonly number: number;
  readonly state: State;
  readonly baseRef: string;
  readonly baseTip: string | undefined;
  readonly headRef: string;
  readonly headInBaseRepo: boolean;
  readonly headOid: string;
  readonly commits: readonly string[];
  readonly createdAt: number;
  readonly nativeStack: NativeStackEntry | undefined;

  constructor(fields: PullRequest) {
    this.number = fields.number;
    this.state = fields.state;
    this.baseRef = fields.baseRef;
    this.baseTip = fields.baseTip;
    this.headRef = fields.headRef;
    this.headInBaseRepo = fields.headInBaseRepo;
    this.headOid = fields.headOid;
    this.commits = fields.commits;
    this.createdAt = fields.createdAt;
    this.nativeStack = fields.nativeStack;
  }

  #with(fields: Partial<PullRequest>): TestPr {
    return new TestPr({
      number: this.number,
      state: this.state,
      baseRef: this.baseRef,
      baseTip: this.baseTip,
      headRef: this.headRef,
      headInBaseRepo: this.headInBaseRepo,
      headOid: this.headOid,
      commits: this.commits,
      createdAt: this.createdAt,
      nativeStack: this.nativeStack,
      ...fields,
    });
  }

  /** Sets the commits, oldest first. The last is the head. */
  withCommits(commits: readonly string[]): TestPr {
    return this.#with({ commits, headOid: commits.at(-1) ?? '' });
  }

  /** Lists no commits, keeping the head. */
  noCommits(): TestPr {
    return this.#with({ commits: [] });
  }

  /** Sets the base branch's tip. */
  baseAt(oid: string): TestPr {
    return this.#with({ baseTip: oid });
  }

  /** Makes the base branch deleted, so it has no tip. */
  baseDeleted(): TestPr {
    return this.#with({ baseTip: undefined });
  }

  created(seconds: number): TestPr {
    return this.#with({ createdAt: at(seconds) });
  }

  closed(): TestPr {
    return this.#with({ state: { kind: 'closed' } });
  }

  merged(headInBase: boolean): TestPr {
    return this.#with({ state: { kind: 'merged', headInBase } });
  }

  /** Makes it a pull request from a fork, whose head branch isn't in the base repository. */
  fork(): TestPr {
    return this.#with({ headInBaseRepo: false });
  }

  /** Makes it the layer at `position` of GitHub stack `stack`. */
  native(stack: number, position: number): TestPr {
    return this.#with({ nativeStack: { stack, position } });
  }
}

/**
 * An open pull request from `head` (a branch in the base repository) into `base`, with one commit,
 * `<head>.1`, created `number` seconds after the epoch. The base branch's tip is `<base>.1`, the
 * default head of a pull request from that branch.
 */
export function pr(number: number, base: string, head: string): TestPr {
  const oid = `${head}.1`;
  return new TestPr({
    number,
    state: { kind: 'open' },
    baseRef: base,
    baseTip: `${base}.1`,
    headRef: head,
    headInBaseRepo: true,
    headOid: oid,
    commits: [oid],
    createdAt: at(number),
    nativeStack: undefined,
  });
}

/** `seconds` after the Unix epoch, in milliseconds. */
export function at(seconds: number): number {
  return seconds * 1000;
}

const RULE_NAMES: Record<Rule, string> = {
  nativeStack: 'native-stack',
  baseBranch: 'base-branch',
  sharedCommits: 'shared-commits',
};

/**
 * Renders the forest one line per root branch and layer, layers indented under what they sit on,
 * in each stack's walk order. A layer's line ends with the rule that linked it and any rebase it
 * needs.
 */
export function render(stacks: Stacks): string {
  const lines: string[] = [];
  for (const root of stacks.roots) {
    lines.push(root.branch);
    for (const stack of root.stacks) {
      expect(stack.root).toBe(root.branch);
      for (const number of stack.layers) {
        const layer = layerOf(stacks, number);
        if (!layer) throw new Error(`walked layer #${number} doesn't exist`);
        let line = `${'  '.repeat(layer.depth + 1)}#${number}`;
        if (layer.rule !== undefined) line += ` ${RULE_NAMES[layer.rule]}`;
        if (layer.needsRebase) {
          line += ` needs-rebase(#${layer.needsRebase.merged} ${layer.needsRebase.compareAgainst})`;
        }
        lines.push(line);
      }
    }
  }
  return lines.join('\n');
}

/**
 * Plans converting the path through `layer`, among `prs` with no trunk branches, in a repository
 * with the Stacks API and nothing in its merge queue.
 */
export function plan(prs: readonly PullRequest[], layer: number): Conversion {
  return planConversion(findStacks(prs, []), layer, { stacksApi: true, queued: [] });
}

/** The reasons `conversion` gives for not being offered, failing the test when it's a plan. */
export function reasons(conversion: Conversion): unknown[] {
  if (conversion.kind !== 'notOffered') throw new Error('conversion was offered');
  return [...conversion.reasons];
}

/** The plan `conversion` is, failing the test when it isn't offered. */
export function offered(conversion: Conversion): Plan {
  if (conversion.kind !== 'plan') {
    throw new Error(`conversion isn't offered: ${JSON.stringify(conversion.reasons)}`);
  }
  return conversion.plan;
}

/**
 * Plans converting the path through `layer` and checks the rendered plan against `expected`, one
 * line each.
 */
export function expectPlan(prs: readonly PullRequest[], layer: number, expected: string[]): Plan {
  const planned = offered(plan(prs, layer));
  expect(renderPlan(planned)).toEqual(expected);
  return planned;
}

/**
 * Renders a conversion plan as its confirmation lists it: the root branch and the path, then one
 * line per step.
 */
export function renderPlan(planned: Plan): string[] {
  return [
    `${planned.root}: ${numbers(planned.path)}`,
    ...planned.steps.map((step) => {
      switch (step.kind) {
        case 'retarget':
          return renderRetarget(step.retarget);
        case 'createStack':
          return `create ${numbers(step.prs)}`;
        case 'addToStack':
          return `add ${numbers(step.prs)} to stack ${step.stack}`;
        default:
          return step satisfies never;
      }
    }),
  ];
}

/** `#2 main -> a`. */
export function renderRetarget({ pr: number, from, to }: Retarget): string {
  return `#${number} ${from} -> ${to}`;
}

/** `#1 #2 #3`. */
export function numbers(prs: readonly number[]): string {
  return prs.map((number) => `#${number}`).join(' ');
}

/**
 * Finds the stacks among `prs`, with no trunk branches, and checks the rendered forest against
 * `expected`, one line each.
 */
export function expectForest(prs: readonly PullRequest[], expected: string[]): Stacks {
  return expectTrunkForest(prs, [], expected);
}

/** Like {@link expectForest}, with trunk branches. */
export function expectTrunkForest(
  prs: readonly PullRequest[],
  trunks: readonly string[],
  expected: string[],
): Stacks {
  const stacks = findStacks(prs, trunks);
  expect(render(stacks)).toBe(expected.join('\n'));
  return stacks;
}
