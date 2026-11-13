// Where the layer on screen's diff starts, from what the app's cassette recorded of rozed-dev/e2e:
// #84 on #83 by the commits they share, #87 on #86, which was squash-merged, and #89 on #88 in a
// GitHub stack.

import { openPullRequest, type OpenPullRequestList } from '@lo/github';
import { stackPullRequests, stacksOf } from '@lo/stacks';
import { describe, expect, it } from 'vitest';

import { offer as offerSchema } from '../contract.ts';
import { planStart, type StartForest, type StartView } from './starts.ts';
import { changePull, E2E, recorded } from './test/support.ts';

/** The forest of `list`, as the finder keeps it. */
function forestOf(list: OpenPullRequestList, rules: Parameters<typeof stacksOf>[1]): StartForest {
  return { stacks: stacksOf(list, rules), prs: stackPullRequests(list), list };
}

/** The head `list` gives pull request `number`. */
function headOf(list: OpenPullRequestList, number: number): string {
  const head = openPullRequest(list, number)?.headRefOid;
  if (head === undefined) throw new Error(`#${number} isn't open`);
  return head;
}

/** Pull request `number`'s layer on screen at the head `list` gives it, drawn or not. */
function view(list: OpenPullRequestList, number: number, more: Partial<StartView> = {}) {
  return {
    number,
    head: headOf(list, number),
    compareFrom: undefined,
    drawn: false,
    missing: false,
    ...more,
  };
}

describe('where a layer’s diff starts', () => {
  it('is set before its diff is drawn: at the layer below’s head, or the merged layer’s last commit', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const forest = forestOf(list, rules);
    expect(planStart(view(list, 84), forest, undefined)).toMatchObject({
      start: { kind: 'sharedCommits', below: 83 },
      set: headOf(list, 83),
      offer: undefined,
    });
    expect(planStart(view(list, 87), forest, undefined)).toMatchObject({
      start: { kind: 'needsRebase', merged: 86 },
      set: 'a5f519461fbac8b315f978b48deb5cf66ca22a22',
    });
    // A GitHub stack's layer starts at its base branch, as GitHub's diff does: nothing changes.
    expect(planStart(view(list, 89), forest, undefined)).toMatchObject({
      start: { kind: 'baseBranch', branch: 'stack/g1' },
      set: undefined,
      offer: undefined,
    });
    // Nor for a layer already compared where it starts.
    const set = view(list, 84, { compareFrom: headOf(list, 83) });
    expect(planStart(set, forest, undefined)).toMatchObject({ set: undefined, offer: undefined });
  });

  it('is offered once its diff is drawn, never set', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const forest = forestOf(list, rules);
    const shared = planStart(view(list, 84, { drawn: true }), forest, undefined);
    expect(shared.set).toBeUndefined();
    expect(offerSchema.parse(shared.offer)).toEqual({
      title: "#84's diff includes #83's changes.",
      action: "Show only #84's",
      commit: headOf(list, 83),
    });
    expect(planStart(view(list, 87, { drawn: true }), forest, undefined).offer).toEqual({
      title: "#87's diff includes #86's, which was squash-merged.",
      action: 'Hide them',
      commit: 'a5f519461fbac8b315f978b48deb5cf66ca22a22',
    });
  });

  it('offers the base branch once the layer no longer sits on the one it’s compared with', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const below = headOf(list, 83);
    // #84 was rebased onto stack/root, with none of #82's or #83's commits.
    const own = 'c'.repeat(40);
    const rebased = changePull(list, 84, (pr) => ({
      ...pr,
      headRefOid: own,
      commits: { ...pr.commits, nodes: [{ commit: { oid: own } }] },
    }));
    const forest = forestOf(rebased, rules);
    const layer = view(rebased, 84, { compareFrom: below, drawn: true });
    expect(planStart(layer, forest, undefined)).toMatchObject({
      set: undefined,
      offer: {
        title: '#84 no longer sits on #83.',
        action: 'Compare with stack/root',
        commit: null,
      },
    });
    // Not drawn yet, it's taken back at once.
    expect(planStart({ ...layer, drawn: false }, forest, undefined)).toMatchObject({
      set: null,
      offer: undefined,
    });
  });

  it('is taken back while nothing is drawn when the stack was found at another head', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const forest = forestOf(list, rules);
    // The list is from before a push to #84, so where #84's head on screen starts isn't known.
    const pushed = view(list, 84, { head: 'd'.repeat(40), compareFrom: headOf(list, 83) });
    expect(planStart(pushed, forest, undefined)).toMatchObject({ start: undefined, set: null });
    // Drawn, it's left as it is, and nothing is offered.
    expect(planStart({ ...pushed, drawn: true }, forest, undefined)).toMatchObject({
      set: undefined,
      offer: undefined,
    });
    // Nor is anything set while the stacks aren't known.
    expect(planStart(view(list, 84), undefined, undefined)).toMatchObject({ set: undefined });
  });

  it('says why when the local copy couldn’t get the commit', async () => {
    const { list, rules } = await recorded('app_stack', E2E);
    const forest = forestOf(list, rules);
    const layer = view(list, 84, { compareFrom: headOf(list, 83), missing: true });
    expect(planStart(layer, forest, undefined).note).toEqual({
      kind: 'start',
      text: "Lo couldn't fetch #83's head, so #84's diff includes #83's changes.",
    });
  });
});
