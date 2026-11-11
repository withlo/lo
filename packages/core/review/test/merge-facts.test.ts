/**
 * What decides a merge, read from recorded answers and mapped into the merge snapshot, where
 * `blockers`, `mergeStatus`, `mergeAction` and `approveAndShip` decide with it. Every recording is
 * as rozed-bot, read only:
 *
 * - `rozed-dev/e2e`'s merge states: rozed-bot's own pull requests on two bases whose rulesets
 *   rozed-bot, an admin, reads in full. On `e4/gated`: an approval missing (#25), a failed check
 *   (#26), a run by hand GitHub doesn't count (#27), a conflict whose check never reports (#28), a
 *   draft GitHub reports `BLOCKED` (#29), and an unresolved conversation with no review decision
 *   (#30). On `e4/queued`: a check that failed and passed when run again on the same commit (#34),
 *   and pull requests ready for the queue.
 *
 * The public repositories show what those can't: a reader's part of classic protection, code owner
 * teams, a maintainer's changes requested, checks running or never run, auto-merge, more than 100
 * checks, a merge queue with entries, and rules alone read again for free.
 *
 * - `cli/cli`, which rozed-bot can only read: trunk's classic protection, which a reader sees only
 *   part of, requires an approval, a code owner's (a team rozed-bot can't see) and three build
 *   checks. A failed required check (#13788), conflicts (#12942), a draft (#14781), changes
 *   requested (#13899), a missing approval (#14964), and a first-time contributor's checks that
 *   never ran (#13340).
 * - `microsoft/vscode#346714`: a required check running and two yet to report, and two unresolved
 *   conversations under a rule that requires them resolved.
 * - `pnpm/pnpm#17816`: a code owner, a user, who hasn't approved.
 * - `electron/electron#55594`: approved, auto-merge on, a required check running.
 * - `pytorch/pytorch#115316`: over 100 checks, read a page at a time, and a block Lo can't explain.
 * - `zed-industries/zed`: rulesets alone, which a reader sees all of: a merge queue, squash merges,
 *   code owners and two required checks. Checks that never reported (#66631), and one ready for
 *   the queue (#66650), whose rules are then read again for free.
 * - `flutter/flutter`'s merge queue, and the pull request in it.
 * - `rozed-dev/e2e#16`, rozed-bot's own pull request in a repository it administers.
 *
 * The states no recording shows yet are recorded answers edited here: your pending review, a code
 * owner team you're in, classic protection only an admin sees, with strict status checks, rules
 * that can't be read, a queued build of a required check's app, and parts GitHub leaves out with
 * an error.
 */

import {
  factsOnto,
  GithubClient,
  mergeFactsComplete,
  mergeQueue,
  PullRef,
  queueCutShort,
  queueEntries,
  readMergeFacts,
  RepoRef,
  rulesBase,
  rulesOnto,
  Token,
  type MergeFacts,
} from '@lo/github';
import {
  cassette,
  isObject,
  Replay,
  replayFetch,
  type Interaction,
  type Json,
  type ReplayFetch,
} from '@lo/testing';
import { expect, test } from 'vitest';

import {
  methodList,
  pushNeedsNewApproval,
  type CheckState,
  type MergeSnapshot,
} from '../src/merge.ts';
import { mergeAction } from '../src/merge/action.ts';
import { blockers, isWait, mayNotSeeEveryRule, type Blocker } from '../src/merge/blockers.ts';
import { mergeSnapshot, requiresUpToDate, seesEveryRule, type Local } from '../src/merge/facts.ts';
import { approveAndShip, type Plan } from '../src/merge/ship.ts';
import { mergeStatus } from '../src/merge/status.ts';

const BOT = 'rozed-bot';

function client(fetch: ReplayFetch): GithubClient {
  return new GithubClient({ fetch, token: new Token('gho_FAKE') });
}

/** The GraphQL operations and REST paths a replaying `fetch` was asked, in order. */
function asked(fetch: ReplayFetch): string[] {
  return fetch.seen.map((seen) => {
    const graphql = /"operationName":"(\w+)"/.exec(new TextDecoder().decode(seen.body));
    return graphql?.[1] ?? seen.url.replace('https://api.github.com', '');
  });
}

/** What decides whether each of `numbers` in `owner/name` can merge, read in order from `name`. */
async function read(
  name: string,
  owner: string,
  repo: string,
  numbers: readonly number[],
): Promise<MergeFacts[]> {
  const github = client(replayFetch(name));
  const facts: MergeFacts[] = [];
  for (const number of numbers) {
    facts.push(await readMergeFacts(github, new PullRef(owner, repo, number), BOT));
  }
  return facts;
}

/** The first of `items`, failing the test when there's none. */
function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('nothing was read');
  return item;
}

type JsonObject = { [key: string]: Json };

function object(value: Json | undefined): JsonObject {
  if (!isObject(value)) throw new Error(`expected an object, got ${JSON.stringify(value)}`);
  return value;
}

function list(value: Json | undefined): Json[] {
  if (!Array.isArray(value)) throw new Error(`expected a list, got ${JSON.stringify(value)}`);
  return value;
}

/** `name`'s recorded answers, each edited by `edit` with its file name. */
function edited(name: string, edit: (file: string, interaction: Interaction) => void): ReplayFetch {
  const interactions = cassette(name).interactions.map(({ file, interaction }) => {
    const copy = structuredClone(interaction);
    edit(file, copy);
    return copy;
  });
  return replayFetch(new Replay(name, interactions));
}

/** The pull request in a recorded GraphQL answer. */
function pullRequestOf(interaction: Interaction): JsonObject {
  return object(object(object(object(interaction.response.body).data).repository).pullRequest);
}

/** The snapshot with the head GitHub has on screen and nothing remembered. */
function onScreen(facts: MergeFacts, fields: Partial<Local> = {}): MergeSnapshot {
  return mergeSnapshot(facts, {
    headOnScreen: facts.pullRequest.head,
    preferredMethod: undefined,
    headContainsBase: undefined,
    ...fields,
  });
}

function checkStates(snapshot: MergeSnapshot): [string, CheckState][] {
  return snapshot.requiredChecks.map((check) => [check.name, check.state]);
}

/** The blockers, each by kind, with a check's name. */
function kinds(snapshot: MergeSnapshot): string[] {
  return blockers(snapshot).map((blocker) => {
    if (blocker.kind === 'check') return `check(${blocker.check.name}, ${blocker.check.state})`;
    if (blocker.kind === 'notReported') return `notReported(${blocker.check.name})`;
    return blocker.kind;
  });
}

/** The plan approve and ship makes for `snapshot`, failing the test when it makes none. */
function thePlan(snapshot: MergeSnapshot): Plan {
  const shipping = approveAndShip(snapshot);
  if (shipping.kind !== 'plan') throw new Error(`expected a plan, got ${JSON.stringify(shipping)}`);
  return shipping.plan;
}

const CLI = [13788, 12942, 14781, 13899, 14964, 13340];

async function cli(): Promise<MergeSnapshot[]> {
  return (await read('merge_cli', 'cli', 'cli', CLI)).map((facts) => onScreen(facts));
}

/** The `index`th of cli/cli's pull requests, as {@link CLI} lists them. */
async function cliAt(index: number): Promise<MergeSnapshot> {
  const snapshot = (await cli())[index];
  if (!snapshot) throw new Error(`no pull request ${index}`);
  return snapshot;
}

test('a reader sees trunks protection only in part', async () => {
  const facts = first(await read('merge_cli', 'cli', 'cli', CLI.slice(0, 1)));
  const snapshot = onScreen(facts);

  expect(facts.protection?.complete).toBe(false);
  expect(snapshot.rules.requiredApprovals).toBe(1);
  expect(snapshot.rules.codeOwnerReview).toBe(true);
  expect(snapshot.rules.conversationResolution).toBe(false);
  // Only an admin sees whether trunk wants the head up to date, so Lo can't tell, and may not see
  // every rule.
  expect(requiresUpToDate(facts)).toBe(false);
  expect(snapshot.seesEveryRule).toBe(false);
  // Its only ruleset asks Copilot to review, which never blocks a merge.
  expect(facts.rules.rules).toEqual([{ kind: 'harmless', type: 'copilot_code_review' }]);
  expect(snapshot.methods).toEqual({ merge: true, squash: true, rebase: true });
  expect(snapshot.defaultMethod).toBe('MERGE');

  // rozed-bot can only read cli/cli: it may approve, but its approval doesn't count, and it can't
  // merge.
  const { viewer } = snapshot;
  expect(viewer.login).toBe(BOT);
  expect(viewer.canApprove && !viewer.didAuthor).toBe(true);
  expect(viewer.approvalCounts || viewer.canMerge || viewer.canEnableAutoMerge).toBe(false);
});

test('cli 13788 is blocked by its failed builds and a missing approval', async () => {
  const snapshot = await cliAt(0);

  expect(kinds(snapshot)).toEqual([
    'check(build (ubuntu-latest), failed)',
    'check(build (windows-latest), failed)',
    'check(build (macos-latest), failed)',
    'approvals',
  ]);
  const unlinked = snapshot.requiredChecks.filter(
    (check) => !check.url?.startsWith('https://github.com/cli/cli/actions/runs/'),
  );
  expect(unlinked).toEqual([]);
  expect(mergeStatus(snapshot).kind).toBe('blocked');
  expect(mayNotSeeEveryRule(snapshot)).toBe(true);
  // Approving can't fix failed builds.
  const plan = thePlan(snapshot);
  expect(plan.approval).toEqual({ kind: 'approve' });
  expect(plan.likely).toMatchObject({ kind: 'stop', stop: { kind: 'blocked' } });
});

test('cli 12942 conflicts with trunk', async () => {
  const snapshot = await cliAt(1);

  expect(kinds(snapshot)).toEqual(['conflicts', 'approvals']);
  expect(snapshot.unresolvedThreads).toBe(5);
  // trunk doesn't require resolving them.
  expect(snapshot.rules.conversationResolution).toBe(false);
  expect(mergeAction(snapshot)).toEqual({ kind: 'notPossible', reason: { kind: 'blocked' } });
});

test('cli 14781 is a draft', async () => {
  const snapshot = await cliAt(2);

  expect(snapshot.draft).toBe(true);
  expect(kinds(snapshot)).toEqual(['draft', 'approvals']);
  expect(approveAndShip(snapshot)).toEqual({ kind: 'draft' });
  // Its builds passed, and two queued check suites that will never run (apps that made no check
  // runs) aren't waited on.
  expect(snapshot.checksPending).toBe(false);
  expect(snapshot.requiredChecks.filter((check) => check.state !== 'passed')).toEqual([]);
});

test('cli 13899 has changes requested by a maintainer', async () => {
  const snapshot = await cliAt(3);

  // BagToad's request counts, but not toward the approval still missing.
  expect(blockers(snapshot).slice(0, 2)).toEqual([
    { kind: 'changesRequested', by: ['BagToad'] },
    { kind: 'approvals', more: 1, codeOwners: [] },
  ]);
  // The request for BagToad's review stays after it, and the code owners' team, which rozed-bot
  // can't see, is left out.
  expect(snapshot.reviewRequests.map((request) => request.reviewer)).toEqual([
    { kind: 'user', login: 'BagToad' },
  ]);
});

test('cli 14964 waits only on an approval', async () => {
  const snapshot = await cliAt(4);

  expect(kinds(snapshot)).toEqual(['approvals']);
  expect(blockers(snapshot).every(isWait)).toBe(true);
  expect(mergeStatus(snapshot)).toMatchObject({ kind: 'waiting', autoMerge: false });
  // rozed-bot's approval wouldn't count, and it can't turn on auto-merge.
  expect(thePlan(snapshot).likely).toEqual({
    kind: 'stop',
    stop: { kind: 'noAutoMerge', blockers: blockers(snapshot) },
  });
});

test('cli 13340s required builds never reported', async () => {
  const snapshot = await cliAt(5);

  // A first-time contributor's workflows didn't run, and nothing else will report them.
  expect(snapshot.checksPending).toBe(false);
  expect(kinds(snapshot)).toEqual([
    'notReported(build (macos-latest))',
    'notReported(build (ubuntu-latest))',
    'notReported(build (windows-latest))',
    'approvals',
  ]);
});

test('vscode 346714 waits on its checks and is blocked by its conversations', async () => {
  const facts = first(await read('merge_vscode_346714', 'microsoft', 'vscode', [346714]));
  const snapshot = onScreen(facts);

  // main's classic protection requires resolving every conversation and five checks; a ruleset
  // requires the latest push approved by someone else.
  expect(snapshot.rules.conversationResolution).toBe(true);
  expect(snapshot.rules.lastPushApproval).toBe(true);
  expect(pushNeedsNewApproval(snapshot.rules)).toBe(true);
  expect(snapshot.checksPending).toBe(true);
  expect(checkStates(snapshot)).toEqual([
    ['VS Code PR Check', 'running'],
    ['Dependencies Check', 'passed'],
    ['license/cla', 'passed'],
    ['Screenshots & Tests', 'missing'],
    ['PR Gate', 'missing'],
  ]);
  // The two that haven't reported are waits while a check suite is still running.
  expect(kinds(snapshot)).toEqual([
    'conversations',
    'approvals',
    'check(VS Code PR Check, running)',
    'check(Screenshots & Tests, missing)',
    'check(PR Gate, missing)',
  ]);
  expect(blockers(snapshot)[0]).toEqual({ kind: 'conversations', unresolved: 2 });
  expect(snapshot.seesEveryRule).toBe(false);
});

test('pnpm 17816 waits on its code owner', async () => {
  const facts = first(await read('merge_pnpm_17816', 'pnpm', 'pnpm', [17816]));
  const snapshot = onScreen(facts);

  // Two review bots with write access approved, which meets the count, but not the code owner's
  // review.
  expect(snapshot.reviews).toHaveLength(2);
  expect(blockers(snapshot)).toEqual([
    { kind: 'approvals', more: 0, codeOwners: [{ kind: 'user', login: 'zkochan' }] },
  ]);
  // main requires linear history, and a merge queue through its classic protection.
  expect(snapshot.methods.merge).toBe(false);
  expect(snapshot.queue.required).toBe(true);
});

test('electron 55594 has auto merge on while a required check runs', async () => {
  const facts = first(await read('merge_electron_55594', 'electron', 'electron', [55594]));
  const snapshot = onScreen(facts);

  expect(snapshot.autoMerge).toEqual({ method: 'SQUASH', enabledBy: 'MarshallOfSound' });
  // A ruleset's check, pinned to its app, is still running.
  expect(kinds(snapshot)).toEqual(['check(faraday/cage, running)']);
  expect(mergeStatus(snapshot)).toMatchObject({ kind: 'waiting', autoMerge: true });
  // Its rulesets allow squash merges only, and require signed commits, reviewers by file pattern
  // and workflows, which Lo doesn't model.
  expect(methodList(snapshot.methods)).toEqual(['SQUASH']);
  expect(snapshot.signedCommits).toBe(true);
  expect(snapshot.seesEveryRule).toBe(false);
  expect(mayNotSeeEveryRule(snapshot)).toBe(true);
});

const PYTORCH = new PullRef('pytorch', 'pytorch', 115316);

test('pytorch 115316s checks are read a page at a time', async () => {
  const fetch = replayFetch('merge_pytorch_115316');
  const facts = await readMergeFacts(client(fetch), PYTORCH, BOT);

  expect(asked(fetch)).toEqual([
    'MergeSnapshot',
    'MergeChecks',
    '/repos/pytorch/pytorch/rules/branches/main?per_page=100',
  ]);
  expect([facts.cutShort, facts.leftOut]).toEqual([[], []]);
  expect(mergeFactsComplete(facts)).toBe(true);
  const snapshot = onScreen(facts);
  // None of them is required, and main restricts updates to those who may bypass its rules, which
  // Lo doesn't model: GitHub's block is one Lo can't explain.
  expect(snapshot.requiredChecks).toEqual([]);
  expect(blockers(snapshot)).toEqual([
    { kind: 'unexplained', url: 'https://github.com/pytorch/pytorch/pull/115316' },
  ]);
  expect(facts.rules.rules).toContainEqual({ kind: 'other', type: 'update' });
  // main requires linear history.
  expect(snapshot.methods.merge).toBe(false);
});

const ZED_BLOCKED = new PullRef('zed-industries', 'zed', 66631);
const ZED_READY = new PullRef('zed-industries', 'zed', 66650);

test('zed 66631s required checks never reported', async () => {
  const facts = first(await read('merge_zed', 'zed-industries', 'zed', [66631]));
  const snapshot = onScreen(facts);

  expect(kinds(snapshot)).toEqual(['notReported(danger)', 'notReported(tests_pass)']);
  // Rulesets alone, which a reader sees all of: Lo explains GitHub's block in full.
  expect(facts.protection).toBeUndefined();
  expect(snapshot.seesEveryRule).toBe(true);
  expect(mayNotSeeEveryRule(snapshot)).toBe(false);
  // A first-time contributor's; Copilot's extra approval doesn't apply.
  expect(snapshot.rules.codeOwnerReview).toBe(true);
  expect(snapshot.reviewDecision).toBeUndefined();
});

test('zed 66650 is ready for the queue and its rules are read again for free', async () => {
  const fetch = replayFetch('merge_zed');
  const github = client(fetch);
  await readMergeFacts(github, ZED_BLOCKED, BOT);
  const known = await readMergeFacts(github, ZED_READY, BOT);
  const again = await readMergeFacts(github, ZED_READY, BOT, known);

  // The second read sent the rules' ETag, and GitHub answered 304.
  const etags = fetch.seen
    .filter((seen) => seen.url.includes('/rules/branches/main'))
    .map((seen) => seen.headers.get('if-none-match'));
  expect(etags).toEqual([null, null, known.rules.etag]);
  expect(again).toEqual(known);

  const snapshot = onScreen(known);
  expect(blockers(snapshot)).toEqual([]);
  // The queue's method comes from main's merge_queue rule: GitHub shows its settings only to
  // writers. rozed-bot can't merge.
  expect(snapshot.queue.required).toBe(true);
  expect(snapshot.queue.method).toBe('SQUASH');
  expect(methodList(snapshot.methods)).toEqual(['SQUASH']);
  expect(mergeAction(snapshot)).toEqual({ kind: 'notPossible', reason: { kind: 'noPermission' } });
});

test('flutters merge queue lists its entries and the pull request in it', async () => {
  const github = client(replayFetch('merge_queue_flutter'));
  const queue = await mergeQueue(github, new RepoRef('flutter', 'flutter'), 'master');

  const entries = queueEntries(queue);
  expect(entries).toHaveLength(1);
  expect(queueCutShort(queue)).toBe(false);
  const entry = first(entries);
  expect(entry.position).toBe(1);
  const number = entry.pullRequest?.number ?? 0;
  // Only those who can write see its settings.
  expect(queue.queue?.configuration).toBeNull();

  const facts = await readMergeFacts(github, new PullRef('flutter', 'flutter', number), BOT);
  const snapshot = onScreen(facts);
  expect(snapshot.queue.inQueue).toBe(true);
  expect(snapshot.queue.position).toBe(1);
  expect(mergeAction(snapshot)).toEqual({
    kind: 'notPossible',
    reason: { kind: 'queued', position: 1 },
  });
  // GitHub requires every check run under a required name: three are named Check Code Freeze.
  const freezes = snapshot.requiredChecks.filter((check) => check.name === 'Check Code Freeze');
  expect(freezes).toHaveLength(3);
});

test('e2e 16 is the bots own and merges as it likes', async () => {
  const facts = first(await read('merge_e2e_16', 'rozed-dev', 'e2e', [16]));
  const snapshot = onScreen(facts, { preferredMethod: 'REBASE' });

  const { viewer } = snapshot;
  expect(viewer.didAuthor && !viewer.canApprove).toBe(true);
  expect(viewer.approvalCounts && viewer.canMerge).toBe(true);
  // No protection and no rulesets: nothing Lo can't see.
  expect(snapshot.seesEveryRule).toBe(true);
  expect(blockers(snapshot)).toEqual([]);
  expect(mergeAction(snapshot)).toEqual({
    kind: 'merge',
    methods: ['MERGE', 'SQUASH', 'REBASE'],
    method: 'REBASE',
  });
  const plan = thePlan(snapshot);
  expect(plan.approval).toEqual({ kind: 'ownPullRequest' });
  expect(plan.likely).toEqual({ kind: 'merge', method: 'REBASE' });
});

// What no recording shows yet, from recorded answers edited.

/** zed#66650, ready for the queue, with rozed-bot's pending review on `commit`. */
async function zedWithPendingReview(commit: string | undefined): Promise<MergeSnapshot> {
  const fetch = edited('merge_zed', (file, interaction) => {
    if (!file.startsWith('003-')) return;
    object(pullRequestOf(interaction)['viewerPendingReview'])['nodes'] = [
      {
        id: 'PRR_kwDOAbc',
        commit: commit === undefined ? null : { oid: commit },
        comments: { totalCount: 2 },
      },
    ];
  });
  const github = client(fetch);
  await readMergeFacts(github, ZED_BLOCKED, BOT);
  return onScreen(await readMergeFacts(github, ZED_READY, BOT));
}

test('your pending review on the head is submitted as the approval', async () => {
  const { head } = await zedWithPendingReview(undefined);
  const snapshot = await zedWithPendingReview(head);

  expect(snapshot.pendingReview).toEqual({ id: 'PRR_kwDOAbc', commit: head, comments: 2 });
  expect(thePlan(snapshot).approval).toEqual({ kind: 'submitPending', comments: 2 });
});

test('your pending review on another revision stops approve and ship', async () => {
  const older = '0d1d4ead0d1d4ead0d1d4ead0d1d4ead0d1d4ead';
  const snapshot = await zedWithPendingReview(older);

  expect(approveAndShip(snapshot)).toEqual({
    kind: 'pendingReviewElsewhere',
    refusal: { refusal: 'otherRevision', reviewOn: older },
  });
});

test('a code owner team you are in counts your approval for it', async () => {
  // cli#14964, with the code owners' team visible, rozed-bot in it, and write access.
  const fetch = edited('merge_cli', (file, interaction) => {
    if (!file.startsWith('009-')) return;
    const repository = object(object(object(interaction.response.body).data).repository);
    repository['viewerPermission'] = 'WRITE';
    const requests = object(object(repository['pullRequest'])['reviewRequests']);
    // The search also matches others whose login or name holds rozed-bot's, ten of them before
    // rozed-bot itself.
    const members: Json[] = Array.from({ length: 10 }, (_, n) => ({ login: `rozed-bot-${n + 2}` }));
    members.push({ login: 'Rozed-Bot' });
    object(list(requests['nodes'])[0])['requestedReviewer'] = {
      __typename: 'Team',
      combinedSlug: 'cli/code-reviewers',
      members: { nodes: members },
    };
  });
  const github = client(fetch);
  let facts: MergeFacts | undefined;
  for (const number of CLI.slice(0, 5)) {
    facts = await readMergeFacts(github, new PullRef('cli', 'cli', number), BOT);
  }
  if (!facts) throw new Error('nothing was read');
  const snapshot = onScreen(facts);

  expect(snapshot.viewer.teams).toEqual(['cli/code-reviewers']);
  expect(snapshot.viewer.approvalCounts).toBe(true);
  expect(blockers(snapshot)).toEqual([
    { kind: 'approvals', more: 1, codeOwners: [{ kind: 'team', slug: 'cli/code-reviewers' }] },
  ]);
  // Its approval meets the count and the team's review, so it's expected to merge. Trunk's push
  // restrictions don't name rozed-bot (`viewerCanPush`), which may hold for every writer on a
  // branch that requires pull requests: GitHub says at the merge if they keep it out.
  expect(facts.protection?.viewerCanPush).toBe(false);
  expect(snapshot.viewer.canMerge).toBe(true);
  const plan = thePlan(snapshot);
  expect(plan.approval).toEqual({ kind: 'approve' });
  expect(plan.likely).toEqual({ kind: 'merge', method: 'MERGE' });
});

/**
 * e2e#16 with classic protection only an admin sees in full: strict status checks requiring `ci`,
 * which passed, and no reviews.
 */
async function e2eProtected(): Promise<MergeFacts> {
  const fetch = edited('merge_e2e_16', (file, interaction) => {
    if (!file.includes('MergeSnapshot')) return;
    const pull = pullRequestOf(interaction);
    pull['mergeStateStatus'] = 'BLOCKED';
    const base = object(pull['baseRef']);
    base['refUpdateRule'] = {
      requiredApprovingReviewCount: 0,
      requiredStatusCheckContexts: ['ci'],
      requiresCodeOwnerReviews: false,
      requiresConversationResolution: true,
      requiresLinearHistory: false,
      requiresSignatures: false,
      viewerCanPush: true,
    };
    base['branchProtectionRule'] = {
      requiresApprovingReviews: false,
      requiredApprovingReviewCount: 0,
      requiresCodeOwnerReviews: false,
      dismissesStaleReviews: true,
      requireLastPushApproval: false,
      requiresConversationResolution: true,
      requiresStatusChecks: true,
      requiresStrictStatusChecks: true,
      requiredStatusChecks: [{ context: 'ci', app: { databaseId: 15368 } }],
      requiresLinearHistory: false,
      requiresCommitSignatures: false,
      requiresDeployments: false,
      lockBranch: false,
    };
    pull['statusCheckRollup'] = {
      contexts: {
        totalCount: 1,
        checkRunCountsByState: [{ state: 'SUCCESS', count: 1 }],
        statusContextCountsByState: [],
        pageInfo: { hasNextPage: false, endCursor: null },
        nodes: [
          {
            __typename: 'CheckRun',
            name: 'ci',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/rozed-dev/e2e/actions/runs/1/job/2',
            url: 'https://github.com/rozed-dev/e2e/runs/2',
            isRequired: true,
          },
        ],
      },
    };
  });
  return readMergeFacts(client(fetch), new PullRef('rozed-dev', 'e2e', 16), BOT);
}

test('a head behind the base is out of date under strict status checks', async () => {
  const facts = await e2eProtected();
  const local = (headContainsBase: boolean | undefined) => onScreen(facts, { headContainsBase });

  expect(facts.protection?.complete).toBe(true);
  // `ci` is pinned to GitHub Actions.
  expect(facts.protection?.requiredChecks).toEqual([{ name: 'ci', app: 15368 }]);
  expect(requiresUpToDate(facts)).toBe(true);
  expect(facts.pullRequest.baseTip).toBe('a45754b66cccf1879cd0a252c781639330e6d1fa');
  const behind = local(false);
  expect(behind.outOfDate).toBe('yes');
  expect(blockers(behind)).toEqual([{ kind: 'outOfDate' }]);
  // The admin's view is complete: Lo sees every rule.
  expect(behind.seesEveryRule).toBe(true);
  expect(behind.rules.dismissStaleReviews && behind.rules.conversationResolution).toBe(true);
  expect(checkStates(behind)).toEqual([['ci', 'passed']]);
  // Up to date, GitHub's own block stands unexplained.
  const current = local(true);
  expect(current.outOfDate).toBe('no');
  expect(kinds(current)).toEqual(['unexplained']);
  // Before the local copy has the base's tip, Lo says it can't tell, not that it's current.
  const unsure = local(undefined);
  expect(unsure.outOfDate).toBe('unknown');
  expect(kinds(unsure)).toEqual(['unexplained']);
});

/** zed#66631's rules answered `status` with `body` instead. */
function zedRulesAnswered(status: number, body: Json): ReplayFetch {
  return edited('merge_zed', (file, interaction) => {
    if (!file.startsWith('002-')) return;
    interaction.response.status = status;
    delete interaction.response.headers['etag'];
    interaction.response.body = body;
  });
}

test('rules that cant be read leave lo unsure it sees every rule', async () => {
  const fetch = zedRulesAnswered(403, { message: 'Resource not accessible by integration' });
  const facts = await readMergeFacts(client(fetch), ZED_BLOCKED, BOT);

  expect(facts.rules.unavailable).toBeDefined();
  expect(facts.rules.rules).toEqual([]);
  // It's kept: only a part GitHub left out with an error makes it read again early.
  expect(mergeFactsComplete(facts)).toBe(true);
  const snapshot = onScreen(facts);
  expect(snapshot.seesEveryRule).toBe(false);
  // Without the rules, the required checks' names are unknown, and the queue is GitHub's word.
  expect(snapshot.requiredChecks).toEqual([]);
  expect(snapshot.queue.required).toBe(true);
  expect(kinds(snapshot)).toEqual(['unexplained']);
});

test('a list github leaves out is read again', async () => {
  const fetch = edited('merge_zed', (file, interaction) => {
    if (!file.startsWith('001-')) return;
    const body = object(interaction.response.body);
    pullRequestOf(interaction)['latestOpinionatedReviews'] = null;
    body['errors'] = [
      {
        type: 'FORBIDDEN',
        path: ['repository', 'pullRequest', 'latestOpinionatedReviews'],
        message: 'Resource not accessible',
      },
    ];
  });
  const facts = await readMergeFacts(client(fetch), ZED_BLOCKED, BOT);

  expect(facts.leftOut).toEqual(['reviews', 'pullRequest.latestOpinionatedReviews']);
  expect(mergeFactsComplete(facts)).toBe(false);
  const snapshot = onScreen(facts);
  expect(snapshot.seesEveryRule).toBe(false);
  expect(snapshot.complete).toBe(false);
});

test('rules github fails to give are left out and read again', async () => {
  // A 502 may pass by itself, unlike a 403.
  const fetch = zedRulesAnswered(502, { message: 'Server Error' });
  const facts = await readMergeFacts(client(fetch), ZED_BLOCKED, BOT);

  expect(facts.rules.unavailable).toBeDefined();
  expect(facts.leftOut).toEqual(['rules']);
  expect(mergeFactsComplete(facts)).toBe(false);
  expect(onScreen(facts).complete).toBe(false);
});

/** The head's check suites in a recorded `MergeSnapshot` answer, to edit. */
function checkSuitesOf(interaction: Interaction): { [key: string]: Json } {
  const commits = object(pullRequestOf(interaction)['commits']);
  return object(object(object(list(commits['nodes'])[0])['commit'])['checkSuites']);
}

/**
 * zed#66631, with `danger` pinned to a CI app whose build for the head is queued: its suite has no
 * workflow run, and no check run until an agent picks it up. The queued suite is `app`'s.
 */
async function withQueuedBuild(app: number): Promise<MergeSnapshot> {
  const fetch = edited('merge_zed', (file, interaction) => {
    if (file.startsWith('001-')) {
      const suites = checkSuitesOf(interaction);
      suites['totalCount'] = Number(suites['totalCount']) + 1;
      list(suites['nodes']).push({ status: 'QUEUED', app: { databaseId: app }, workflowRun: null });
    } else if (file.startsWith('002-')) {
      for (const rule of list(interaction.response.body)) {
        if (object(rule)['type'] !== 'required_status_checks') continue;
        const checks = list(object(object(rule)['parameters'])['required_status_checks']);
        object(checks[0])['integration_id'] = 4242;
      }
    }
  });
  return onScreen(await readMergeFacts(client(fetch), ZED_BLOCKED, BOT));
}

test('a queued build of a required checks app is waited on', async () => {
  const pinned = await withQueuedBuild(4242);
  expect(pinned.checksPending).toBe(true);
  expect(kinds(pinned)).toEqual(['check(danger, missing)', 'check(tests_pass, missing)']);
  // Another app's queued suite may never run: nothing waits on it.
  const other = await withQueuedBuild(9999);
  expect(other.checksPending).toBe(false);
  expect(kinds(other)).toEqual(['notReported(danger)', 'notReported(tests_pass)']);
});

test('a queued workflow is waited on', async () => {
  const fetch = edited('merge_zed', (file, interaction) => {
    if (!file.startsWith('001-')) return;
    const suite = object(list(checkSuitesOf(interaction)['nodes'])[0]);
    expect(isObject(suite['workflowRun'])).toBe(true);
    suite['status'] = 'QUEUED';
  });
  const snapshot = onScreen(await readMergeFacts(client(fetch), ZED_BLOCKED, BOT));

  expect(snapshot.checksPending).toBe(true);
  expect(kinds(snapshot)).toEqual(['check(danger, missing)', 'check(tests_pass, missing)']);
});

const VSCODE = new PullRef('microsoft', 'vscode', 346714);

/** vscode#346714, with GitHub counting `total` review threads. */
async function withThreads(total: number): Promise<MergeSnapshot> {
  const fetch = edited('merge_vscode_346714', (file, interaction) => {
    if (file.startsWith('001-')) {
      object(pullRequestOf(interaction)['reviewThreads'])['totalCount'] = total;
    }
  });
  return onScreen(await readMergeFacts(client(fetch), VSCODE, BOT));
}

test('unresolved conversations past the first 100 are said to be at least', async () => {
  const all = await withThreads(2);
  expect(all.unresolvedThreads).toBe(2);
  expect(all.threadsCutShort).toBe(false);
  const many = await withThreads(150);
  expect(many.unresolvedThreads).toBe(2);
  expect(many.threadsCutShort).toBe(true);
});

test('the squash merge and auto merge settings are read', async () => {
  const zed = first(await read('merge_zed', 'zed-industries', 'zed', [66631]));
  expect(zed.repository.squashTitle).toBe('PR_TITLE');
  expect(zed.repository.squashMessage).toBe('PR_BODY');
  const e2e = first(await read('merge_e2e_16', 'rozed-dev', 'e2e', [16]));
  expect(e2e.repository.squashTitle).toBe('COMMIT_OR_PR_TITLE');
  expect(e2e.repository.squashMessage).toBe('COMMIT_MESSAGES');

  // rozed-bot can only read electron, whose pull request has auto-merge on.
  const electron = first(await read('merge_electron_55594', 'electron', 'electron', [55594]));
  const snapshot = onScreen(electron);
  expect(snapshot.autoMerge).toBeDefined();
  expect(snapshot.viewer.canDisableAutoMerge).toBe(false);
});

// Parts GitHub leaves out with an error.

/**
 * Leaves the field at `path` out of a recorded answer, as GitHub does when it can't give it: null,
 * and an error naming it, of GitHub's type `type`, or of none, as for a timeout.
 */
function leaveOut(interaction: Interaction, path: string[], type?: string): void {
  const body = object(interaction.response.body);
  let parent: Json | undefined = body['data'];
  for (const step of path.slice(0, -1)) {
    parent = Array.isArray(parent) ? parent[Number(step)] : object(parent)[step];
  }
  const last = path.at(-1) ?? '';
  if (Array.isArray(parent)) parent[Number(last)] = null;
  else object(parent)[last] = null;
  const error: Json = {
    type: type ?? null,
    path: path.map((step) => (/^\d+$/.test(step) ? Number(step) : step)),
    message:
      'Something went wrong while executing your query. This may be the result of a timeout.',
  };
  const errors = body['errors'];
  if (Array.isArray(errors)) errors.push(error);
  else body['errors'] = [error];
}

/** `pull` read from `name`, with its first answer's field at `path` left out as `leaveOut` says. */
function readLeavingOut(
  name: string,
  pull: PullRef,
  path: string[],
  type?: string,
): Promise<MergeFacts> {
  const fetch = edited(name, (file, interaction) => {
    if (file.startsWith('001-')) leaveOut(interaction, path, type);
  });
  return readMergeFacts(client(fetch), pull, BOT);
}

const CHECKS_PATH = ['repository', 'pullRequest', 'statusCheckRollup'];

test('checks github leaves out are neither missing nor complete', async () => {
  // zed#66631, whose checks time out.
  const facts = await readLeavingOut('merge_zed', ZED_BLOCKED, CHECKS_PATH);

  expect(facts.leftOut).toEqual(['pullRequest.statusCheckRollup']);
  expect(mergeFactsComplete(facts)).toBe(false);
  const snapshot = onScreen(facts);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.seesEveryRule).toBe(false);
  // Its required checks aren't taken as not reported: GitHub's block is one Lo can't explain.
  expect(snapshot.requiredChecks).toEqual([]);
  expect(kinds(snapshot)).toEqual(['unexplained']);
});

test('a check github leaves out makes none missing', async () => {
  // vscode#346714, its required Dependencies Check left out.
  const facts = await readLeavingOut('merge_vscode_346714', VSCODE, [
    ...CHECKS_PATH,
    'contexts',
    'nodes',
    '1',
  ]);

  expect(facts.leftOut).toEqual(['checks', 'pullRequest.statusCheckRollup.contexts.nodes.1']);
  // It may have passed, and so may the two Lo would otherwise take as missing.
  expect(checkStates(onScreen(facts))).toEqual([
    ['VS Code PR Check', 'running'],
    ['license/cla', 'passed'],
  ]);
});

test('auto merge github leaves out does not read as off', async () => {
  // electron#55594 has auto-merge on. Read as off, approve and ship's check after a push would
  // leave it on, so the snapshot says it isn't complete.
  const facts = await readLeavingOut(
    'merge_electron_55594',
    new PullRef('electron', 'electron', 55594),
    ['repository', 'pullRequest', 'autoMergeRequest'],
  );

  expect(facts.leftOut).toEqual(['pullRequest.autoMergeRequest']);
  expect(mergeFactsComplete(facts)).toBe(false);
  const snapshot = onScreen(facts);
  expect(snapshot.autoMerge).toBeUndefined();
  expect(snapshot.complete).toBe(false);
});

const CLI_13788 = new PullRef('cli', 'cli', 13788);

test('protection github leaves out leaves lo unsure it sees every rule', async () => {
  // cli#13788, the part of trunk's protection a reader sees left out.
  const facts = await readLeavingOut('merge_cli', CLI_13788, [
    'repository',
    'pullRequest',
    'baseRef',
    'refUpdateRule',
  ]);

  // Read as no protection, with no list cut short and only harmless rulesets, it would say Lo
  // sees every rule.
  expect(facts.protection).toBeUndefined();
  expect(facts.cutShort).toEqual([]);
  expect(facts.leftOut).toEqual(['pullRequest.baseRef.refUpdateRule']);
  const snapshot = onScreen(facts);
  expect(snapshot.seesEveryRule).toBe(false);
  expect(snapshot.complete).toBe(false);
});

test('settings hidden from the account are githubs answer', async () => {
  // Tokens other than an OAuth app's get them as FORBIDDEN errors rather than nulls: only an admin
  // sees the classic protection's settings, and only a writer the queue's.
  const fullProtection = ['repository', 'pullRequest', 'baseRef', 'branchProtectionRule'];
  const protection = await readLeavingOut('merge_cli', CLI_13788, fullProtection, 'FORBIDDEN');
  expect(protection.leftOut).toEqual([]);
  expect(mergeFactsComplete(protection)).toBe(true);
  expect(protection.protection?.complete).toBe(false);

  const fetch = edited('merge_zed', (file, interaction) => {
    if (file.startsWith('003-')) {
      leaveOut(
        interaction,
        ['repository', 'pullRequest', 'mergeQueue', 'configuration'],
        'FORBIDDEN',
      );
    }
  });
  const github = client(fetch);
  await readMergeFacts(github, ZED_BLOCKED, BOT);
  const queue = await readMergeFacts(github, ZED_READY, BOT);
  expect(mergeFactsComplete(queue)).toBe(true);
  expect(onScreen(queue).queue.method).toBe('SQUASH');

  // Another error there is a part left out.
  const timedOut = await readLeavingOut('merge_cli', CLI_13788, fullProtection);
  expect(timedOut.leftOut).toEqual(['pullRequest.baseRef.branchProtectionRule']);
});

// The merge states on rozed-dev/e2e: rozed-bot's own pull requests on two bases whose rulesets
// have no bypass actors, so rozed-bot, an admin, sees what any reviewer would.

const E4_GATED = [25, 26, 27, 28, 29, 30];

/** The pull requests on `e4/gated`, in {@link E4_GATED}'s order. */
async function e4Gated(): Promise<[MergeFacts, MergeSnapshot][]> {
  const gated = await read('merge_e4_gated', 'rozed-dev', 'e2e', E4_GATED);
  return gated.map((facts) => [facts, onScreen(facts)]);
}

/** The `index`th pull request on `e4/gated`, as {@link E4_GATED} lists them. */
async function e4GatedAt(index: number): Promise<[MergeFacts, MergeSnapshot]> {
  const found = (await e4Gated())[index];
  if (!found) throw new Error(`no pull request ${index}`);
  return found;
}

/**
 * The approval every pull request on `e4/gated` waits for. rozed-bot owns every file, but GitHub
 * doesn't ask an author to review their own pull request, so no code owner is named.
 */
const E4_APPROVAL: Blocker = { kind: 'approvals', more: 1, codeOwners: [] };

test('e4 gateds ruleset is read in full by its admin', async () => {
  for (const [facts, snapshot] of await e4Gated()) {
    expect(facts.protection).toBeUndefined();
    expect(facts.rules.branch).toBe('e4/gated');
    expect(facts.rules.unavailable).toBeUndefined();
    expect(facts.rules.rules).toContainEqual({
      kind: 'requiredStatusChecks',
      rule: { strict: false, checks: [{ name: 'ci', app: 15368 }] },
    });
    expect(snapshot.rules.requiredApprovals).toBe(1);
    expect(snapshot.rules.codeOwnerReview && snapshot.rules.conversationResolution).toBe(true);
    // GitHub's default: a push keeps approvals.
    expect(snapshot.rules.dismissStaleReviews || snapshot.rules.lastPushApproval).toBe(false);
    // An admin reads every rule, and nothing needs the head up to date.
    expect(snapshot.seesEveryRule).toBe(true);
    expect(requiresUpToDate(facts)).toBe(false);
    expect(snapshot.outOfDate).toBe('no');
    expect(snapshot.complete).toBe(true);
    expect(snapshot.queue.required).toBe(false);
    // rozed-bot's own: it can merge but not approve, and e2e doesn't allow auto-merge.
    const { viewer } = snapshot;
    expect(viewer.didAuthor && !viewer.canApprove).toBe(true);
    expect(viewer.approvalCounts && viewer.canMerge).toBe(true);
    expect(viewer.canEnableAutoMerge || viewer.canMergeAsAdmin).toBe(false);
    expect(mergeAction(snapshot)).toEqual({ kind: 'notPossible', reason: { kind: 'blocked' } });
    expect(mayNotSeeEveryRule(snapshot)).toBe(false);
  }
});

test('e4 25 waits only on an approval', async () => {
  const [, snapshot] = await e4GatedAt(0);

  expect(snapshot.mergeState).toBe('BLOCKED');
  expect(checkStates(snapshot)).toEqual([['ci', 'passed']]);
  expect(blockers(snapshot)).toEqual([E4_APPROVAL]);
  expect(mergeStatus(snapshot)).toMatchObject({
    kind: 'waiting',
    autoMerge: false,
    partial: false,
  });
});

test('e4 26 is blocked by its failed check', async () => {
  const [, snapshot] = await e4GatedAt(1);

  expect(kinds(snapshot)).toEqual(['check(ci, failed)', 'approvals']);
  const [failed] = blockers(snapshot);
  // Linked to the job's page.
  const url = failed?.kind === 'check' ? failed.check.url : undefined;
  expect(url).toMatch(/^https:\/\/github\.com\/rozed-dev\/e2e\/actions\/runs\//);
  expect(mergeStatus(snapshot).kind).toBe('blocked');
});

test('e4 27s run by hand is left out as github leaves it out', async () => {
  const [facts, snapshot] = await e4GatedAt(2);

  // Its head has two `ci` suites, the pull request's and one run by hand, and GitHub's rollup lists
  // only the pull request's, which passed after its 10 minutes.
  expect(facts.pullRequest.checks).toHaveLength(1);
  expect(checkStates(snapshot)).toEqual([['ci', 'passed']]);
  expect(snapshot.checksPending).toBe(false);
  expect(blockers(snapshot)).toEqual([E4_APPROVAL]);
});

test('e4 28 conflicts and its check can never report', async () => {
  const [, snapshot] = await e4GatedAt(3);

  expect(snapshot.mergeable).toBe('CONFLICTING');
  expect(snapshot.mergeState).toBe('DIRTY');
  // GitHub runs no workflow for a pull request that conflicts, so nothing can report `ci`.
  expect(snapshot.checksPending).toBe(false);
  expect(checkStates(snapshot)).toEqual([['ci', 'missing']]);
  expect(kinds(snapshot)).toEqual(['conflicts', 'notReported(ci)', 'approvals']);
  expect(mergeStatus(snapshot).kind).toBe('blocked');
});

test('e4 29 is a draft github reports blocked', async () => {
  const [, snapshot] = await e4GatedAt(4);

  // Not `DRAFT`: only `isDraft` says so.
  expect(snapshot.mergeState).toBe('BLOCKED');
  expect(snapshot.draft).toBe(true);
  expect(blockers(snapshot)).toEqual([{ kind: 'draft' }, E4_APPROVAL]);
});

test('e4 30s conversation and the approval github leaves undecided both block', async () => {
  const [, snapshot] = await e4GatedAt(5);

  // After rozed-bot's COMMENT review, GitHub's review decision is null, though the approval #25
  // waits for is still missing here: GitHub says `BLOCKED`, so Lo lists it from the rules.
  expect(snapshot.reviewDecision).toBeUndefined();
  expect(snapshot.unresolvedThreads).toBe(1);
  expect(blockers(snapshot)).toEqual([{ kind: 'conversations', unresolved: 1 }, E4_APPROVAL]);
});

const E4_QUEUED = [34, 50, 51, 36];

/** `e4/queued`'s merge queue, then the pull requests on it, in {@link E4_QUEUED}'s order. */
async function e4Queued() {
  const github = client(replayFetch('merge_e4_queued'));
  const queue = await mergeQueue(github, new RepoRef('rozed-dev', 'e2e'), 'e4/queued');
  const pulls: [MergeFacts, MergeSnapshot][] = [];
  for (const number of E4_QUEUED) {
    const facts = await readMergeFacts(github, new PullRef('rozed-dev', 'e2e', number), BOT);
    pulls.push([facts, onScreen(facts)]);
  }
  return { queue, pulls };
}

test('e4 queueds pull requests are ready for its queue', async () => {
  const { queue, pulls } = await e4Queued();

  expect(queueEntries(queue)).toEqual([]);
  expect(queueCutShort(queue)).toBe(false);
  // An admin sees the queue's settings.
  expect(queue.queue?.configuration?.mergeMethod).toBe('SQUASH');
  for (const [facts, snapshot] of pulls) {
    expect(snapshot.mergeState).toBe('CLEAN');
    expect(snapshot.seesEveryRule && snapshot.complete).toBe(true);
    expect(snapshot.rules.requiredApprovals).toBe(0);
    expect(snapshot.queue).toEqual({
      required: true,
      method: 'SQUASH',
      inQueue: false,
      position: undefined,
    });
    expect(blockers(snapshot)).toEqual([]);
    expect(mergeStatus(snapshot)).toEqual({ kind: 'ready' });
    // "Add to merge queue": the queue's settings choose the method.
    expect(mergeAction(snapshot)).toEqual({ kind: 'enqueue', method: 'SQUASH' });
    // A squash's title and message start from the repository's settings.
    expect(facts.repository.squashTitle).toBe('COMMIT_OR_PR_TITLE');
    expect(facts.repository.squashMessage).toBe('COMMIT_MESSAGES');
  }
});

test('e4 34s failed attempt is judged no longer once run again', async () => {
  const { pulls } = await e4Queued();
  const [facts, snapshot] = first(pulls);

  // `ci` failed on its run's first attempt and passed when the run was run again, on the same
  // commit: REST's `check-runs?filter=all` lists both. GitHub judges only the latest attempt,
  // `CLEAN`, and its rollup lists only that one, so Lo, which wants every check under a required
  // name to pass, sees one passed `ci` and nothing blocking.
  expect(facts.pullRequest.checks).toHaveLength(1);
  expect(checkStates(snapshot)).toEqual([['ci', 'passed']]);
  expect(blockers(snapshot)).toEqual([]);
  expect(mergeStatus(snapshot)).toEqual({ kind: 'ready' });
});

// A layer of a GitHub stack merges into the stack's base, whose rules GitHub checks it against.

/** `e4/gated`'s rules, as recorded. */
function gatedRules(): Interaction {
  const found = cassette('merge_e4_gated').interactions.find(({ file }) =>
    file.includes('rules_branches_e4_gated'),
  );
  if (!found) throw new Error("no read of e4/gated's rules");
  return structuredClone(found.interaction);
}

/**
 * e2e#16 as the top layer of GitHub stack #17 into `e4/gated`, on `e9b/15`, its layer below's
 * branch: the stack's bottom entry is on `bottomBase`, with a reader's part of classic protection
 * that requires linear history, and a merge queue. The rules answered are `e4/gated`'s.
 */
async function e2e16OnAStack(
  bottomBase: string,
): Promise<{ fetch: ReplayFetch; facts: MergeFacts }> {
  const found = cassette('merge_e2e_16').interactions.find(({ file }) =>
    file.includes('MergeSnapshot'),
  );
  if (!found) throw new Error("no read of e2e#16's merge");
  const snapshot = structuredClone(found.interaction);
  const pull = pullRequestOf(snapshot);
  pull['baseRefName'] = 'e9b/15';
  pull['stackEntry'] = {
    position: 3,
    stack: {
      number: 17,
      baseRefName: 'e4/gated',
      entries: {
        nodes: [
          {
            pullRequest: {
              baseRefName: bottomBase,
              baseRef: {
                refUpdateRule: {
                  requiredApprovingReviewCount: 1,
                  requiredStatusCheckContexts: [],
                  requiresCodeOwnerReviews: false,
                  requiresConversationResolution: false,
                  requiresLinearHistory: true,
                  requiresSignatures: false,
                  viewerCanPush: true,
                },
                branchProtectionRule: null,
              },
              isMergeQueueEnabled: true,
              mergeQueue: { configuration: { mergeMethod: 'SQUASH' } },
            },
          },
        ],
      },
    },
  };
  const fetch = replayFetch(new Replay('e2e_16_on_a_stack', [snapshot, gatedRules()]));
  const facts = await readMergeFacts(client(fetch), new PullRef('rozed-dev', 'e2e', 16), BOT);
  return { fetch, facts };
}

test('a stack layer is read with the stack bases rules', async () => {
  const { fetch, facts } = await e2e16OnAStack('e4/gated');

  // Its own base is the layer below's branch; the rules are the stack base's.
  expect(facts.pullRequest.base).toBe('e9b/15');
  expect(rulesBase(facts)).toBe('e4/gated');
  expect(facts.stack).toMatchObject({ number: 17, position: 3, baseRead: true });
  expect(asked(fetch)).toEqual([
    'MergeSnapshot',
    '/repos/rozed-dev/e2e/rules/branches/e4/gated?per_page=100',
  ]);
  expect(facts.rules.branch).toBe('e4/gated');
  // e4/gated's ruleset: an approval, a code owner's, conversations resolved, and ci.
  const snapshot = onScreen(facts);
  expect(snapshot.rules.requiredApprovals).toBe(1);
  expect(snapshot.rules.codeOwnerReview && snapshot.rules.conversationResolution).toBe(true);
  // The stack base's required check, which #16's head never ran.
  expect(checkStates(snapshot)).toEqual([['ci', 'missing']]);
  // The stack base's classic protection, through the bottom entry: linear history leaves no merge
  // commit. And its merge queue, not the layer's own base's.
  expect(snapshot.methods.merge).toBe(false);
  expect(snapshot.queue.required).toBe(true);
  expect(snapshot.queue.method).toBe('SQUASH');
  expect(facts.protection?.linearHistory).toBe(true);
  expect(facts.protection?.complete).toBe(false);
});

test('a stack base lo cant read through the bottom layer leaves it unsure', async () => {
  // The bottom entry isn't on the stack's base, so its protection isn't the stack base's.
  const { facts } = await e2e16OnAStack('e9b/other');

  expect(rulesBase(facts)).toBe('e4/gated');
  expect(facts.stack?.baseRead).toBe(false);
  expect(facts.protection).toBeUndefined();
  const snapshot = onScreen(facts);
  // Its queue isn't known either: no queue is guessed from the layer's own base.
  expect(snapshot.queue.required).toBe(false);
  expect(snapshot.seesEveryRule).toBe(false);
});

test('a github stacks first entry is its bottom layer as github answers', async () => {
  const [bottom, top, merged] = await read('merge_e2e_stack', 'rozed-dev', 'e2e', [71, 72, 69]);
  if (!bottom || !top || !merged) throw new Error('not every pull request was read');

  // #72 sits on #71's branch in stack #73: GitHub lists #71 first, on the stack's base, so the
  // rules Lo reads are the stack base's, and it knows it read them.
  expect(top.pullRequest.base).toBe('e9e/2/a');
  expect(rulesBase(top)).toBe('e9e/2/base');
  expect(top.rules.branch).toBe('e9e/2/base');
  expect(top.stack).toMatchObject({ number: 73, position: 2, baseRead: true });
  expect(seesEveryRule(top)).toBe(true);
  // The bottom layer is on the stack's base itself.
  expect(bottom.pullRequest.base).toBe('e9e/2/base');
  expect(bottom.stack).toMatchObject({ number: 73, position: 1, baseRead: true });
  // A stack that merged keeps its entries: #69, its top, still reads the bottom entry, on the
  // stack's base.
  expect(merged.pullRequest.state).toBe('MERGED');
  expect(merged.stack).toMatchObject({ number: 70, position: 3, baseRead: true });
  expect(rulesBase(merged)).toBe('e9e/1/base');
});

// A pull request whose base moves before it merges, as a chain's bottom layer moves onto its root,
// merges under that branch's rules, read before it moves.

test('a branch a pull request moves onto decides its methods and queue', async () => {
  const protection: Interaction = {
    request: {
      method: 'POST',
      url: 'https://api.github.com/graphql',
      operation: 'BranchProtection',
      variables: {
        owner: 'rozed-dev',
        name: 'e2e',
        qualified: 'refs/heads/e4/gated',
        branch: 'e4/gated',
      },
    },
    response: {
      status: 200,
      headers: {},
      body: {
        data: {
          rateLimit: null,
          repository: {
            ref: {
              name: 'e4/gated',
              refUpdateRule: {
                requiredApprovingReviewCount: 1,
                requiredStatusCheckContexts: [],
                requiresCodeOwnerReviews: false,
                requiresConversationResolution: false,
                requiresLinearHistory: true,
                requiresSignatures: false,
                viewerCanPush: true,
              },
              branchProtectionRule: null,
            },
            mergeQueue: { configuration: { mergeMethod: 'SQUASH' } },
          },
        },
      },
    },
  };
  const fetch = replayFetch(new Replay('onto_gated', [protection, gatedRules()]));
  const onto = await rulesOnto(client(fetch), new RepoRef('rozed-dev', 'e2e'), 'e4/gated');

  expect(asked(fetch)).toEqual([
    'BranchProtection',
    '/repos/rozed-dev/e2e/rules/branches/e4/gated?per_page=100',
  ]);
  expect(onto.branch).toBe('e4/gated');
  expect(onto.protection?.linearHistory).toBe(true);
  expect(onto.rules.branch).toBe('e4/gated');
  expect(onto.queueRequired).toBe(true);
  expect(onto.queueMethod).toBe('SQUASH');

  // #16 on main, unprotected, merges straight in with a merge commit; on e4/gated it would go
  // through the queue, and linear history leaves no merge commit.
  const facts = first(await read('merge_e2e_16', 'rozed-dev', 'e2e', [16]));
  const here = onScreen(facts);
  expect(here.methods.merge && !here.queue.required).toBe(true);
  const moved = factsOnto(facts, onto);
  expect(moved.pullRequest.base).toBe('e4/gated');
  expect(rulesBase(moved)).toBe('e4/gated');
  const there = onScreen(moved);
  expect(there.methods.merge).toBe(false);
  expect(there.queue.required).toBe(true);
  expect(there.queue.method).toBe('SQUASH');
  // GitHub's verdict is still the one read for main.
  expect(there.mergeState).toBe(here.mergeState);
});
