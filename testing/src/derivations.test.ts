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
});

test("a writer's merge fails for the rule its reads list, and nothing reads it merged after", () => {
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
  const permissions = interactions
    .filter(graphql('MergeSnapshot'))
    .map((each) => at(each.response.body, 'data', 'repository', 'viewerPermission'));
  expect(new Set(permissions)).toEqual(new Set(['WRITE']));
});
