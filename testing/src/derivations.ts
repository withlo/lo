/**
 * The derived cassettes (`./derive.ts`): what GitHub can't be made to answer on demand, written
 * from what it answered. Add one here, and run `node testing/scripts/derive-answers.ts` to write
 * it; `nx run testing:codegen` writes them all again, as after their recorded cassettes change.
 */

import { cassette, isObject, recordedKey, type Interaction, type Json } from './cassette.ts';
import { answered, at, BAD_GATEWAY, graphql, only, refused, type Derivation } from './derive.ts';

/** Who the derived reads say opened a pull request: GitHub's stand-in for an account it no longer has. */
export const SOMEONE_ELSE = 'ghost';

/** The comments fixture's pull request, `testing/fixtures/comments.sh`'s. */
const COMMENTS_PULL = 94;

/**
 * `json` with pull request `number`, wherever it's read, opened by `login`: its `author` in
 * GraphQL's reads and its `user` in REST's.
 */
function openedBy(json: Json, number: number, login: string): Json {
  if (Array.isArray(json)) return json.map((each) => openedBy(each, number, login));
  if (!isObject(json)) return json;
  const changed = Object.fromEntries(
    Object.entries(json).map(([key, value]) => [key, openedBy(value, number, login)]),
  );
  if (json['number'] !== number) return changed;
  for (const key of ['author', 'user']) {
    const who = changed[key];
    if (isObject(who) && typeof who['login'] === 'string') changed[key] = { ...who, login };
  }
  return changed;
}

/**
 * Whether `request` reads pull request `number` itself, which says who opened it: GraphQL's
 * `PullRequest`, or REST's. Lists of pull requests are left as they were.
 */
function readsPull(request: Interaction['request'], number: number): boolean {
  if (request.operation !== undefined) {
    return request.operation === 'PullRequest' && at(request.variables, 'number') === number;
  }
  return request.method === 'GET' && new URL(request.url).pathname.endsWith(`/pulls/${number}`);
}

/** The pull request Lo added to e4/queued's merge queue in `app_merge_enqueue`. */
const ENQUEUED_PULL = 187;

/**
 * What `recorded` read of pull request `number`, by GraphQL's `operation`: the pull request in
 * each answer, in order.
 */
function pullReads(recorded: readonly Interaction[], operation: string, number: number): Json[] {
  return recorded.flatMap(({ request, response }) =>
    request.operation === operation && at(request.variables, 'number') === number
      ? [at(response.body, 'data', 'repository', 'pullRequest') ?? null]
      : [],
  );
}

/** Where in `recorded` the request that merged pull request `number`, or added it to a queue, is. */
function mergedAt(recorded: readonly Interaction[], number: number): number {
  return only(
    recorded,
    ({ request }) =>
      request.method === 'PUT' && request.url.endsWith(`/pulls/${number}/merge-async`),
    `#${number}'s merges`,
  );
}

/**
 * Where in `recorded` pull request `number`'s polls are: those after its first and before `merged`,
 * and the first after it.
 */
function pollsAround(
  recorded: readonly Interaction[],
  number: number,
  merged: number,
): { between: number[]; after: number } {
  const polls = recorded.flatMap((each, index) =>
    each.request.operation === 'PullRequestCheck' && at(each.request.variables, 'number') === number
      ? [index]
      : [],
  );
  const after = polls.find((index) => index > merged);
  const between = polls.filter((index) => index < merged).slice(1);
  if (after === undefined || between.length === 0) {
    throw new Error(
      `the recording polls #${number} neither between its first poll and the merge nor after`,
    );
  }
  return { between, after };
}

/**
 * Pull request `number`'s entry in its merge queue as GitHub lists it once it joined, from what
 * `recorded` read of it: at the place the merge facts gave it, added by the account they were read
 * as, joined when its timeline changed in the first poll after the request that added it, not yet
 * tested, and estimated to merge as the queue estimated its next entry (`estimate`). Nothing read
 * names the entry's id, so it has a stand-in.
 */
function joinedEntry(recorded: readonly Interaction[], number: number, estimate: Json): Json {
  const { after } = pollsAround(recorded, number, mergedAt(recorded, number));
  const facts = pullReads(recorded, 'MergeSnapshot', number).find(
    (each) => at(each, 'isInMergeQueue') === true,
  );
  const as = recorded.find(graphql('MergeSnapshot'))?.request.variables;
  const pull = pullReads(recorded, 'PullRequest', number).at(-1);
  const joined = at(
    recorded[after]?.response.body,
    'data',
    'repository',
    'pullRequest',
    'timelineItems',
    'updatedAt',
  );
  const author = at(facts, 'author');
  if (!isObject(facts) || !isObject(pull) || !isObject(author) || typeof joined !== 'string') {
    throw new Error(`the recording never read #${number} in its merge queue`);
  }
  return {
    id: `stand-in for #${number}'s entry`,
    position: at(facts, 'mergeQueueEntry', 'position') ?? null,
    state: 'QUEUED',
    enqueuedAt: joined,
    estimatedTimeToMerge: estimate,
    jump: false,
    solo: false,
    enqueuer: { __typename: 'User', login: at(as, 'login') ?? null },
    baseCommit: { oid: at(facts, 'baseRef', 'target', 'oid') ?? null },
    headCommit: null,
    pullRequest: {
      id: pull['id'] ?? null,
      number,
      title: pull['title'] ?? null,
      url: pull['url'] ?? null,
      headRefOid: pull['headRefOid'] ?? null,
      viewerDidAuthor: facts['viewerDidAuthor'] ?? null,
      author: { __typename: author['__typename'] ?? null, login: author['login'] ?? null },
    },
  };
}

/** The state a review submitted with each verdict has. */
const STATES = { APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' } as const;

/**
 * The recorded submission of a pending review as a comment, `submitted`, as GitHub would answer it
 * with `event`: the review in its verdict's state. The replayer tells them apart by their variables.
 */
function submittedAs(submitted: Interaction, event: keyof typeof STATES): Interaction {
  const { request, response } = submitted;
  const review = at(response.body, 'data', 'submitPullRequestReview', 'pullRequestReview');
  if (!isObject(review) || !isObject(request.variables)) {
    throw new Error('the recorded submission names no review');
  }
  return {
    request: { ...request, variables: { ...request.variables, event } },
    response: {
      ...response,
      body: {
        data: {
          submitPullRequestReview: { pullRequestReview: { ...review, state: STATES[event] } },
        },
      },
    },
  };
}

/** `recorded`'s one turning on of auto-merge for pull request `number`, by its place. */
function autoMergeOf(recorded: readonly Interaction[], number: number): number {
  return only(
    recorded,
    (each) =>
      graphql('EnablePullRequestAutoMerge')(each) &&
      at(each.response.body, 'data', 'enablePullRequestAutoMerge', 'pullRequest', 'number') ===
        number,
    `#${number}'s auto-merge turned on`,
  );
}

/** A JSON object. */
type JsonObject = { [key: string]: Json };

/** `json` with `change` made to it, when it's an object. */
function reshaped(json: Json | undefined, change: (object: JsonObject) => Json): Json {
  return isObject(json) ? change(json) : (json ?? null);
}

/** `interaction`'s answer with its body as `change` makes it. */
function withBody(interaction: Interaction, change: (body: Json) => Json): Interaction {
  const { request, response } = interaction;
  if (response.body === undefined) return interaction;
  return { request, response: { ...response, body: change(response.body) } };
}

/** A GraphQL answer's `repository`, as `change` makes it. */
function inRepository(body: Json, change: (repository: JsonObject) => Json): Json {
  return reshaped(body, (whole) => ({
    ...whole,
    data: reshaped(whole['data'], (data) => ({
      ...data,
      repository: reshaped(data['repository'], change),
    })),
  }));
}

/** A GraphQL answer's `repository.pullRequest`, as `change` makes it. */
function inPull(body: Json, change: (pull: JsonObject) => Json): Json {
  return inRepository(body, (repository) => ({
    ...repository,
    pullRequest: reshaped(repository['pullRequest'], change),
  }));
}

/** Whether `interaction` is GraphQL's `operation` about pull request `number`, by its variables. */
function about(interaction: Interaction, operation: string, number: number): boolean {
  return graphql(operation)(interaction) && at(interaction.request.variables, 'number') === number;
}

/** How the reads of a pull request after a write change: GraphQL's, by operation, and REST's. */
interface ReadsChange {
  readonly graphql: Readonly<Record<string, (pull: JsonObject) => JsonObject>>;
  readonly rest: (pull: JsonObject) => JsonObject;
}

/**
 * `recorded` with every read of pull request `number` after the interaction at `place` as `change`
 * makes it: GraphQL's that name it by their variables, and REST's of it, alone or in a list.
 */
function readsAfter(
  recorded: Interaction[],
  place: number,
  number: number,
  change: ReadsChange,
): Interaction[] {
  return recorded.map((each, index) => {
    if (index <= place) return each;
    const { request } = each;
    const operation = request.operation;
    if (operation !== undefined) {
      const graphqlChange = change.graphql[operation];
      if (graphqlChange === undefined || at(request.variables, 'number') !== number) return each;
      return withBody(each, (body) => inPull(body, graphqlChange));
    }
    if (request.method !== 'GET') return each;
    const path = new URL(request.url).pathname;
    if (path.endsWith(`/pulls/${number}`)) {
      return withBody(each, (body) => reshaped(body, change.rest));
    }
    if (!path.endsWith('/pulls')) return each;
    return withBody(each, (body) =>
      Array.isArray(body)
        ? body.map((pull) =>
            isObject(pull) && pull['number'] === number ? change.rest(pull) : pull,
          )
        : body,
    );
  });
}

/**
 * The pull requests `app_merge_auto` turned auto-merge on for, each from a copy of Lo of its own:
 * first into `e4/gated`, then "Merge when ready" into `e4/queued`, which has a merge queue.
 */
const GATED_PULL = 221;
const QUEUED_PULL = 225;

/** GitHub's refusal to turn on auto-merge where the repository doesn't allow it. */
const AUTO_MERGE_NOT_ALLOWED = 'Auto merge is not allowed for this repository';

/** What `recorded` polled of pull request `number` last before the interaction at `place`. */
function lastPoll(recorded: readonly Interaction[], place: number, number: number): JsonObject {
  const poll = recorded.slice(0, place).findLast((each) => about(each, 'PullRequestCheck', number));
  const pull = at(poll?.response.body, 'data', 'repository', 'pullRequest');
  if (!isObject(pull)) throw new Error(`the recording never polled #${number} before that`);
  return pull;
}

/**
 * Pull request `number`'s reads after `recorded` turned on its auto-merge at `place`, as if GitHub
 * had refused it: auto-merge is off, and the timeline, which turning it on added an event to, is as
 * Lo polled it last before.
 */
function autoMergeStaysOff(
  recorded: readonly Interaction[],
  place: number,
  number: number,
): ReadsChange {
  const before = lastPoll(recorded, place, number);
  const timeline = {
    timelineItems: before['timelineItems'] ?? null,
    timelineEvents: before['timelineEvents'] ?? null,
  };
  return {
    graphql: {
      MergeSnapshot: (pull) => ({
        ...pull,
        autoMergeRequest: null,
        viewerCanDisableAutoMerge: false,
      }),
      PullRequestCheck: (pull) => ({ ...pull, ...timeline }),
    },
    rest: (pull) => ({ ...pull, auto_merge: null }),
  };
}

/** The account `recorded` read as: the login its merge facts were read with. */
function readAs(recorded: readonly Interaction[]): string {
  const login = at(recorded.find(graphql('MergeSnapshot'))?.request.variables, 'login');
  if (typeof login !== 'string') throw new Error('the recording reads no merge facts');
  return login;
}

/**
 * `recorded` as an account with write access reads it, below admin: every read of what decides a
 * merge, or of a merge queue, says `WRITE`, and that GitHub doesn't let it merge past the rules, and
 * the repository's own read gives it push access without admin's, and leaves out its security
 * settings, which GitHub shows only to admins.
 */
function asWriter(recorded: Interaction[]): Interaction[] {
  return recorded.map((each) => {
    const { request } = each;
    if (request.operation === 'QueueView') {
      return withBody(each, (body) =>
        inRepository(body, (repository) => ({ ...repository, viewerPermission: 'WRITE' })),
      );
    }
    if (request.operation === 'MergeSnapshot') {
      return withBody(each, (body) =>
        inRepository(body, (repository) => ({
          ...repository,
          viewerPermission: 'WRITE',
          pullRequest: reshaped(repository['pullRequest'], (pull) => ({
            ...pull,
            viewerCanMergeAsAdmin: false,
          })),
        })),
      );
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/repos/rozed-dev/e2e') {
      return withBody(each, (body) =>
        reshaped(body, ({ security_and_analysis: _admins, ...repository }) => ({
          ...repository,
          permissions: { admin: false, maintain: false, push: true, triage: true, pull: true },
        })),
      );
    }
    return each;
  });
}

/** The base branch generation 5's pull requests merge into. */
const WRITE_BASE = 'merge/5/base';

/** The pull requests `app_merge_write` merged into {@link WRITE_BASE}, each from a copy of Lo of its own. */
const WRITE_MERGED = [174, 175, 176];

/**
 * GitHub's words for a merge a ruleset's "Restrict updates" rule refuses, as it fails an async merge
 * for a ruleset's rules (`merge_writes_e2e_refused`).
 */
const UPDATE_RESTRICTED =
  'Repository rule violations found\n\nCannot update this protected ref.\n\n';

/** How many branches one lookup of merged pull requests asks about, as Lo pads it. */
const LOOKUP_BATCH = 10;

/**
 * A lookup of the merged pull requests from `branches`, as Lo asks it, the batch padded with the
 * first branch, answered with what the recording last answered for each.
 */
function lookedUp(recorded: readonly Interaction[], branches: readonly string[]): Interaction {
  const lookups = recorded.filter(graphql('MergedPullRequests'));
  const last = lookups.at(-1);
  if (!last || !isObject(last.request.variables)) throw new Error('the recording looks up nothing');
  const answers = new Map<string, Json>();
  for (const { request, response } of lookups) {
    for (let slot = 0; slot < LOOKUP_BATCH; slot++) {
      const branch = at(request.variables, `b${slot}`);
      const answer = at(response.body, 'data', 'repository', `b${slot}`);
      if (typeof branch === 'string' && answer !== undefined) answers.set(branch, answer);
    }
  }
  const variables: Record<string, Json> = { ...last.request.variables };
  const repository: Record<string, Json> = {};
  for (let slot = 0; slot < LOOKUP_BATCH; slot++) {
    const branch = branches[slot] ?? branches[0]!;
    const answer = answers.get(branch);
    if (answer === undefined) throw new Error(`the recording never looked up ${branch}`);
    variables[`b${slot}`] = branch;
    repository[`b${slot}`] = answer;
  }
  const data = at(last.response.body, 'data');
  return {
    request: { ...last.request, variables },
    response: {
      ...last.response,
      body: { data: { ...(isObject(data) ? data : {}), repository } },
    },
  };
}

/** The branches a run of `MergedPullRequests` requests looks up, in order, each once. */
function branchesIn(run: readonly Interaction[]): string[] {
  const found = new Set<string>();
  for (const { request } of run) {
    for (let slot = 0; slot < LOOKUP_BATCH; slot++) {
      const branch = at(request.variables, `b${slot}`);
      if (typeof branch === 'string') found.add(branch);
    }
  }
  return [...found];
}

/**
 * `recorded` with a ruleset on `branch` whose one rule, "Restrict updates", lets only those who may
 * bypass it update the branch: every read of the repository's rulesets, and of `branch`'s rules,
 * holds it. Nothing names the ruleset's id, so it has a stand-in. The account `recorded` reads as
 * can't bypass it, so GitHub blocks every pull request into `branch`, and each read of what decides
 * one's merge says so. A ruleset that restricts updates makes its branch a trunk, so finding stacks
 * no longer looks up which pull requests from `branch` merged: each run of lookups that did is added
 * after the recording without it, answered as the run answered for the other branches.
 */
function restricted(recorded: Interaction[], branch: string): Interaction[] {
  const rule: Json = {
    type: 'update',
    parameters: { update_allows_fetch_and_merge: false },
    ruleset_source_type: 'Repository',
    ruleset_source: 'rozed-dev/e2e',
    ruleset_id: 1,
  };
  const ruleset: Json = {
    enforcement: 'ACTIVE',
    conditions: { refName: { include: [`refs/heads/${branch}`], exclude: [] } },
    rules: { nodes: [{ type: 'UPDATE' }] },
  };
  const lookups: Interaction[] = [];
  const lookup = graphql('MergedPullRequests');
  recorded.forEach((each, index) => {
    if (!lookup(each) || (index > 0 && lookup(recorded[index - 1]!))) return;
    const after = recorded.slice(index).findIndex((later) => !lookup(later));
    const run = recorded.slice(index, after === -1 ? recorded.length : index + after);
    const branches = branchesIn(run);
    const others = branches.filter((other) => other !== branch);
    if (others.length === branches.length || others.length === 0) return;
    for (let start = 0; start < others.length; start += LOOKUP_BATCH) {
      lookups.push(lookedUp(run, others.slice(start, start + LOOKUP_BATCH)));
    }
  });
  const changed = recorded.map((each) => {
    const { request, response } = each;
    if (graphql('TrunkRules')(each)) {
      return withBody(each, (body) =>
        inRepository(body, (repository) => ({
          ...repository,
          rulesets: reshaped(repository['rulesets'], (rulesets) => {
            const nodes = rulesets['nodes'];
            return { ...rulesets, nodes: [...(Array.isArray(nodes) ? nodes : []), ruleset] };
          }),
        })),
      );
    }
    if (
      request.method === 'GET' &&
      new URL(request.url).pathname.endsWith(`/rules/branches/${branch}`) &&
      Array.isArray(response.body)
    ) {
      return { request, response: { ...response, body: [...response.body, rule] } };
    }
    return each;
  });
  let blocked = changed;
  for (const number of intoBranch(recorded, branch)) {
    blocked = readsAfter(blocked, -1, number, {
      graphql: {
        MergeSnapshot: (pull) => ({ ...pull, mergeStateStatus: 'BLOCKED' }),
        PullRequestCheck: (pull) => ({ ...pull, mergeStateStatus: 'BLOCKED' }),
      },
      // A list of pull requests says nothing of whether each can merge.
      rest: (pull) => ({
        ...pull,
        ...('mergeable_state' in pull && { mergeable_state: 'blocked' }),
      }),
    });
  }
  return [...blocked, ...lookups];
}

/** The pull requests into `branch` whose merge facts `recorded` read. */
function intoBranch(recorded: readonly Interaction[], branch: string): Set<number> {
  const numbers = new Set<number>();
  for (const each of recorded.filter(graphql('MergeSnapshot'))) {
    const number = at(each.request.variables, 'number');
    const base = at(each.response.body, 'data', 'repository', 'pullRequest', 'baseRefName');
    if (typeof number === 'number' && base === branch) numbers.add(number);
  }
  return numbers;
}

/** Whether `interaction` starts a copy of Lo in a recording: it asks who it's signed in as first. */
function signsIn({ request }: Interaction): boolean {
  return request.method === 'GET' && request.url === 'https://api.github.com/user';
}

/**
 * `recorded` with GitHub failing the merge of pull request `number`, as `message` says, where it
 * last said it merged; and every read the copy of Lo that sent it made after answered as the last
 * one it made the same way before it sent the merge, since nothing merged. A conditional read it
 * didn't make before is answered as unchanged.
 */
function mergeFailed(recorded: Interaction[], number: number, message: string): Interaction[] {
  const sent = mergedAt(recorded, number);
  const ended = recorded.findLastIndex(
    ({ request }) =>
      request.method === 'GET' && request.url.includes(`/pulls/${number}/merge-async/`),
  );
  if (ended < sent || at(recorded[ended]!.response.body, 'status') !== 'merged') {
    throw new Error(`the recording never saw #${number} merge`);
  }
  const start = Math.max(0, recorded.slice(0, sent).findLastIndex(signsIn));
  const next = recorded.findIndex((each, index) => index > ended && signsIn(each));
  const end = next === -1 ? recorded.length : next;
  const before = recorded.slice(start, sent);
  return recorded.map((each, index) => {
    if (index === ended) {
      return answered(each, { ...each.response, body: { status: 'failed', details: { message } } });
    }
    if (index < ended || index >= end) return each;
    const { request, response } = each;
    const key = recordedKey(request);
    const same = before.findLast((earlier) => recordedKey(earlier.request) === key);
    if (same) return answered(each, same.response);
    const conditional = request.if_none_match ?? request.if_modified_since;
    if (request.method !== 'GET' || conditional === undefined) return each;
    const {
      'content-type': _type,
      'last-modified': _modified,
      etag: _etag,
      ...headers
    } = response.headers;
    return answered(each, {
      status: 304,
      headers:
        request.if_none_match === undefined ? headers : { ...headers, etag: request.if_none_match },
    });
  });
}

/**
 * The pull request approve and ship turned "Merge when ready" on for in `app_merge_ship_queued`:
 * rozed-dev/e2e#277, generation 10's `queued-slow-1`, into `e4/queued`, while its `ci` ran.
 */
const SHIPPED_PULL = 277;

/**
 * A push to it after Lo read it, in the derived reads: generation 10's `queued-slow-2` head, which
 * its repository has, so Lo can fetch it.
 */
const SHIPPED_NEWER = 'f81c007f901ca6da725764f0306c50585f89799b';

/**
 * `recorded` as if {@link SOMEONE_ELSE} had opened pull request `number`: every read names them as
 * its author, and the reads of what decides its merge say the account didn't.
 */
function openedBySomeoneElse(recorded: readonly Interaction[], number: number): Interaction[] {
  return recorded.map((each) =>
    about(each, 'MergeSnapshot', number)
      ? withBody(each, (body) =>
          inPull(body, (pull) => ({
            ...pull,
            author: { __typename: 'User', login: SOMEONE_ELSE },
            viewerDidAuthor: false,
          })),
        )
      : withBody(each, (body) => openedBy(body, number, SOMEONE_ELSE)),
  );
}

/** A read of what decides a merge, `pull`, with `login`'s approval of its head as their latest review. */
function approvedBy(pull: JsonObject, login: string): JsonObject {
  const reviews = pull['latestOpinionatedReviews'];
  const others = isObject(reviews) && Array.isArray(reviews['nodes']) ? reviews['nodes'] : [];
  const nodes = [
    ...others.filter((review) => at(review, 'author', 'login') !== login),
    {
      author: { __typename: 'User', login },
      state: 'APPROVED',
      commit: { oid: pull['headRefOid'] ?? null },
      authorCanPushToRepository: true,
      onBehalfOf: { totalCount: 0, nodes: [] },
    },
  ];
  return { ...pull, latestOpinionatedReviews: { totalCount: nodes.length, nodes } };
}

/**
 * GitHub's answer to `login`'s approval of pull request `number` at its head, posted at once as a
 * review with no body, as approve and ship sends it: `addPullRequestReview` as `app_comments_now`
 * recorded it for a comment, approving.
 */
function approvalAnswer(recorded: readonly Interaction[], number: number): Interaction {
  const read = recorded.find((each) => about(each, 'PullRequest', number));
  const id = at(read?.response.body, 'data', 'repository', 'pullRequest', 'id');
  const snapshot = recorded.find((each) => about(each, 'MergeSnapshot', number));
  const head = at(snapshot?.response.body, 'data', 'repository', 'pullRequest', 'headRefOid');
  if (typeof id !== 'string' || typeof head !== 'string') {
    throw new Error(`the recording never read #${number}`);
  }
  const posted = cassette('app_comments_now').interactions.find(({ interaction }) =>
    graphql('AddPullRequestReview')(interaction),
  )?.interaction;
  if (!posted) throw new Error('app_comments_now posted no review');
  return {
    request: {
      ...posted.request,
      variables: { pullRequestId: id, commitOID: head, event: 'APPROVE' },
    },
    response: {
      ...posted.response,
      body: {
        data: {
          addPullRequestReview: {
            pullRequestReview: {
              id: 'PRR_kwDOVleUfc8AAAABdErIvA',
              state: 'APPROVED',
              comments: { nodes: [] },
            },
          },
        },
      },
    },
  };
}

/**
 * The places in `recorded` of each read of what decides pull request `number`'s merge, in order.
 */
function snapshotsOf(recorded: readonly Interaction[], number: number): number[] {
  return recorded.flatMap((each, index) => (about(each, 'MergeSnapshot', number) ? [index] : []));
}

/**
 * `app_merge_ship_queued`, `recorded`, as if {@link SOMEONE_ELSE} had opened {@link SHIPPED_PULL},
 * so approve and ship approves it before anything more: GitHub's answer to that approval, and its
 * reads of what decides the merge after the press one later than recorded, each with the approval
 * and as `change` makes it. The first of them, the read Lo makes once it approved, is the one before
 * "Merge when ready" went on, and the last is read twice.
 */
function approvedShip(
  recorded: Interaction[],
  change: (pull: JsonObject) => JsonObject = (pull) => pull,
): Interaction[] {
  const owner = readAs(recorded);
  const opened = openedBySomeoneElse(recorded, SHIPPED_PULL);
  const places = snapshotsOf(opened, SHIPPED_PULL);
  // The first read is the tab's, the second the press's; the approval comes after it.
  const after = places.slice(2);
  if (after.length === 0) throw new Error(`no read of #${SHIPPED_PULL} after the press`);
  const approved = (each: Interaction) =>
    withBody(each, (body) => inPull(body, (pull) => change(approvedBy(pull, owner))));
  const answers = places.map((place) => opened[place]!.response);
  for (const [index, place] of after.entries()) {
    opened[place] = approved({ request: opened[place]!.request, response: answers[index + 1]! });
  }
  // The last as recorded, after the approval, again.
  const again = approved({ request: opened[places.at(-1)!]!.request, response: answers.at(-1)! });
  return [...opened, approvalAnswer(recorded, SHIPPED_PULL), again];
}

/**
 * GitHub's answer to turning auto-merge off for pull request `number`, at `head`: as
 * `app_merge_auto_off` recorded it for another pull request, auto-merge off.
 */
function autoMergeOffAnswer(
  recorded: readonly Interaction[],
  number: number,
  head: string,
): Interaction {
  const read = recorded.find((each) => about(each, 'PullRequest', number));
  const id = at(read?.response.body, 'data', 'repository', 'pullRequest', 'id');
  if (typeof id !== 'string') throw new Error(`the recording never read #${number}`);
  const off = cassette('app_merge_auto_off').interactions.find(({ interaction }) =>
    graphql('DisablePullRequestAutoMerge')(interaction),
  )?.interaction;
  if (!off) throw new Error('app_merge_auto_off turned no auto-merge off');
  return {
    request: { ...off.request, variables: { pullRequestId: id } },
    response: {
      ...off.response,
      body: {
        data: {
          disablePullRequestAutoMerge: {
            pullRequest: {
              number,
              headRefOid: head,
              state: 'OPEN',
              isInMergeQueue: false,
              autoMergeRequest: null,
            },
          },
        },
      },
    },
  };
}

/** The path of a pull request's overview ref, `refs/lo/pr/<n>`, as Lo reads it. */
const OVERVIEW_REF = /^\/repos\/[^/]+\/[^/]+\/git\/matching-refs\/lo\/pr\/\d+$/;

/**
 * `recorded` with GitHub's 304 to each overview ref it read, sent again with the ETag of that read,
 * where it has none: the ref unchanged.
 */
function refsReadAgain(recorded: readonly Interaction[]): Interaction[] {
  const keys = new Set(recorded.map(({ request }) => recordedKey(request)));
  const again: Interaction[] = [];
  for (const { request, response } of recorded) {
    const etag = response.headers['etag'];
    if (
      request.method !== 'GET' ||
      request.if_none_match !== undefined ||
      response.status !== 200 ||
      etag === undefined ||
      !OVERVIEW_REF.test(new URL(request.url).pathname)
    ) {
      continue;
    }
    const read = { method: 'GET', url: request.url, if_none_match: etag };
    if (keys.has(recordedKey(read))) continue;
    keys.add(recordedKey(read));
    // As GitHub answers a read that finds nothing changed: no body, and no poll interval.
    const { 'content-type': _type, 'x-poll-interval': _poll, ...headers } = response.headers;
    again.push({ request: read, response: { status: 304, headers } });
  }
  if (again.length === 0) throw new Error('the recording reads every overview ref again already');
  return [...recorded, ...again];
}

export const DERIVATIONS: readonly Derivation[] = [
  {
    name: 'app_comments_write_others',
    from: 'app_comments_write',
    description: `app_comments_write as if someone else had opened rozed-dev/e2e#${COMMENTS_PULL}: every read of it names ${SOMEONE_ELSE} as its author, so rozed-bot may approve it or request changes, which GitHub takes from no pull request's author. The pending review's submission is answered for each verdict as it was for a comment.`,
    derive(recorded) {
      const submitted =
        recorded[only(recorded, graphql('SubmitPullRequestReview'), 'submissions')]!;
      const others = recorded.map(({ request, response }) => ({
        request,
        response:
          response.body === undefined || !readsPull(request, COMMENTS_PULL)
            ? response
            : { ...response, body: openedBy(response.body, COMMENTS_PULL, SOMEONE_ELSE) },
      }));
      return [
        ...others,
        submittedAs(submitted, 'APPROVE'),
        submittedAs(submitted, 'REQUEST_CHANGES'),
      ];
    },
  },
  {
    name: 'app_comments_write_lost',
    from: 'app_comments_write',
    description:
      "app_comments_write with the pending review's submission answered 502, as when GitHub's gateway gives up whatever it did by then: Lo can't tell whether it was submitted, and reads your reviews (YourReviews) to find out, as recorded after it was.",
    derive(recorded) {
      const place = only(recorded, graphql('SubmitPullRequestReview'), 'submissions');
      recorded[place] = answered(recorded[place]!, BAD_GATEWAY);
      return recorded;
    },
  },
  {
    name: 'app_comments_now_too_fast',
    from: 'app_comments_now',
    description:
      'app_comments_now with the comment posted at once refused as GitHub refuses content created too fast: "was submitted too quickly". Nothing was posted.',
    derive(recorded) {
      const place = only(recorded, graphql('AddPullRequestReview'), 'comments posted');
      recorded[place] = answered(
        recorded[place]!,
        refused(recorded[place]!, 'was submitted too quickly'),
      );
      return recorded;
    },
  },
  {
    name: 'review_writes_e2e_23_not_in_diff',
    from: 'review_writes_e2e_23_pending',
    description:
      "review_writes_e2e_23_pending with the first thread added to the pending review answered as GitHub answers one on lines outside the pull request's diff: no thread, and no error.",
    derive(recorded) {
      const place = recorded.findIndex(graphql('AddPullRequestReviewThread'));
      const added = recorded[place];
      if (!added) throw new Error('the recording adds no thread');
      recorded[place] = answered(added, {
        ...added.response,
        body: { data: { addPullRequestReviewThread: { thread: null } } },
      });
      return recorded;
    },
  },
  {
    name: 'attachments_e2e_not_found',
    from: 'attachments_e2e',
    description:
      "attachments_e2e with the PNG's upload to rozed-dev/e2e answered 404, as GitHub answered its upload to a repository that doesn't exist: what a token GitHub won't take uploads from gets.",
    derive(recorded) {
      const uploads = recorded.flatMap((each, index) =>
        each.request.url.includes('/user-attachments/assets') ? [index] : [],
      );
      const first = uploads[0];
      const missing = uploads.find((index) => recorded[index]!.response.status === 404);
      if (first === undefined || missing === undefined || first === missing) {
        throw new Error('the recording holds no upload GitHub took and none it answered 404');
      }
      recorded[first] = answered(recorded[first]!, recorded[missing]!.response);
      return recorded;
    },
  },
  {
    name: 'app_merge_write_polled',
    from: 'app_merge_write',
    description:
      "app_merge_write with GitHub's 304 to a poll of each pull request Lo merged, rozed-dev/e2e#174, #175 and #176, made after the read that saw it closed: the copy of Lo that merged each stopped before it polled again.",
    derive(recorded) {
      for (const number of [174, 175, 176]) {
        const url = `https://api.github.com/repos/rozed-dev/e2e/pulls/${number}`;
        const closed = recorded.findLast(
          ({ request, response }) =>
            request.method === 'GET' &&
            request.url === url &&
            request.if_modified_since !== undefined &&
            response.status === 200,
        );
        const since = closed?.response.headers['last-modified'];
        if (!closed || since === undefined)
          throw new Error(`the recording never saw #${number} change`);
        const { 'content-type': _type, ...headers } = closed.response.headers;
        recorded.push({
          request: { ...closed.request, if_modified_since: since },
          response: { status: 304, headers },
        });
      }
      return recorded;
    },
  },
  {
    name: 'app_merge_write_moved',
    from: 'app_merge_write',
    description:
      "app_merge_write with rozed-dev/e2e#183's polls between its first and the merge answered as the first after the merge, which saw the push: Lo reads the newer push at the first poll after GitHub failed the merge, as when it polls less often than the recording did.",
    derive(recorded) {
      const { between, after } = pollsAround(recorded, 183, mergedAt(recorded, 183));
      for (const index of between)
        recorded[index] = answered(recorded[index]!, recorded[after]!.response);
      return recorded;
    },
  },
  {
    name: 'app_merge_placed',
    from: 'app_merge',
    description:
      "app_merge with GitHub's answer to which open pull requests come from merge/6/base: none, as none ever have. The merge panel asks it as it opens, to say where a pull request on that branch sits, which it didn't when app_merge was recorded.",
    derive(recorded) {
      const read = recorded.find(
        ({ request, response }) =>
          request.method === 'GET' &&
          request.url.includes('/pulls?') &&
          response.status === 200 &&
          request.if_none_match === undefined,
      );
      if (!read) throw new Error('the recording lists no pull requests');
      const { link: _link, etag: _etag, ...headers } = read.response.headers;
      return [
        ...recorded,
        {
          request: {
            method: 'GET',
            url: 'https://api.github.com/repos/rozed-dev/e2e/pulls?head=rozed-dev%3Amerge%2F6%2Fbase&state=open&per_page=100',
          },
          response: { status: 200, headers, body: [] },
        },
      ];
    },
  },
  {
    name: 'app_merge_stack_polled',
    from: 'app_merge_stack',
    description:
      "app_merge_stack with the check of rozed-dev/e2e's open pull requests that GitHub answered before the merge with a new ETag answered as unchanged: the one change it held was auto-merge turned off on #225, another generation's pull request no test here reads. Lo here may check them more often before the merge than the recording did, and would otherwise read the list from after the merge before confirming it. And Lo here merges before it looks up again the merged pull requests from the branches its first list left out, e9e/2/base and stack/mroot, so after the merge it looks them up with merge/8/base: that lookup is answered as the recording answered each branch.",
    derive(recorded) {
      const merged = only(
        recorded,
        ({ request }) => request.method === 'PUT' && request.url.endsWith('/merge-async'),
        'merges',
      );
      const changed = recorded.flatMap(({ request, response }, index) =>
        index < merged &&
        request.method === 'GET' &&
        request.url.includes('/pulls?state=open') &&
        request.if_none_match !== undefined &&
        response.status === 200
          ? [index]
          : [],
      );
      if (changed.length === 0) {
        throw new Error(
          'the recording holds no check of the list answered as changed before the merge',
        );
      }
      for (const index of changed) {
        const check = recorded[index]!;
        const { 'content-type': _type, link: _link, ...headers } = check.response.headers;
        const etag = check.request.if_none_match!.replace(/^W\//, '');
        recorded[index] = answered(check, { status: 304, headers: { ...headers, etag } });
      }
      return [...recorded, lookedUp(recorded, ['merge/8/base', 'e9e/2/base', 'stack/mroot'])];
    },
  },
  {
    name: 'app_merge_write_lost',
    from: 'app_merge_write',
    description:
      "app_merge_write with the merge of rozed-dev/e2e#183 answered 502, as when GitHub's gateway gives up whatever it did by then: Lo can't tell whether it merged, and reads the pull request to find out, which says it's open, as GitHub failed that merge.",
    derive(recorded) {
      const place = only(
        recorded,
        ({ request }) => request.method === 'PUT' && request.url.endsWith('/pulls/183/merge-async'),
        "#183's merges",
      );
      recorded[place] = answered(recorded[place]!, BAD_GATEWAY);
      return recorded;
    },
  },
  {
    name: 'app_merge_enqueue_listed',
    from: 'app_merge_enqueue',
    description: `app_merge_enqueue with e4/queued's queue listing rozed-dev/e2e#${ENQUEUED_PULL} once Lo added it, first, as the merge facts read then say, and #${ENQUEUED_PULL}'s polls between its first and the request that added it answered as the first after it: Lo reads that it's queued at the first poll after, as when it polls less often than the recording did. The queue was read only after #${ENQUEUED_PULL} was taken out of it, when it was empty, which stays the answer to the read before Lo added it. The entry joined when the pull request's timeline changed with the request that added it, isn't tested yet, and is estimated to merge as that read estimated the queue's next entry.`,
    derive(recorded) {
      const { between, after } = pollsAround(
        recorded,
        ENQUEUED_PULL,
        mergedAt(recorded, ENQUEUED_PULL),
      );
      const read = recorded[only(recorded, graphql('QueueView'), 'reads of the queue')]!;
      const { body } = read.response;
      const data = at(body, 'data');
      const repository = at(data, 'repository');
      const queue = at(repository, 'mergeQueue');
      if (!isObject(body) || !isObject(data) || !isObject(repository) || !isObject(queue)) {
        throw new Error('the read of the queue found none');
      }
      const estimate = queue['nextEntryEstimatedTimeToMerge'] ?? null;
      const entry = joinedEntry(recorded, ENQUEUED_PULL, estimate);
      const entries = { totalCount: 1, nodes: [entry] };
      const listed = {
        ...body,
        data: { ...data, repository: { ...repository, mergeQueue: { ...queue, entries } } },
      };
      for (const index of between)
        recorded[index] = answered(recorded[index]!, recorded[after]!.response);
      recorded.push({ request: read.request, response: { ...read.response, body: listed } });
      return recorded;
    },
  },
  {
    name: 'app_merge_auto_not_allowed',
    from: 'app_merge_auto',
    description: `app_merge_auto as if "Allow auto-merge" went off in rozed-dev/e2e's settings after Lo read #${GATED_PULL}: turning on auto-merge for it is refused as GitHub refuses it then, "${AUTO_MERGE_NOT_ALLOWED}", as recorded in merge_writes_e2e_auto_merge, and so is "Merge when ready" for #${QUEUED_PULL} after. From the first refusal on, every read of what decides a merge says the account can't turn auto-merge on, and every read of either pull request after its refusal says auto-merge is off, with the timeline Lo polled before it, which turning it on added an event to when recorded.`,
    derive(recorded) {
      const first = autoMergeOf(recorded, GATED_PULL);
      let derived = recorded;
      for (const number of [GATED_PULL, QUEUED_PULL]) {
        const place = autoMergeOf(derived, number);
        derived[place] = answered(
          derived[place]!,
          refused(derived[place]!, AUTO_MERGE_NOT_ALLOWED),
        );
        derived = readsAfter(derived, place, number, autoMergeStaysOff(derived, place, number));
      }
      // The repository no longer allows it, so no account may turn it on.
      return derived.map((each, index) =>
        index > first && graphql('MergeSnapshot')(each)
          ? withBody(each, (body) =>
              inPull(body, (pull) => ({ ...pull, viewerCanEnableAutoMerge: false })),
            )
          : each,
      );
    },
  },
  {
    name: 'app_merge_auto_now',
    from: 'app_merge_auto',
    description: `app_merge_auto as if ${SOMEONE_ELSE} had opened rozed-dev/e2e#${GATED_PULL}: every read names ${SOMEONE_ELSE} as its author, and its merge facts ask rozed-bot, which owns everything on e4/gated, for a code owner's review, until rozed-bot approved it on GitHub after Lo read it. So GitHub refused to turn on auto-merge for it as it refuses it for a pull request nothing blocks, "Pull request Pull request is in clean status", and every read of what decides #${GATED_PULL}'s merge after says so: approved by rozed-bot, no review asked for, clean, and auto-merge off, which no account can turn on while nothing blocks the merge. Its timeline grew by that approval, as it grew by an event when the recording turned auto-merge on, and so did the count of its submitted reviews. Lo, reading it again, offers the merge in auto-merge's place; nothing merged #${GATED_PULL}, so no answer to that merge was recorded.`,
    derive(recorded) {
      const owner = readAs(recorded);
      const opened = recorded.map((each) =>
        about(each, 'MergeSnapshot', GATED_PULL)
          ? withBody(each, (body) =>
              inPull(body, (pull) => ({
                ...pull,
                author: { __typename: 'User', login: SOMEONE_ELSE },
                viewerDidAuthor: false,
                reviewRequests: {
                  totalCount: 1,
                  nodes: [
                    { asCodeOwner: true, requestedReviewer: { __typename: 'User', login: owner } },
                  ],
                },
              })),
            )
          : withBody(each, (body) => openedBy(body, GATED_PULL, SOMEONE_ELSE)),
      );
      const place = autoMergeOf(opened, GATED_PULL);
      opened[place] = answered(
        opened[place]!,
        refused(opened[place]!, 'Pull request Pull request is in clean status'),
      );
      const off = autoMergeStaysOff(opened, place, GATED_PULL);
      const reviews = at(lastPoll(opened, place, GATED_PULL), 'submittedReviews', 'totalCount');
      if (typeof reviews !== 'number') {
        throw new Error(`the recording counts no reviews of #${GATED_PULL}`);
      }
      return readsAfter(opened, place, GATED_PULL, {
        graphql: {
          MergeSnapshot: (pull) => ({
            ...off.graphql['MergeSnapshot']!(pull),
            mergeStateStatus: 'CLEAN',
            reviewDecision: 'APPROVED',
            viewerCanEnableAutoMerge: false,
            reviewRequests: { totalCount: 0, nodes: [] },
            latestOpinionatedReviews: {
              totalCount: 1,
              nodes: [
                {
                  author: { __typename: 'User', login: owner },
                  state: 'APPROVED',
                  commit: { oid: pull['headRefOid'] ?? null },
                  authorCanPushToRepository: true,
                  onBehalfOf: { totalCount: 0, nodes: [] },
                },
              ],
            },
          }),
          PullRequestCheck: (pull) => ({
            ...pull,
            mergeStateStatus: 'CLEAN',
            reviewDecision: 'APPROVED',
            submittedReviews: { totalCount: reviews + 1 },
          }),
        },
        // A list of pull requests says nothing of whether each can merge.
        rest: (pull) => ({
          ...off.rest(pull),
          ...('mergeable_state' in pull && { mergeable_state: 'clean' }),
        }),
      });
    },
  },
  {
    name: 'app_merge_override_writer',
    from: 'app_merge_override',
    description:
      "app_merge_override read as an account with write access, below admin: every read of what decides rozed-dev/e2e#231's merge says WRITE, and that GitHub doesn't let it merge past merge/7/override's rules, and the repository's own read gives it push access without admin's, and no security settings, which GitHub shows only to admins.",
    derive: asWriter,
  },
  {
    name: 'app_merge_write_writer',
    from: 'app_merge_write',
    description: `app_merge_write read as an account with write access, below admin, as app_merge_override_writer is, on a ${WRITE_BASE} that a ruleset's "Restrict updates" rule covers, which the account can't bypass: every read of the repository's rulesets and of ${WRITE_BASE}'s rules holds it, every read of what decides the merge of a pull request into ${WRITE_BASE} says GitHub blocks it, and Lo, which takes a branch such a rule covers as a trunk, looks up which pull requests merged from the other branches only, as recorded for them. GitHub fails each merge Lo sent into ${WRITE_BASE}, of rozed-dev/e2e#174, #175 and #176, for that rule, where it said it merged, as it fails an async merge for a ruleset's rules: "Repository rule violations found", then "Cannot update this protected ref.". The reads each copy of Lo made after answer as before it sent the merge, since nothing merged. The copies after the first, which no derived test opens, read ${WRITE_BASE}'s commits as recorded, moved by the merges before them. These answers are derived: the recorders accept only rozed-bot's token, an admin's, and no account below admin merged anything.`,
    derive(recorded) {
      let writer = asWriter(recorded);
      for (const number of WRITE_MERGED) writer = mergeFailed(writer, number, UPDATE_RESTRICTED);
      return restricted(writer, WRITE_BASE);
    },
  },
  {
    name: 'app_merge_ship_queued_others',
    from: 'app_merge_ship_queued',
    description: `app_merge_ship_queued as if ${SOMEONE_ELSE} had opened rozed-dev/e2e#${SHIPPED_PULL}: every read names ${SOMEONE_ELSE} as its author, so approve and ship approves the revision on screen first, as rozed-bot, which GitHub takes from no pull request's author. GitHub answers that approval as it answered app_comments_now's review posted at once, approving, and every read of what decides #${SHIPPED_PULL}'s merge after the press holds it. The first of them is the read before "Merge when ready" went on, which Lo makes once it approved; the rest are one later than recorded, the last read twice.`,
    derive: (recorded) => approvedShip(recorded),
  },
  {
    name: 'app_merge_ship_queued_conflict',
    from: 'app_merge_ship_queued',
    description: `app_merge_ship_queued_others with every read of what decides rozed-dev/e2e#${SHIPPED_PULL}'s merge after the press saying it conflicts with e4/queued, as after a push to the base meanwhile, and auto-merge off: approve and ship approves it, then stops, and turns nothing on.`,
    derive: (recorded) =>
      approvedShip(recorded, (pull) => ({
        ...pull,
        mergeable: 'CONFLICTING',
        mergeStateStatus: 'DIRTY',
        autoMergeRequest: null,
      })),
  },
  {
    name: 'app_merge_ship_queued_moved',
    from: 'app_merge_ship_queued',
    description: `app_merge_ship_queued as if ${SOMEONE_ELSE} had opened rozed-dev/e2e#${SHIPPED_PULL}, so approve and ship would approve it first, and had pushed ${SHIPPED_NEWER} to it after Lo planned it: every read of what decides its merge from the press on has that head, so the press approves nothing and turns nothing on.`,
    derive(recorded) {
      const opened = openedBySomeoneElse(recorded, SHIPPED_PULL);
      const places = snapshotsOf(opened, SHIPPED_PULL).slice(1);
      return opened.map((each, index) =>
        places.includes(index)
          ? withBody(each, (body) =>
              inPull(body, (pull) => ({ ...pull, headRefOid: SHIPPED_NEWER })),
            )
          : each,
      );
    },
  },
  {
    name: 'app_merge_ship_watched',
    from: 'app_merge_ship_queued',
    description: `app_merge_ship_queued_others with ${SOMEONE_ELSE} pushing ${SHIPPED_NEWER} to rozed-dev/e2e#${SHIPPED_PULL} once "Merge when ready" went on: the reads of what decides its merge from then on have that head, with auto-merge still on as rozed-bot turned it on and rozed-bot's approval of the revision before. e4/queued's rules want no new approval after a push, so the push would merge with it, and the watch turns auto-merge off: GitHub answers as it answered app_merge_auto_off's, for #${SHIPPED_PULL} at that head. GitHub can't be made to push as someone else, nor take rozed-bot's approval of its own pull request.`,
    derive(recorded) {
      const shipped = approvedShip(recorded);
      const last = shipped.length - 1;
      shipped[last] = withBody(shipped[last]!, (body) =>
        inPull(body, (pull) => ({ ...pull, headRefOid: SHIPPED_NEWER })),
      );
      return [...shipped, autoMergeOffAnswer(recorded, SHIPPED_PULL, SHIPPED_NEWER)];
    },
  },
  {
    name: 'app_queue_act_writer',
    from: 'app_queue_act',
    description: `app_queue_act read as an account with write access, below admin, as app_merge_override_writer is: every read of e4/queued's merge queue says WRITE, and GitHub lets only admins move a pull request to the front, so Lo offers no J. Only the reads before J was pressed are meant for such an account: the rest are as recorded, the move included. These answers are derived: the recorders accept only rozed-bot's token, an admin's.`,
    derive: asWriter,
  },
  {
    name: 'app_queue_polled',
    from: 'app_queue',
    description:
      "app_queue with GitHub's 304 to rozed-dev/e2e#156's and #169's overview refs read again with the ETag of their first read, as the recording read #168's: Lo reads the ref on screen again as its window comes to the front, and on a timer, which a test can reach when the recording didn't. Neither has an overview, so nothing changed.",
    derive: refsReadAgain,
  },
  {
    name: 'app_queued_polled',
    from: 'app_queued',
    description:
      "app_queued with GitHub's 304 to rozed-dev/e2e#205's and #204's overview refs read again with the ETag of their first read: Lo reads the ref on screen again as its window comes to the front, and on a timer, which a test can reach when the recording didn't. Neither has an overview, so nothing changed.",
    derive: refsReadAgain,
  },
  {
    name: 'app_queued_left_polled',
    from: 'app_queued_left',
    description:
      "app_queued_left with GitHub's 304 to rozed-dev/e2e#207's overview ref read again with the ETag of its first read: Lo reads the ref on screen again as its window comes to the front, and on a timer, which a test can reach when the recording didn't. It has no overview, so nothing changed.",
    derive: refsReadAgain,
  },
];
