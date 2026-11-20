import { expect, test } from 'vitest';

import { cassetteDir, isObject, readCassette, type Interaction, type Json } from './cassette.ts';
import { at, graphql } from './derive.ts';

/** The derived cassette `name`'s requests and answers, in order, as the replayer reads them. */
function answers(name: string): Interaction[] {
  return readCassette(cassetteDir(name)).interactions.map(({ interaction }) => interaction);
}

/** The first of a list in `json`, if it's one. */
function first(json: Json | undefined): Json | undefined {
  return Array.isArray(json) ? json[0] : undefined;
}

/** Whether `interaction` is GraphQL's `operation` about pull request `number`. */
function about(interaction: Interaction, operation: string, number: number): boolean {
  return graphql(operation)(interaction) && at(interaction.request.variables, 'number') === number;
}

/** Pull request `number` as `interaction`'s answer has it: alone, in a list, or in GraphQL's. */
function pullsIn(interaction: Interaction, number: number): Json[] {
  const { request, response } = interaction;
  if (request.operation !== undefined) {
    if (at(request.variables, 'number') !== number) return [];
    const pull = at(response.body, 'data', 'repository', 'pullRequest');
    return pull === undefined ? [] : [pull];
  }
  if (request.method !== 'GET' || response.body === undefined) return [];
  const path = new URL(request.url).pathname;
  if (path.endsWith(`/pulls/${number}`)) return [response.body];
  if (!path.endsWith('/pulls') || !Array.isArray(response.body)) return [];
  return response.body.filter((pull) => isObject(pull) && pull['number'] === number);
}

/** Where in `interactions` auto-merge is turned on for the pull request with node ID `id`. */
function turnedOn(interactions: readonly Interaction[], id: string): number {
  return interactions.findIndex(
    (each) =>
      graphql('EnablePullRequestAutoMerge')(each) &&
      at(each.request.variables, 'pullRequestId') === id,
  );
}

/** The node ID of pull request `number`, as `interactions` first read it. */
function nodeId(interactions: readonly Interaction[], number: number): string {
  const read = interactions.find((each) => about(each, 'PullRequest', number));
  const id = at(read?.response.body, 'data', 'repository', 'pullRequest', 'id');
  if (typeof id !== 'string') throw new Error(`nothing reads #${number}`);
  return id;
}

/** What each of `pulls` says of `fields`, where it says it. */
function said(pulls: readonly Json[], fields: readonly string[]): Json[] {
  return pulls.flatMap((pull) =>
    isObject(pull) ? fields.flatMap((field) => (field in pull ? [pull[field]!] : [])) : [],
  );
}

test.each([
  ['app_merge_auto_not_allowed', [221, 225]],
  ['app_merge_auto_now', [221]],
])('in %s, auto-merge GitHub refused to turn on is off in every read after', (name, numbers) => {
  const interactions = answers(name);
  for (const number of numbers) {
    const place = turnedOn(interactions, nodeId(interactions, number));
    expect(place, `#${number}'s auto-merge`).toBeGreaterThan(0);
    expect(at(first(at(interactions[place]!.response.body, 'errors')), 'type')).toBe(
      'UNPROCESSABLE',
    );
    const after = interactions.slice(place + 1).flatMap((each) => pullsIn(each, number));
    const autoMerge = said(after, ['autoMergeRequest', 'auto_merge']);
    expect(autoMerge.length, `reads of #${number} after`).toBeGreaterThan(0);
    expect(autoMerge.filter((each) => each !== null)).toEqual([]);
  }
});

/** Where `interactions` read GraphQL's `operation` about #`number`, with the pull request read. */
function readsOf(
  interactions: readonly Interaction[],
  operation: string,
  number: number,
): { index: number; pull: Json | undefined }[] {
  return interactions.flatMap((each, index) =>
    about(each, operation, number)
      ? [{ index, pull: at(each.response.body, 'data', 'repository', 'pullRequest') }]
      : [],
  );
}

/** What a poll counts of a timeline: every item, and the items Lo watches. */
function timeline(pull: Json | undefined): (Json | undefined)[] {
  return [at(pull, 'timelineItems'), at(pull, 'timelineEvents')];
}

test('auto-merge refused as not allowed leaves the timeline as it was, and turns on for no one after', () => {
  const interactions = answers('app_merge_auto_not_allowed');
  const place = turnedOn(interactions, nodeId(interactions, 221));
  const polls = readsOf(interactions, 'PullRequestCheck', 221);
  const before = polls.filter(({ index }) => index < place).at(-1)?.pull;
  const after = polls.filter(({ index }) => index > place).map(({ pull }) => pull);
  expect(after.length).toBeGreaterThan(0);
  expect(after.map(timeline)).toEqual(after.map(() => timeline(before)));
  const enable = interactions
    .slice(place + 1)
    .filter(graphql('MergeSnapshot'))
    .map((each) =>
      at(each.response.body, 'data', 'repository', 'pullRequest', 'viewerCanEnableAutoMerge'),
    );
  expect(new Set(enable)).toEqual(new Set([false]));
});

test('auto-merge refused as nothing blocks it: every read after says what GitHub did, its code owner approved it', () => {
  const interactions = answers('app_merge_auto_now');
  const place = turnedOn(interactions, nodeId(interactions, 221));
  const snapshots = readsOf(interactions, 'MergeSnapshot', 221);
  const before = snapshots.filter(({ index }) => index < place).map(({ pull }) => pull);
  const after = snapshots.filter(({ index }) => index > place).map(({ pull }) => pull);
  expect(before.length).toBeGreaterThan(0);
  expect(after.length).toBeGreaterThan(0);
  // rozed-bot owns everything on e4/gated, so only its approval clears the code owners' review,
  // and it can't approve a pull request it opened.
  expect(new Set(snapshots.map(({ pull }) => at(pull, 'author', 'login')))).toEqual(
    new Set(['ghost']),
  );
  expect(
    before.map((pull) => [
      at(pull, 'mergeStateStatus'),
      at(first(at(pull, 'reviewRequests', 'nodes')), 'requestedReviewer', 'login'),
    ]),
  ).toEqual(before.map(() => ['BLOCKED', 'rozed-bot']));
  expect(
    after.map((pull) => [
      at(pull, 'mergeStateStatus'),
      at(first(at(pull, 'latestOpinionatedReviews', 'nodes')), 'author', 'login'),
    ]),
  ).toEqual(after.map(() => ['CLEAN', 'rozed-bot']));
  // Lo's poll counts that approval among the reviews submitted.
  const polls = readsOf(interactions, 'PullRequestCheck', 221).map(({ index, pull }) => ({
    later: index > place,
    read: [at(pull, 'mergeStateStatus'), at(pull, 'submittedReviews', 'totalCount')],
  }));
  expect(polls.findLast(({ later }) => !later)?.read).toEqual(['BLOCKED', 0]);
  const later = polls.filter((poll) => poll.later).map(({ read }) => read);
  expect(later.length).toBeGreaterThan(0);
  expect(later).toEqual(later.map(() => ['CLEAN', 1]));
});

test("GitHub blocks a writer's merge for the rule its reads list, fails one sent, and nothing reads it merged after", () => {
  const interactions = answers('app_merge_write_writer');
  const rules = interactions.find(
    ({ request, response }) =>
      request.url.includes('/rules/branches/merge/5/base') && response.status === 200,
  );
  expect(rules?.response.body).toContainEqual(expect.objectContaining({ type: 'update' }));
  const ended = interactions.findLastIndex(({ request }) =>
    request.url.includes('/pulls/174/merge-async/'),
  );
  const failed = interactions[ended]?.response.body;
  expect(at(failed, 'status')).toBe('failed');
  expect(at(failed, 'details', 'message')).toContain('Cannot update this protected ref.');
  const next = interactions.findIndex(
    ({ request }, index) => index > ended && request.url === 'https://api.github.com/user',
  );
  const after = interactions.slice(ended + 1, next).flatMap((each) => pullsIn(each, 174));
  const states = said(after, ['state', 'merged']);
  expect(states.length).toBeGreaterThan(0);
  expect(states.filter((state) => state === 'MERGED' || state === true)).toEqual([]);
  // GitHub blocks every pull request into the branch for the account, as it says on GitHub.
  const verdicts = interactions
    .filter((each) => graphql('MergeSnapshot')(each) || graphql('PullRequestCheck')(each))
    .map((each) => at(each.response.body, 'data', 'repository', 'pullRequest', 'mergeStateStatus'));
  expect(verdicts.length).toBeGreaterThan(0);
  expect(new Set(verdicts)).toEqual(new Set(['BLOCKED']));
});

test.each(['app_merge_override_writer', 'app_merge_write_writer'])(
  '%s reads as an account with write access, below admin',
  (name) => {
    const interactions = answers(name);
    const permissions = interactions
      .filter(graphql('MergeSnapshot'))
      .map((each) => at(each.response.body, 'data', 'repository', 'viewerPermission'));
    expect(new Set(permissions)).toEqual(new Set(['WRITE']));
    const repository = interactions
      .filter(
        ({ request, response }) =>
          request.method === 'GET' &&
          new URL(request.url).pathname === '/repos/rozed-dev/e2e' &&
          response.status === 200,
      )
      .map(({ response }) => response.body);
    expect(repository.length).toBeGreaterThan(0);
    expect(
      repository.map((body) => [at(body, 'permissions'), at(body, 'security_and_analysis')]),
    ).toEqual(
      repository.map(() => [
        { admin: false, maintain: false, push: true, triage: true, pull: true },
        undefined,
      ]),
    );
  },
);

/** What each read of what decides #277's merge says of `fields`, in the order the replayer serves them. */
function shipReads(name: string, fields: readonly string[]): Json[][] {
  return answers(name)
    .filter((each) => about(each, 'MergeSnapshot', 277))
    .map((each) => {
      const pull = at(each.response.body, 'data', 'repository', 'pullRequest');
      return fields.map((field) => {
        if (field === 'approvedBy') {
          return (
            at(first(at(pull, 'latestOpinionatedReviews', 'nodes')), 'author', 'login') ?? null
          );
        }
        if (field === 'autoMerge') return at(pull, 'autoMergeRequest') === null ? 'off' : 'on';
        return at(pull, field) ?? null;
      });
    });
}

test('approve and ship on a pull request someone else opened: its approval, then the reads one later, each with it', () => {
  const interactions = answers('app_merge_ship_queued_others');
  const approval = interactions.filter(graphql('AddPullRequestReview'));
  expect(approval.map(({ request }) => request.variables)).toEqual([
    {
      pullRequestId: nodeId(interactions, 277),
      commitOID: '7243013b61d35e4c1b8b69b4f1868fbfdd33a0cc',
      event: 'APPROVE',
    },
  ]);
  expect(
    at(approval[0]!.response.body, 'data', 'addPullRequestReview', 'pullRequestReview', 'state'),
  ).toBe('APPROVED');
  // The tab's read and the press's, then the one once approved, before "Merge when ready" went on.
  expect(
    shipReads('app_merge_ship_queued_others', ['viewerDidAuthor', 'approvedBy', 'autoMerge']),
  ).toEqual([
    [false, null, 'off'],
    [false, null, 'off'],
    [false, 'rozed-bot', 'off'],
    [false, 'rozed-bot', 'on'],
  ]);
});

test('approve and ship reading a conflict once approved, or a push after the plan', () => {
  expect(
    shipReads('app_merge_ship_queued_conflict', ['mergeable', 'approvedBy', 'autoMerge']).slice(2),
  ).toEqual([
    ['CONFLICTING', 'rozed-bot', 'off'],
    ['CONFLICTING', 'rozed-bot', 'off'],
  ]);
  const heads = shipReads('app_merge_ship_queued_moved', ['headRefOid', 'viewerDidAuthor']);
  expect(heads[0]).toEqual(['7243013b61d35e4c1b8b69b4f1868fbfdd33a0cc', false]);
  expect(new Set(heads.slice(1).map(([head]) => head))).toEqual(
    new Set(['f81c007f901ca6da725764f0306c50585f89799b']),
  );
  expect(answers('app_merge_ship_queued_moved').filter(graphql('AddPullRequestReview'))).toEqual(
    [],
  );
});
