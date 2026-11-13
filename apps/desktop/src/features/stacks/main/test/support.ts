// What the stacks feature's main tests share: a repository's open pull requests, rulesets and
// layers' state as recorded cassettes hold them, and ways to change what GitHub said, for what it
// can't be made to show on demand.

import {
  GithubClient,
  openPullRequest,
  readStackLayers,
  readTrunkRules,
  RepoRef,
  Token,
  type MergedPullRequest,
  type OpenPullRequest,
  type OpenPullRequestList,
  type StackLayer,
  type StackLayerList,
  type TrunkRuleList,
} from '@lo/github';
import { readOpenPullRequests, stacksOf, type Stacks } from '@lo/stacks';
import { replayFetch } from '@lo/testing';

/** rozed-dev/e2e, where the recorded stacks are. */
export const E2E = new RepoRef('rozed-dev', 'e2e');

/** What a cassette holds of a repository's stacks. */
export interface Recorded {
  list: OpenPullRequestList;
  rules: TrunkRuleList;
  /** The layers' state, read for the pull requests numbered as asked, in that order. */
  layers: StackLayerList | undefined;
}

/**
 * What `cassette` recorded of `repo`: its rulesets, its open pull requests with the merged ones
 * looked up, and, given `layers`, the state of those pull requests, asked for in that order.
 */
export async function recorded(
  cassette: string,
  repo: RepoRef,
  layers?: readonly number[],
): Promise<Recorded> {
  const github = new GithubClient({ fetch: replayFetch(cassette), token: new Token('gho_FAKE') });
  const now = Date.now();
  const rules = await readTrunkRules(github, repo, undefined, []);
  const list = await readOpenPullRequests(github, repo, rules, now);
  const read = layers && (await readStackLayers(github, repo, idsOf(list, layers), undefined, now));
  return { list, rules, layers: read };
}

/** The node IDs of the open pull requests numbered `numbers`, in that order. */
export function idsOf(list: OpenPullRequestList, numbers: readonly number[]): string[] {
  return numbers.map((number) => openPullRequest(list, number)?.id ?? '');
}

/** The stacks in `recorded`. */
export function forestOf({ list, rules }: Recorded): Stacks {
  return stacksOf(list, rules);
}

/** `list`, with `change` made to its open pull request numbered `number`. */
export function changePull(
  list: OpenPullRequestList,
  number: number,
  change: (pr: OpenPullRequest) => OpenPullRequest,
): OpenPullRequestList {
  return {
    ...list,
    pullRequests: list.pullRequests.map((pr) => (pr.number === number ? change(pr) : pr)),
  };
}

/**
 * `app_stack`'s list as GitHub gave it once `g S` on #84 made #82, #83 and #84 GitHub stack #92, as
 * `app_stack_convert` recorded it: #84's base is #83's head branch now, and #85 still sits on #82,
 * where a GitHub stack can't branch.
 */
export function convertedAppStack(list: OpenPullRequestList): OpenPullRequestList {
  const below = openPullRequest(list, 83);
  if (!below) throw new Error("#83 isn't open");
  const layers = [82, 83, 84];
  const stacked = layers.reduce(
    (changed, number, index) =>
      changePull(changed, number, (pr) => ({
        ...pr,
        stackEntry: {
          position: index + 1,
          stack: { number: 92, size: layers.length, baseRefName: 'stack/root' },
        },
      })),
    list,
  );
  return changePull(stacked, 84, (pr) => ({
    ...pr,
    baseRefName: below.headRefName,
    baseRefOid: below.headRefOid,
    baseRef: { target: { __typename: 'Commit', oid: below.headRefOid }, refUpdateRule: null },
  }));
}

/** `layers`, with `change` made to the state of the layer numbered `number`. */
export function changeLayer(
  layers: StackLayerList,
  number: number,
  change: (layer: StackLayer) => StackLayer,
): StackLayerList {
  return {
    ...layers,
    layers: layers.layers.map((layer) => (layer.number === number ? change(layer) : layer)),
  };
}

/**
 * `list` once its open pull request numbered `number` merged with a merge commit, so its head is in
 * its base branch, or closed without merging, which leaves it out.
 */
export function leaving(
  list: OpenPullRequestList,
  number: number,
  how: 'merged' | 'closed',
): OpenPullRequestList {
  const pr = openPullRequest(list, number);
  if (!pr) throw new Error(`#${number} isn't open`);
  const left = { ...list, pullRequests: list.pullRequests.filter((open) => open !== pr) };
  if (how === 'closed') return left;
  const merged: MergedPullRequest = {
    number: pr.number,
    createdAt: pr.createdAt,
    baseRefName: pr.baseRefName,
    baseRef: pr.baseRef && { target: pr.baseRef.target, refUpdateRule: pr.baseRef.refUpdateRule },
    headRefName: pr.headRefName,
    headRefOid: pr.headRefOid,
    isCrossRepository: pr.isCrossRepository,
    commits: pr.commits,
    mergeCommit: { oid: 'f'.repeat(40), parents: { nodes: [{ oid: pr.headRefOid }] } },
    stackEntry: pr.stackEntry && {
      position: pr.stackEntry.position,
      stack: pr.stackEntry.stack && { number: pr.stackEntry.stack.number },
    },
  };
  return { ...left, merged: [...left.merged, merged] };
}
