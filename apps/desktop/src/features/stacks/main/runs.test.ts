// Runs of layers one diff shows, from what the app's cassette recorded of rozed-dev/e2e: #82 on
// `stack/root`, #83 on #82 by its base branch, #84 on #83 by the commits they share, and #85, a
// second layer on #82.

import { stackPullRequests, stacksOf } from '@lo/stacks';
import { STACK_PULLS } from '@lo/testing/git';
import { describe, expect, it } from 'vitest';

import { runOf } from './runs.ts';
import { changePull, E2E, recorded } from './test/support.ts';

describe('a run of layers', () => {
  it('goes from where its bottom layer’s own changes start, either way it was chosen', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const stacks = stacksOf(list, rules);
    const prs = stackPullRequests(list);
    // #83 starts at its base branch, `stack/a`, at #82's head.
    expect(runOf(stacks, prs, 83, 84)).toEqual({ layers: [83, 84], start: STACK_PULLS.a.head });
    // The stack's bottom layer starts at the tip of the branch it sits on.
    expect(runOf(stacks, prs, 84, 82)).toEqual({
      layers: [82, 83, 84],
      start: STACK_PULLS.root,
    });
    expect(runOf(stacks, prs, 82, 85)).toEqual({ layers: [82, 85], start: STACK_PULLS.root });
  });

  it('is a chain of two layers or more, and says why it isn’t', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const stacks = stacksOf(list, rules);
    const prs = stackPullRequests(list);
    // #85 is on #82, apart from #83 and #84.
    expect(runOf(stacks, prs, 84, 85)).toEqual({
      why: "#84 and #85 aren't on one branch of the stack, so no one diff shows them.",
    });
    expect(runOf(stacks, prs, 83, 83)).toEqual({ why: 'A run of layers is two layers or more.' });
    expect(runOf(stacks, prs, 83, 9999)).toMatchObject({ why: expect.stringContaining('#9999') });
    // A base branch that's gone has no tip to start from.
    const gone = changePull(list, 82, (pr) => ({ ...pr, baseRef: null }));
    expect(runOf(stacksOf(gone, rules), stackPullRequests(gone), 82, 83)).toEqual({
      why: "Lo can't tell where #82's changes start: its base branch is gone.",
    });
  });
});
