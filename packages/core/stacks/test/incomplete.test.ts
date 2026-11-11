/** Stacks found from reads that left something out make no plan. */

import { readTrunkRules, RepoRef, GithubClient, Token, type TrunkRuleList } from '@lo/github';
import { replayFetch } from '@lo/testing';
import { expect, test } from 'vitest';

import { planConversion, type Facts } from '../src/convert.ts';
import { readOpenPullRequests, stacksOf } from '../src/github.ts';
import { mergeOneLayerAtATime } from '../src/merge.ts';
import { findStacks, type Gap } from '../src/stacks.ts';
import { pr } from './support.ts';

const OFFERED: Facts = { stacksApi: true, queued: [] };

/** The playground's recorded stack, as the poller reads it. */
async function playground() {
  const repo = new RepoRef('rozed-dev', 'playground');
  const github = new GithubClient({
    fetch: replayFetch('stacks_playground'),
    token: new Token('gho_FAKE'),
  });
  const rules = await readTrunkRules(github, repo, undefined, []);
  const list = await readOpenPullRequests(github, repo, rules, Date.now());
  return { list, rules };
}

test('stacks from whole reads have no gaps and plan as before', async () => {
  const { list, rules } = await playground();
  const stacks = stacksOf(list, rules);
  expect(stacks.gaps).toEqual([]);
  expect(mergeOneLayerAtATime(stacks, 2)).toMatchObject({ pr: 1, into: 'main' });
  // Already a GitHub stack, which is a reason of its own, not a gap.
  expect(planConversion(stacks, 2, OFFERED)).toEqual({
    kind: 'notOffered',
    reasons: [{ kind: 'alreadyStacked', stack: 3 }],
  });
});

test('lookups cut short leave a gap that refuses every plan', async () => {
  const { list, rules } = await playground();
  const stacks = stacksOf({ ...list, mergedTruncated: true }, rules);
  const gaps: Gap[] = [{ kind: 'mergedPullRequests' }];
  expect(stacks.gaps).toEqual(gaps);
  expect(mergeOneLayerAtATime(stacks, 2)).toEqual({ refusal: 'incomplete', gaps });
  expect(planConversion(stacks, 2, OFFERED)).toEqual({
    kind: 'notOffered',
    reasons: [{ kind: 'incomplete', gaps }],
  });
});

test('unread rulesets and a list cut short are gaps too', async () => {
  const { list } = await playground();
  const rules: TrunkRuleList = { rulesets: [], unavailable: 'GitHub answered 502' };
  const stacks = stacksOf({ ...list, truncated: true }, rules);
  const gaps: Gap[] = [
    { kind: 'openPullRequests' },
    { kind: 'rulesets', why: 'GitHub answered 502' },
  ];
  expect(stacks.gaps).toEqual(gaps);
  expect(mergeOneLayerAtATime(stacks, 1)).toEqual({ refusal: 'incomplete', gaps });
});

test('a chain on a merged prs dead branch gets no plan while its lookups are cut short', () => {
  // #2's lower layer merged, and its branch wasn't looked up: #2 sits on that dead branch as a
  // root, so a merge would go into it.
  const found = findStacks([pr(2, 'a', 'b'), pr(3, 'b', 'c')], []);
  expect(mergeOneLayerAtATime(found, 3)).toMatchObject({ pr: 2, into: 'a' });
  const gaps: Gap[] = [{ kind: 'mergedPullRequests' }];
  const stacks = { ...found, gaps };
  expect(mergeOneLayerAtATime(stacks, 3)).toEqual({ refusal: 'incomplete', gaps });
  expect(planConversion(stacks, 3, OFFERED)).toEqual({
    kind: 'notOffered',
    reasons: [{ kind: 'incomplete', gaps }],
  });
});
