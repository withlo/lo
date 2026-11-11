/**
 * Stacks found in recorded answers, and in answers made up for what GitHub can't be made to show
 * on demand. Every recording is as rozed-bot, read only:
 *
 * - `rozed-dev/playground`: GitHub stack #3, #1 (`stack-a` → `main`) under #2 (`stack-b` →
 *   `stack-a`).
 * - `rozed-dev/e2e`: a tree, #2 a → main, #3 b → a, #4 c → b, #5 e → b and #6 d → main holding c,
 *   with GitHub stack #9 (#7, #8) beside it; and #11 y → `e3/x` on #10 x, squash-merged.
 * - `github/gh-stack` and `cli/cli`, read by an account that can't administer them: rulesets and
 *   branch protection as a reader sees them, and cli/cli's eight-layer GitHub stack.
 */

import {
  BRANCHES_A_REQUEST,
  GithubClient,
  MAX_BRANCH_LOOKUPS,
  MERGED_PER_BRANCH,
  movedFrom,
  noTrunkRules,
  openPullRequest,
  openPullRequestsPaged,
  PAGE_SIZE,
  readStackLayers,
  readTrunkRules,
  RECENTLY_UPDATED_MERGED,
  RepoRef,
  stackLayer,
  Token,
  branchesToCheck,
  viewedFiles,
  type MergedPullRequest,
  type OpenPullRequestList,
  type TrunkRuleList,
} from '@lo/github';
import {
  isObject,
  Replay,
  replayFetch,
  type Interaction,
  type Json,
  type ReplayFetch,
} from '@lo/testing';
import { expect, test } from 'vitest';

import {
  fromMerged,
  lookUpMerged,
  readOpenPullRequests,
  stackPullRequests,
  stacksOf,
  trunksOf,
} from '../src/github.ts';
import { layerOf, stackOf, type Parent, type Rule, type Stacks } from '../src/stacks.ts';
import { isTrunk, trunksAmong } from '../src/trunks.ts';

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

/**
 * What a recorded cassette holds for `repo`'s stacks: its open pull requests, with the merged ones
 * looked up, its trunk rules, and its client, for the layers.
 */
async function readRecorded(
  cassette: string,
  repo: RepoRef,
): Promise<{ list: OpenPullRequestList; rules: TrunkRuleList; github: GithubClient }> {
  const github = client(replayFetch(cassette));
  const rules = await readTrunkRules(github, repo, undefined, []);
  const list = await readOpenPullRequests(github, repo, rules, NOW);
  return { list, rules, github };
}

/** The node IDs of `numbers`, in that order. */
function ids(list: OpenPullRequestList, numbers: readonly number[]): string[] {
  return numbers.map((number) => openPullRequest(list, number)?.id ?? '');
}

/** Each layer of the stack holding `number`, with its depth. */
function walk(stacks: Stacks, number: number): [number, number][] {
  return (stackOf(stacks, number)?.layers ?? []).map((layer) => [
    layer,
    layerOf(stacks, layer)?.depth ?? -1,
  ]);
}

function roots(stacks: Stacks): string[] {
  return stacks.roots.map((root) => root.branch);
}

/** What `number` sits on, and by which rule. */
function link(stacks: Stacks, number: number): [Parent | undefined, Rule | undefined] {
  const layer = layerOf(stacks, number);
  return [layer?.parent, layer?.rule];
}

function onBranch(branch: string): Parent {
  return { kind: 'branch', branch };
}

function onPr(number: number): Parent {
  return { kind: 'pr', number };
}

/** Whether a merged pull request's head is in its base branch. */
function headInBase(pr: MergedPullRequest): boolean | undefined {
  const { state } = fromMerged(pr);
  return state.kind === 'merged' ? state.headInBase : undefined;
}

test('the playgrounds github stack', async () => {
  const playground = new RepoRef('rozed-dev', 'playground');
  const { list, rules, github } = await readRecorded('stacks_playground', playground);
  // Each read costs a point.
  expect(github.rateLimits().lastGraphQLCost).toBe(1);
  expect(rules).toEqual(noTrunkRules());
  const trunks = trunksOf(list, rules);
  expect(trunks.defaultBranch).toBe('main');
  expect(trunks.protected).toEqual([]);
  expect(list.merged).toEqual([]);

  // As finding stacks takes them: the base branch's tip now, which is the lower layer's head, and
  // the commits, the head last.
  const [upper, lower] = stackPullRequests(list);
  if (!upper || !lower) throw new Error('two open pull requests, newest first');
  expect([upper.number, lower.number]).toEqual([2, 1]);
  expect(upper.baseTip).toBe(lower.headOid);
  expect(upper.commits.at(-1)).toBe(upper.headOid);
  expect(upper.headInBaseRepo).toBe(true);
  expect(upper.nativeStack).toEqual({ stack: 3, position: 2 });

  const stacks = stacksOf(list, rules);
  expect(roots(stacks)).toEqual(['main']);
  expect(walk(stacks, 2)).toEqual([
    [1, 0],
    [2, 1],
  ]);
  expect(link(stacks, 1)).toEqual([onBranch('main'), undefined]);
  expect(link(stacks, 2)).toEqual([onPr(1), 'nativeStack']);
  const top = layerOf(stacks, 2);
  expect([top?.needsRebase, top?.retargetTo]).toEqual([undefined, undefined]);

  const pr = openPullRequest(list, 2);
  expect(pr?.author?.login).toBe('rozed-bot');
  expect(pr?.title).toBe('feat: stack layer B');
  const layers = await readStackLayers(github, playground, ids(list, [1, 2]), undefined, NOW);
  expect(github.rateLimits().lastGraphQLCost).toBe(1);
  expect(layers.layers.map((layer) => layer.number)).toEqual([1, 2]);
  const layer = stackLayer(layers, pr?.id ?? '');
  if (!layer) throw new Error('no layer for #2');
  expect(layer.reviewDecision).toBeNull();
  expect(layer.statusCheckRollup).toBeNull();
  expect(layer.isInMergeQueue).toBe(false);
  expect(movedFrom(layer)).toBeUndefined();
  expect(viewedFiles(layer)).toEqual({ viewed: 0, files: 1, complete: true });
  expect(layers.merged).toEqual([]);
});

/** The full SHA of x's (#10) head: what #11 compares against until it's rebased. */
const X_HEAD = 'e86aa486704016ee033d555bcca81e33898c5608';

/** y (#11) still targets `e3/x`, whose pull request (#10) was squash-merged into `main`. */
function expectE3NeedsRebase(stacks: Stacks): void {
  expect(link(stacks, 11)).toEqual([onBranch('main'), 'baseBranch']);
  const y = layerOf(stacks, 11);
  expect(y?.needsRebase).toEqual({ merged: 10, compareAgainst: X_HEAD });
  // Made a GitHub stack, it would target `main`.
  expect(y?.retargetTo).toBe('main');
  expect(walk(stacks, 11)).toEqual([[11, 0]]);
}

test('e2s tree and github stack and e3s rebase', async () => {
  const e2e = new RepoRef('rozed-dev', 'e2e');
  const { list, rules, github } = await readRecorded('stacks_e2e', e2e);
  // x is among the merged pull requests updated most recently. All three were squashed.
  expect(list.merged.map((pr) => [pr.number, headInBase(pr)])).toEqual([
    [15, false],
    [12, false],
    [10, false],
  ]);
  const x = list.merged.find((pr) => pr.number === 10);
  expect([x?.headRefName, x?.headRefOid]).toEqual(['e3/x', X_HEAD]);
  expect(x && fromMerged(x).commits.at(-1)).toBe(X_HEAD);
  // The bases of the later pull requests have no pull request of their own: one request looks them
  // all up, and finds nothing.
  expect(list.lookups.map((lookup) => [lookup.branch, lookup.found.length])).toEqual([
    ['e10/base', 0],
    ['e12/base', 0],
    ['e6/base', 0],
    ['e8/base', 0],
    ['e9/base', 0],
  ]);
  expect(list.lookups.every((lookup) => lookup.tip !== undefined)).toBe(true);
  expect(list.mergedTruncated).toBe(false);

  const stacks = stacksOf(list, rules);
  expect(stacks.cycles).toEqual([]);
  expect(roots(stacks)).toEqual(['main', 'e10/base', 'e12/base', 'e6/base', 'e8/base', 'e9/base']);
  // A stack for each bottom layer on `main`, oldest first: the tree, its GitHub stack, y (whose x
  // merged), the revisions pull request, and the later ones.
  expect(stacks.roots[0]?.stacks.map((stack) => stack.layers[0])).toEqual([2, 7, 11, 16, 17]);

  // a, b, then c and e on b in the order they were opened, and d on c.
  expect(walk(stacks, 2)).toEqual([
    [2, 0],
    [3, 1],
    [4, 2],
    [6, 3],
    [5, 2],
  ]);
  expect(layerOf(stacks, 3)?.children).toEqual([4, 5]);
  expect([3, 4, 5].map((number) => layerOf(stacks, number)?.rule)).toEqual([
    'baseBranch',
    'baseBranch',
    'baseBranch',
  ]);
  // d targets `main` but holds c's head: only shared commits link it, to the nearest layer it
  // holds, c rather than b or a.
  const d = layerOf(stacks, 6);
  expect(link(stacks, 6)).toEqual([onPr(4), 'sharedCommits']);
  expect(d?.retargetTo).toBe('e2/c');
  expect(d?.needsRebase).toBeUndefined();

  // The GitHub stack wins over the base branch, which links s2 to s1 too.
  expect(walk(stacks, 8)).toEqual([
    [7, 0],
    [8, 1],
  ]);
  expect(link(stacks, 8)).toEqual([onPr(7), 'nativeStack']);

  expectE3NeedsRebase(stacks);

  const asked = ids(list, [2, 3, 4, 6, 5, 7, 8, 11, 19]);
  const layers = await readStackLayers(github, e2e, asked, undefined, NOW);
  expect(layers.ids).toEqual(asked);
  expect(layers.layers.map((layer) => layer.number)).toEqual([2, 3, 4, 6, 5, 7, 8, 11, 19]);
  // d changes the files of a, b and c, and its own.
  const dLayer = stackLayer(layers, asked[3] ?? '');
  if (!dLayer) throw new Error('no layer for d');
  expect(viewedFiles(dLayer)).toEqual({ viewed: 0, files: 4, complete: true });
  expect(dLayer.headRefOid).toBe(openPullRequest(list, 6)?.headRefOid);
  // The script that made these pull requests changed #19's base from `main` to `e8/base`, which
  // shows as the branch it moved from; no merged pull request came from `main`. No other layer
  // moved: e3/x is still there.
  const moved = layers.layers.flatMap((layer) => {
    const from = movedFrom(layer);
    return from === undefined ? [] : [[layer.number, from]];
  });
  expect(moved).toEqual([[19, 'main']]);
  expect(layers.merged).toEqual([]);
  expect(layers.lookupsFailed).toBeUndefined();
});

test('e3s merged layer is looked up by its branch', async () => {
  const e2e = new RepoRef('rozed-dev', 'e2e');
  const fetch = replayFetch('stacks_e2e_looked_up');
  const github = client(fetch);
  const list = await openPullRequestsPaged(github, e2e, PAGE_SIZE, 0);
  await lookUpMerged(github, e2e, list, undefined, noTrunkRules(), NOW);
  // Without the merged pull requests updated most recently, `e3/x`, which y targets, is looked up
  // with the later pull requests' bases, in one request.
  expect(fetch.seen).toHaveLength(2);
  const request = JSON.parse(new TextDecoder().decode(fetch.seen[1]?.body)) as unknown;
  expect(request).toMatchObject({
    operationName: 'MergedPullRequests',
    variables: { b2: 'e3/x' },
  });
  expect(list.merged.map((pr) => pr.number)).toEqual([10]);
  expectE3NeedsRebase(stacksOf(list, noTrunkRules()));
});

test('policy rulesets for every branch name no trunks', async () => {
  const ghStack = new RepoRef('github', 'gh-stack');
  const { list, rules, github } = await readRecorded('stacks_gh_stack', ghStack);
  // A reader sees the rulesets, the organization's too. Copilot reviews on `~ALL` and license
  // scanning on the default branch only enforce a policy; the default branch's pull requests and
  // the enterprise release branches' gate merging.
  expect(rules.unavailable).toBeUndefined();
  expect(rules.rulesets.map((ruleset) => [ruleset.include[0], ruleset.gatesMerging])).toEqual([
    ['~ALL', false],
    ['~DEFAULT_BRANCH', false],
    ['refs/heads/enterprise-2.*-release', true],
    ['refs/heads/enterprise-*.*.*-release', true],
    ['refs/heads/enterprise-*.*-release', true],
    ['~DEFAULT_BRANCH', true],
  ]);
  const trunks = trunksOf(list, rules);
  expect(isTrunk(trunks, 'enterprise-3.18-release')).toBe(true);
  expect(isTrunk(trunks, 'enterprise-3.18.1-backport-2')).toBe(false);
  expect(trunksAmong(trunks, stackPullRequests(list))).toEqual(['main']);

  // Every open pull request sits on `main` by itself, none of them a trunk.
  const stacks = stacksOf(list, rules);
  const heads = list.pullRequests.map((pr) => pr.headRefName);
  expect(heads.filter((head) => isTrunk(trunks, head))).toEqual([]);
  const links = list.pullRequests.map((pr) => link(stacks, pr.number));
  expect(links).toEqual(list.pullRequests.map(() => [onBranch('main'), undefined]));
  // Merged pull requests keep their place in a GitHub stack.
  const merged = list.merged.find((pr) => pr.number === 579);
  expect(merged && fromMerged(merged).nativeStack).toEqual({ stack: 580, position: 2 });

  const every = list.pullRequests.map((pr) => pr.id);
  const layers = await readStackLayers(github, ghStack, every, undefined, NOW);
  expect(layers.layers).toHaveLength(list.pullRequests.length);
  const layer = stackLayer(layers, list.pullRequests[0]?.id ?? '');
  expect(layer?.reviewDecision).toBe('REVIEW_REQUIRED');
  expect(layer?.statusCheckRollup?.state).toBe('SUCCESS');
});

test('a reader sees branch protection through pull requests', async () => {
  const cli = new RepoRef('cli', 'cli');
  const { list, rules, github } = await readRecorded('stacks_cli', cli);
  // rozed-bot can't administer cli/cli, so the repository's list of branch protection rules would
  // be empty; `trunk`'s rule shows on the pull requests that target it. The one ruleset, Copilot
  // reviews on `~ALL`, gates nothing.
  expect(rules.rulesets.map((ruleset) => [ruleset.include, ruleset.gatesMerging])).toEqual([
    [['~ALL'], false],
  ]);
  const trunks = trunksOf(list, rules);
  expect(trunks.defaultBranch).toBe('trunk');
  expect(trunks.protected).toEqual(['trunk']);

  // A contributor's drafts: a GitHub stack of eight layers on `trunk`.
  const stacks = stacksOf(list, rules);
  const bottom = list.pullRequests.find(
    (pr) => pr.headRefName === 'williammartin-multiaccount-draft-01-account',
  );
  const walked = walk(stacks, bottom?.number ?? 0);
  expect(walked.map(([, depth]) => depth)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  const numbers = walked.map(([number]) => number);
  expect(link(stacks, numbers[0] ?? 0)).toEqual([onBranch('trunk'), undefined]);
  expect(numbers.slice(1).map((number) => link(stacks, number))).toEqual(
    numbers.slice(0, -1).map((below) => [onPr(below), 'nativeStack']),
  );
  const layers = await readStackLayers(github, cli, ids(list, numbers), undefined, NOW);
  expect(layers.layers).toHaveLength(8);
});

// Answers made up about `o/r`, whose default branch is `main`.

type JsonObject = { [key: string]: Json };

function object(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

const REPO = new RepoRef('o', 'r');

/** A GraphQL answer to `operation` asked with `variables`. */
function answer(operation: string, variables: Json, data: Json): Interaction {
  return {
    request: { method: 'POST', url: 'https://api.github.com/graphql', operation, variables },
    response: { status: 200, headers: {}, body: { data } },
  };
}

function replay(answers: Interaction[]): ReplayFetch {
  return replayFetch(new Replay('made_up', answers));
}

/** A commit's SHA, made from a name. */
function oid(name: string): string {
  return name.padStart(40, '0');
}

function commits(names: readonly string[]): Json {
  return { nodes: names.map((name) => ({ commit: { oid: oid(name) } })) };
}

/**
 * An open pull request `head` → `base` holding the commits `names`, oldest first. Its base branch's
 * tip is `base`'s, and neither branch is protected.
 */
function openPr(number: number, base: string, head: string, names: readonly string[]): JsonObject {
  return {
    id: `PR_${number}`,
    number,
    title: 't',
    isDraft: false,
    createdAt: `2026-11-06T08:${String(number).padStart(2, '0')}:00Z`,
    updatedAt: '2026-11-06T09:00:00Z',
    author: null,
    baseRefName: base,
    baseRefOid: oid(base),
    baseRef: { target: { __typename: 'Commit', oid: oid(base) }, refUpdateRule: null },
    headRefName: head,
    headRefOid: oid(names.at(-1) ?? ''),
    headRef: { refUpdateRule: null },
    isCrossRepository: false,
    headRepositoryOwner: null,
    commits: commits(names),
    stackEntry: null,
  };
}

/** `pr`, its base or head branch (`end`, `baseRef` or `headRef`) protected by the rule `pattern`. */
function protectedBy(pr: JsonObject, end: 'baseRef' | 'headRef', pattern: string): JsonObject {
  const copy = structuredClone(pr);
  object(copy[end])['refUpdateRule'] = { pattern };
  return copy;
}

/**
 * A merged pull request `head` → `base` holding the commits `names`, merged by `merge`: `squash`, a
 * commit with only the base for a parent, or `merge`, a merge commit of the base and head.
 */
function mergedPr(
  number: number,
  base: string,
  head: string,
  names: readonly string[],
  merge: 'squash' | 'merge',
): JsonObject {
  const headOid = oid(names.at(-1) ?? '');
  const parents =
    merge === 'squash' ? [{ oid: oid(base) }] : [{ oid: oid(base) }, { oid: headOid }];
  return {
    number,
    createdAt: `2026-11-06T07:${String(number).padStart(2, '0')}:00Z`,
    baseRefName: base,
    baseRef: { target: { __typename: 'Commit', oid: oid(base) }, refUpdateRule: null },
    headRefName: head,
    headRefOid: headOid,
    isCrossRepository: false,
    commits: commits(names),
    mergeCommit: { oid: oid(`${merge}${number}`), parents: { nodes: parents } },
    stackEntry: null,
  };
}

/** The one page of open pull requests `open`, with `merged`, `recently` of which were asked for. */
function openPage(open: Json[], merged: Json[], recently: number): Interaction {
  return answer(
    'OpenPullRequests',
    { owner: 'o', name: 'r', first: 100, after: null, merged: recently },
    {
      rateLimit: null,
      repository: {
        defaultBranchRef: { name: 'main' },
        pullRequests: {
          totalCount: open.length,
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: open,
        },
        mergedPullRequests: { nodes: merged },
      },
    },
  );
}

/** The merged pull requests found looking up `branches`, at most ten: `found` from each in turn. */
function lookedUp(branches: readonly string[], found: Json[][]): Interaction {
  const variables: JsonObject = { owner: 'o', name: 'r', first: MERGED_PER_BRANCH };
  const repository: JsonObject = {};
  for (let index = 0; index < BRANCHES_A_REQUEST; index++) {
    variables[`b${index}`] = branches[index] ?? branches[0] ?? '';
    repository[`b${index}`] = { nodes: found[index] ?? [] };
  }
  return answer('MergedPullRequests', variables, { rateLimit: null, repository });
}

/** A layer as `StackLayers` reads it, moved by GitHub from `from` if it was. */
function layerNode(number: number, from: string | undefined): Json {
  const events =
    from === undefined ? [] : [{ __typename: 'AutomaticBaseChangeSucceededEvent', oldBase: from }];
  return {
    __typename: 'PullRequest',
    id: `PR_${number}`,
    number,
    state: 'OPEN',
    headRefOid: oid('head'),
    reviewDecision: null,
    statusCheckRollup: null,
    isInMergeQueue: false,
    mergeQueueEntry: null,
    files: { totalCount: 0, nodes: [] },
    movedFrom: { nodes: events },
  };
}

function layersAnswer(asked: string[], nodes: Json[]): Interaction {
  return answer('StackLayers', { ids: asked }, { rateLimit: null, nodes });
}

/** A ruleset as `TrunkRules` reads it. */
function rulesetOf(
  enforcement: string,
  include: string[],
  exclude: string[],
  rules: string[],
): Json {
  return {
    enforcement,
    conditions: { refName: { include, exclude } },
    rules: { nodes: rules.map((type) => ({ type })) },
  };
}

function trunkRules(rulesets: Json): Interaction {
  return answer(
    'TrunkRules',
    { owner: 'o', name: 'r' },
    { rateLimit: null, repository: { rulesets } },
  );
}

/** The open pull requests `open` and what the merged ones `answers` say, read as the poller reads them. */
async function read(open: Json[], answers: Interaction[]): Promise<OpenPullRequestList> {
  const github = client(replay([openPage(open, [], RECENTLY_UPDATED_MERGED), ...answers]));
  return readOpenPullRequests(github, REPO, noTrunkRules(), NOW);
}

test('a release pull request from a protected branch holds no layers', async () => {
  // Git flow: `develop` is protected, its release pull request targets `main`, and features target
  // `develop`. Someone who can't administer the repository sees `develop`'s rule only on the pull
  // requests from and to it.
  const release = openPr(1, 'main', 'develop', ['d1']);
  const one = openPr(2, 'develop', 'feat-1', ['f1']);
  const two = openPr(3, 'develop', 'feat-2', ['f2']);
  const guarded = await read(
    [
      protectedBy(release, 'headRef', 'develop'),
      protectedBy(one, 'baseRef', 'develop'),
      protectedBy(two, 'baseRef', 'develop'),
    ],
    // `develop` is a trunk, so nothing is looked up.
    [],
  );
  const stacks = stacksOf(guarded, noTrunkRules());
  expect(roots(stacks)).toEqual(['main', 'develop']);
  expect(link(stacks, 1)).toEqual([onBranch('main'), undefined]);
  expect(link(stacks, 2)).toEqual([onBranch('develop'), undefined]);
  expect(link(stacks, 3)).toEqual([onBranch('develop'), undefined]);

  // Without the rule, the release pull request swallows every pull request into `develop`.
  const unguarded = stacksOf(await read([release, one, two], []), noTrunkRules());
  expect(link(unguarded, 2)).toEqual([onPr(1), 'baseBranch']);
  expect(walk(unguarded, 1)).toEqual([
    [1, 0],
    [2, 1],
    [3, 1],
  ]);
});

test('merged layers are looked up down to a trunk', async () => {
  // #3 targets `b`, squash-merged into `a`, which merged into `main` with a merge commit.
  const b = mergedPr(2, 'a', 'b', ['b1'], 'squash');
  const a = mergedPr(1, 'main', 'a', ['a1'], 'merge');
  const c = openPr(3, 'b', 'c', ['b1', 'c1']);
  // `b` hasn't moved since it merged.
  object(object(c['baseRef'])['target'])['oid'] = b['headRefOid'] ?? null;
  const list = await read([c], [lookedUp(['b'], [[b]]), lookedUp(['a'], [[a]])]);
  // `b` was squashed, so its head isn't in `a`. `a`'s merge commit has its head as a parent.
  expect(list.merged.map((pr) => [pr.number, headInBase(pr)])).toEqual([
    [2, false],
    [1, true],
  ]);
  expect(list.mergedTruncated).toBe(false);
  const layer = layerOf(stacksOf(list, noTrunkRules()), 3);
  expect(layer?.parent).toEqual(onBranch('main'));
  expect(layer?.needsRebase?.merged).toBe(2);
});

test('lookups are carried over while their branch stays put', async () => {
  const pr = openPr(2, 'gone', 'y', ['y1']);
  const fetch = replay([openPage([pr], [], RECENTLY_UPDATED_MERGED), lookedUp(['gone'], [[]])]);
  const github = client(fetch);
  const known = await readOpenPullRequests(github, REPO, noTrunkRules(), NOW);
  expect(fetch.seen).toHaveLength(2);
  expect(known.lookups[0]?.tip).toBe(oid('gone'));

  // Read again with nothing moved: no lookup.
  const again = await openPullRequestsPaged(github, REPO, PAGE_SIZE, RECENTLY_UPDATED_MERGED);
  await lookUpMerged(github, REPO, again, known, noTrunkRules(), NOW);
  expect(fetch.seen).toHaveLength(3);
  expect(again.lookups).toEqual(known.lookups);

  // `gone` moved: it's looked up again.
  const moved = structuredClone(pr);
  object(object(moved['baseRef'])['target'])['oid'] = oid('moved');
  const movedFetch = replay([
    openPage([moved], [], RECENTLY_UPDATED_MERGED),
    lookedUp(['gone'], [[]]),
  ]);
  const movedGithub = client(movedFetch);
  const later = await openPullRequestsPaged(movedGithub, REPO, PAGE_SIZE, RECENTLY_UPDATED_MERGED);
  await lookUpMerged(movedGithub, REPO, later, known, noTrunkRules(), NOW);
  expect(movedFetch.seen).toHaveLength(2);
  expect(later.lookups[0]?.tip).toBe(oid('moved'));
});

test('the branches most pull requests target are looked up first', async () => {
  // More branches than the lookups allow, one pull request on each, and three on `busy`.
  const names = Array.from(
    { length: MAX_BRANCH_LOOKUPS + 5 },
    (_, index) => `gone-${String(index).padStart(2, '0')}`,
  );
  const open: Json[] = names.map((name, index) => openPr(index + 10, name, `pr-${index}`, ['x']));
  for (const number of [1, 2, 3]) open.push(openPr(number, 'busy', `busy-${number}`, ['x']));
  const ranked = ['busy', ...names].slice(0, MAX_BRANCH_LOOKUPS);
  const answers: Interaction[] = [];
  for (let start = 0; start < ranked.length; start += BRANCHES_A_REQUEST) {
    answers.push(lookedUp(ranked.slice(start, start + BRANCHES_A_REQUEST), []));
  }
  const list = await read(open, answers);

  expect(list.mergedTruncated).toBe(true);
  expect(list.lookups).toHaveLength(MAX_BRANCH_LOOKUPS);
  expect(list.lookups[0]?.branch).toBe('busy');
});

test('a failed lookup keeps the list', async () => {
  const failed = lookedUp(['gone'], []);
  failed.response = { status: 502, headers: {}, body_text: 'Bad gateway' };
  const list = await read([openPr(2, 'gone', 'y', ['y1'])], [failed]);

  expect(list.pullRequests).toHaveLength(1);
  expect(list.mergedTruncated).toBe(true);
  expect(list.lookups).toEqual([]);
});

test('the merged pull requests updated most recently mark a moved layer', async () => {
  // A was squash-merged and its branch deleted, so GitHub moved B onto `main`. Only A's commits,
  // which B still holds, link B to it.
  const a = mergedPr(1, 'main', 'a', ['a1', 'a2'], 'squash');
  const b = openPr(2, 'main', 'b', ['a1', 'a2', 'b1']);
  const stacksWith = async (recently: number, merged: Json[]) => {
    const github = client(replay([openPage([b], merged, recently)]));
    const list = await openPullRequestsPaged(github, REPO, PAGE_SIZE, recently);
    await lookUpMerged(github, REPO, list, undefined, noTrunkRules(), NOW);
    return stacksOf(list, noTrunkRules());
  };

  const within = await stacksWith(RECENTLY_UPDATED_MERGED, [a]);
  expect(layerOf(within, 2)?.needsRebase).toEqual({ merged: 1, compareAgainst: oid('a2') });
  // Out of the window, nothing marks it.
  const outside = await stacksWith(0, []);
  expect(layerOf(outside, 2)?.needsRebase).toBeUndefined();
});

test('a layer github moved finds the merged layer it sat on', async () => {
  // A was squash-merged and its branch `a` deleted. GitHub moved B onto `main`, and A is outside
  // the window of merged pull requests updated most recently.
  const a = mergedPr(1, 'main', 'a', ['a1', 'a2'], 'squash');
  const b = openPr(2, 'main', 'b', ['a1', 'a2', 'b1']);
  const fetch = replay([
    openPage([b], [], RECENTLY_UPDATED_MERGED),
    layersAnswer(['PR_2'], [layerNode(2, 'a')]),
    lookedUp(['a'], [[a]]),
  ]);
  const github = client(fetch);
  const list = await readOpenPullRequests(github, REPO, noTrunkRules(), NOW);
  expect(layerOf(stacksOf(list, noTrunkRules()), 2)?.needsRebase).toBeUndefined();

  const layers = await readStackLayers(github, REPO, ['PR_2'], undefined, NOW);
  const [moved] = layers.layers;
  expect(moved && movedFrom(moved)).toBe('a');
  expect(layers.lookupsFailed).toBeUndefined();
  const stacks = stacksOf(list, noTrunkRules(), layers.merged);
  expect(layerOf(stacks, 2)?.parent).toEqual(onBranch('main'));
  expect(layerOf(stacks, 2)?.needsRebase?.merged).toBe(1);
  expect(fetch.seen).toHaveLength(3);

  // Read again, the deleted branch's lookup is carried over.
  const again = await readStackLayers(github, REPO, ['PR_2'], layers, NOW);
  expect(again.merged).toEqual(layers.merged);
  expect(fetch.seen).toHaveLength(4);
});

test('rulesets name trunks only when active and gating merges', async () => {
  const rulesets = {
    nodes: [
      rulesetOf('ACTIVE', ['refs/heads/release/*'], [], ['PULL_REQUEST']),
      // Signed commits and Copilot reviews on work branches.
      rulesetOf(
        'ACTIVE',
        ['refs/heads/feature/**/*'],
        [],
        ['REQUIRED_SIGNATURES', 'COPILOT_CODE_REVIEW'],
      ),
      // Being tried out.
      rulesetOf('EVALUATE', ['refs/heads/staging'], [], ['REQUIRED_STATUS_CHECKS']),
      // Every branch but work branches.
      rulesetOf('ACTIVE', ['~ALL'], ['refs/heads/feature/**/*'], ['UPDATE']),
      // Every branch, with no exception.
      rulesetOf('ACTIVE', ['~ALL'], [], ['MERGE_QUEUE']),
      // GitHub's defaults for a new ruleset, on one branch and on a pattern.
      rulesetOf(
        'ACTIVE',
        ['refs/heads/feature/kept', 'refs/heads/feature/next-*'],
        [],
        ['DELETION', 'NON_FAST_FORWARD'],
      ),
    ],
  };
  const github = client(replay([trunkRules(rulesets), openPage([], [], RECENTLY_UPDATED_MERGED)]));
  const rules = await readTrunkRules(github, REPO, undefined, []);
  // All but the one being tried out.
  expect(rules.rulesets.map((found) => found.gatesMerging)).toEqual([
    true,
    false,
    true,
    true,
    false,
  ]);
  const list = await readOpenPullRequests(github, REPO, noTrunkRules(), NOW);
  const trunks = trunksOf(list, rules);
  expect(isTrunk(trunks, 'release/2.0')).toBe(true);
  expect(isTrunk(trunks, 'develop')).toBe(true);
  // Every branch but work branches.
  expect(isTrunk(trunks, 'staging')).toBe(true);
  expect(isTrunk(trunks, 'feature/a')).toBe(false);
  expect(isTrunk(trunks, 'feature/a/b')).toBe(false);
  // Named exactly, whatever it enforces.
  expect(isTrunk(trunks, 'feature/kept')).toBe(true);
  // A pattern that gates nothing.
  expect(isTrunk(trunks, 'feature/next-1')).toBe(false);
});

/** `TrunkRules` refused with GitHub's `FORBIDDEN`, saying `message`. */
function refusedRules(message: string): Interaction {
  const refused = trunkRules(null);
  refused.response.body = {
    data: { rateLimit: null, repository: { rulesets: null } },
    errors: [{ type: 'FORBIDDEN', path: ['repository', 'rulesets'], message }],
  };
  return refused;
}

test('rulesets that cant be read leave the trunks to the rest', async () => {
  const github = client(replay([refusedRules('Resource not accessible by personal access token')]));
  const rules = await readTrunkRules(github, REPO, undefined, []);
  expect(rules.rulesets).toEqual([]);
  expect(rules.unavailable).toContain('Resource not accessible');
  // What was read before is kept.
  const known: TrunkRuleList = {
    rulesets: [{ include: ['refs/heads/develop'], exclude: [], gatesMerging: true }],
    unavailable: undefined,
  };
  const again = await readTrunkRules(github, REPO, known, []);
  expect(again.rulesets).toEqual(known.rulesets);
  expect(again.unavailable).toBeDefined();
});

test('ruleset trunks are never looked up as layers', async () => {
  // `develop` is protected by a ruleset alone, which pull requests' own branches don't show.
  const release = openPr(1, 'main', 'develop', ['d1']);
  const feature = openPr(2, 'develop', 'feat', ['f1']);
  const fetch = replay([
    trunkRules({ nodes: [rulesetOf('ACTIVE', ['refs/heads/develop'], [], ['DELETION'])] }),
    openPage([release, feature], [], RECENTLY_UPDATED_MERGED),
  ]);
  const github = client(fetch);
  const rules = await readTrunkRules(github, REPO, undefined, []);
  const list = await readOpenPullRequests(github, REPO, rules, NOW);
  // No lookup of `develop`: the replay would have no answer for it.
  expect(fetch.seen).toHaveLength(2);
  expect(list.lookups).toEqual([]);
  expect(link(stacksOf(list, rules), 2)).toEqual([onBranch('develop'), undefined]);
});

test('a forks protected head isnt the repositorys', async () => {
  const fork = protectedBy(openPr(1, 'main', 'release', ['r1']), 'headRef', 'release');
  fork['isCrossRepository'] = true;
  const ours = protectedBy(openPr(2, 'main', 'x', ['x1']), 'baseRef', 'main');
  const list = await read([fork, ours], []);

  expect(trunksOf(list, noTrunkRules()).protected).toEqual(['main']);
});

/** The rules REST says apply to `o/r`'s `branch`: one of each type in `types`. */
function rulesOf(branch: string, types: readonly string[]): Interaction {
  return {
    request: { method: 'GET', url: `https://api.github.com/repos/o/r/rules/branches/${branch}` },
    response: {
      status: 200,
      headers: {},
      body: types.map((type) => ({ type, ruleset_id: 1 })),
    },
  };
}

test('branches are checked one by one when the rulesets cant be read', async () => {
  // A release pull request from `develop`, which features target, and a stack `a` ← `b`.
  const open = [
    openPr(1, 'main', 'develop', ['d1']),
    openPr(2, 'develop', 'feat', ['f1']),
    openPr(3, 'main', 'a', ['a1']),
    openPr(4, 'a', 'b', ['b1']),
  ];
  const github = client(
    replay([
      openPage(open, [], RECENTLY_UPDATED_MERGED),
      refusedRules('No'),
      rulesOf('a', ['copilot_code_review']),
      rulesOf('develop', ['deletion', 'pull_request']),
    ]),
  );
  const list = await openPullRequestsPaged(github, REPO, PAGE_SIZE, RECENTLY_UPDATED_MERGED);
  expect(branchesToCheck(list)).toEqual(['a', 'develop']);
  const rules = await readTrunkRules(github, REPO, undefined, branchesToCheck(list));
  expect(rules.unavailable).toBeDefined();
  const stacks = stacksOf(list, rules);
  expect(link(stacks, 2)).toEqual([onBranch('develop'), undefined]);
  expect(link(stacks, 4)).toEqual([onPr(3), 'baseBranch']);
});

test('a lookup that found nothing is read again after a day', async () => {
  const fetch = replay([
    openPage([openPr(2, 'gone', 'y', ['y1'])], [], RECENTLY_UPDATED_MERGED),
    lookedUp(['gone'], [[]]),
  ]);
  const github = client(fetch);
  const known = await readOpenPullRequests(github, REPO, noTrunkRules(), NOW);
  expect(fetch.seen).toHaveLength(2);
  const again = async (at: number) => {
    const list = await openPullRequestsPaged(github, REPO, PAGE_SIZE, RECENTLY_UPDATED_MERGED);
    await lookUpMerged(github, REPO, list, known, noTrunkRules(), at);
  };

  // Carried over within a day.
  await again(NOW + 23 * HOUR);
  expect(fetch.seen).toHaveLength(3);
  // Looked up again after one.
  await again(NOW + 25 * HOUR);
  expect(fetch.seen).toHaveLength(5);
});
