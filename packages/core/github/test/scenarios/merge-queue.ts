/**
 * The merge queue reads recorded on `rozed-dev/e2e` as `rozed-bot`, on one generation of the merge
 * fixture (`testing/fixtures/merge.sh`) that no other recording uses: its four pull requests into
 * `e4/queued`, whose ruleset merges through a queue and requires `ci`. `queued-pass` passes,
 * `queued-slow-1` and `queued-slow-2` pass after ten minutes, and `queued-fail` passes on the pull
 * request and fails in the queue.
 *
 *   LO_MERGE_GENERATION=<generation> LO_RECORD_WRITES=1 LO_FIXTURE_TOKEN_FILE=<file> \
 *     node testing/scripts/record.ts packages/core/github/test/scenarios/merge-queue.ts
 *
 * Run `queue_view_e2e` and `queue_removal_e2e` in this order as soon as `merge.sh` has opened the
 * generation, and `queue_waiting_e2e` while `queued-slow-2` is open and out of the queue: before
 * them, or after `queue_removal_e2e` has taken it out.
 *
 * - `queue_waiting_e2e` turns auto-merge on for `queued-slow-2` while its `ci` runs, running it
 *   again first if it has finished, reads the open pull requests into `e4/queued`, with it waiting
 *   to join the queue, and turns auto-merge off again, so it never joins by itself;
 * - `queue_view_e2e` waits for `ci` to pass on each of the four, adds them to the queue in turn
 *   (`merge-async`, as Lo's merge panel does), slow ones first, then reads the queue as GitHub tests
 *   them together, until the one that fails in the queue is failing or gone;
 * - `queue_removal_e2e` takes `queued-slow-2` out of the queue by hand, then reads why it left, why
 *   `queued-fail` left once GitHub has taken it out, and, once it merges, `queued-pass`.
 *
 * Only the reads and writes the tests replay are recorded. Finding the generation's pull requests
 * and waiting on GitHub go through another client, unrecorded, and only read. Every write is to one
 * of the generation's pull requests, each checked first: its title starts `Fixture M<generation>:`,
 * its branch is the generation's, and it's into `e4/queued`.
 */

import type { Json, Scenario } from '@lo/testing';

import { GithubClient } from '../../src/client.ts';
import { Fields } from '../../src/json.ts';
import { queueRemoval, queueView, queueWaiting, type QueueView } from '../../src/merge-queue.ts';
import {
  dequeueNamed,
  disableAutoMerge,
  enableAutoMerge,
  isRefusal,
  mergeAsync,
  mergeAsyncResult,
  queueMerge,
} from '../../src/merge-writes.ts';
import { PullRef, RepoRef } from '../../src/refs.ts';
import { Token } from '../../src/token.ts';

export const REPO = new RepoRef('rozed-dev', 'e2e');
/** The schema the queries were checked against when these were recorded. */
const SCHEMA = 'github/docs@03caf3ce9bc56af9d147500036b0bb6dda352674';
/** The branch whose queue is read. */
export const BRANCH = 'e4/queued';

/** The generation's pull requests into {@link BRANCH}, by their name in `merge.sh`. */
export const NAMES = ['queued-slow-1', 'queued-slow-2', 'queued-pass', 'queued-fail'] as const;
export type Name = (typeof NAMES)[number];

/** A pull request of the generation, as the recording found it. */
export interface Pr {
  number: number;
  id: string;
  head: string;
}

/** What the recording found for itself, which each cassette keeps as its setup. */
export interface Setup {
  generation: number;
  pulls: Record<Name, Pr>;
}

/** The generation's pull request `name`, as a cassette's setup keeps it in `pulls`. */
function prOf(pulls: Fields, name: Name): Pr {
  const fields = pulls.fields(name);
  return { number: fields.integer('number'), id: fields.text('id'), head: fields.text('head') };
}

/** The setup a cassette keeps. */
export function setupOf(json: unknown): Setup {
  const setup = new Fields(json, 'setup');
  const pulls = setup.fields('pulls');
  const pr = (name: Name): Pr => prOf(pulls, name);
  return {
    generation: setup.integer('generation'),
    pulls: {
      'queued-slow-1': pr('queued-slow-1'),
      'queued-slow-2': pr('queued-slow-2'),
      'queued-pass': pr('queued-pass'),
      'queued-fail': pr('queued-fail'),
    },
  };
}

/**
 * The generation's pull requests `queue_waiting_e2e` reads, open and out of the queue:
 * `queued-slow-2`, which waits to join with auto-merge on, and `queued-fail`, which doesn't.
 */
export const WAITING_NAMES = ['queued-slow-2', 'queued-fail'] as const;
export type WaitingName = (typeof WAITING_NAMES)[number];

/** What `queue_waiting_e2e` found for itself. */
export interface WaitingSetup {
  generation: number;
  pulls: Record<WaitingName, Pr>;
}

/** The setup `queue_waiting_e2e` keeps. */
export function waitingSetupOf(json: unknown): WaitingSetup {
  const setup = new Fields(json, 'setup');
  const pulls = setup.fields('pulls');
  return {
    generation: setup.integer('generation'),
    pulls: {
      'queued-slow-2': prOf(pulls, 'queued-slow-2'),
      'queued-fail': prOf(pulls, 'queued-fail'),
    },
  };
}

export function pullOf(pr: Pr): PullRef {
  return new PullRef(REPO.owner, REPO.name, pr.number);
}

const SECOND = 1000;
const MINUTE = 60 * SECOND;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Asks `done` every `every` until it answers, or fails naming `what` after `within`. */
async function waitFor<T>(
  what: string,
  every: number,
  within: number,
  done: () => Promise<T | undefined>,
): Promise<T> {
  const until = Date.now() + within;
  for (;;) {
    const found = await done();
    if (found !== undefined) return found;
    if (Date.now() > until) throw new Error(`gave up waiting for ${what}`);
    console.log(`waiting for ${what}`);
    await sleep(every);
  }
}

/** The generation the recording is for, from `LO_MERGE_GENERATION`. */
function generation(): number {
  const value = Number(process.env['LO_MERGE_GENERATION']);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error('Set LO_MERGE_GENERATION to the merge fixture generation to record on.');
  }
  return value;
}

/** A client that reaches GitHub without recording, for finding and waiting. */
function unrecorded(token: string): GithubClient {
  return new GithubClient({ fetch: globalThis.fetch, token: new Token(token) });
}

/** An open pull request into {@link BRANCH}, as REST lists it. */
interface Listed {
  number: number;
  id: string;
  title: string;
  branch: string;
  head: string;
  base: string;
}

/** The open pull requests into {@link BRANCH}. */
function openInto(github: GithubClient): Promise<Listed[]> {
  return github.get(
    `/repos/${REPO.owner}/${REPO.name}/pulls?state=open&base=${BRANCH}&per_page=100`,
    (json) => {
      if (!Array.isArray(json)) throw new Error('the pull requests were not a list');
      return json.map((item: unknown) => {
        const pull = new Fields(item, 'pull');
        const head = pull.fields('head');
        return {
          number: pull.integer('number'),
          id: pull.text('node_id'),
          title: pull.text('title'),
          branch: head.text('ref'),
          head: head.text('sha'),
          base: pull.fields('base').text('ref'),
        };
      });
    },
  );
}

/** Generation `number`'s pull request `name` among `listed`, checked to be its own. */
function named(listed: readonly Listed[], number: number, name: Name): Pr {
  const branch = `merge/${number}/${name}`;
  const found = listed.filter((pull) => pull.branch === branch);
  const [pull] = found;
  if (found.length !== 1 || !pull) throw new Error(`no one open pull request from ${branch}`);
  if (!pull.title.startsWith(`Fixture M${number}: `) || pull.base !== BRANCH) {
    throw new Error(`#${pull.number} isn't the generation's own`);
  }
  return { number: pull.number, id: pull.id, head: pull.head };
}

/** The generation's pull requests into {@link BRANCH}, checked to be its own. */
async function findPulls(github: GithubClient, number: number): Promise<Setup> {
  const listed = await openInto(github);
  const find = (name: Name): Pr => named(listed, number, name);
  return {
    generation: number,
    pulls: {
      'queued-slow-1': find('queued-slow-1'),
      'queued-slow-2': find('queued-slow-2'),
      'queued-pass': find('queued-pass'),
      'queued-fail': find('queued-fail'),
    },
  };
}

/** The conclusion of `ci` on `head`, or nothing while it hasn't completed. */
async function ciOn(github: GithubClient, head: string): Promise<string | undefined> {
  return github.get(
    `/repos/${REPO.owner}/${REPO.name}/commits/${head}/check-runs?check_name=ci`,
    (json) => {
      const runs = new Fields(json, 'check runs').raw('check_runs');
      if (!Array.isArray(runs)) throw new Error('the check runs were not a list');
      const run = runs[0] as unknown;
      if (run === undefined) return undefined;
      const fields = new Fields(run, 'check run');
      return fields.text('status') === 'completed' ? fields.maybeText('conclusion') : undefined;
    },
  );
}

function prJson({ number, id, head }: Pr): Json {
  return { number, id, head };
}

/**
 * Runs `ci` again on the pull request's head `head`, as its last run did, and waits until it's
 * running: a `pull_request` run keeps its event, so `queued-slow-2`'s runs ten minutes again.
 */
async function rerunCi(github: GithubClient, head: string): Promise<void> {
  const runs = await github.get(
    `/repos/${REPO.owner}/${REPO.name}/actions/runs?head_sha=${head}&event=pull_request`,
    (json) => {
      const listed = new Fields(json, 'runs').raw('workflow_runs');
      if (!Array.isArray(listed)) throw new Error('the workflow runs were not a list');
      return listed.map((run: unknown) => {
        const fields = new Fields(run, 'run');
        return { id: fields.integer('id'), name: fields.text('name') };
      });
    },
  );
  const run = runs.find((found) => found.name === 'ci');
  if (!run) throw new Error(`no ci run on ${head}`);
  await github.send('POST', `/repos/${REPO.owner}/${REPO.name}/actions/runs/${run.id}/rerun`);
  await waitFor('ci to run again', 5 * SECOND, 2 * MINUTE, async () =>
    (await ciOn(github, head)) === undefined ? true : undefined,
  );
}

function asJson(setup: Setup): Json {
  return {
    generation: setup.generation,
    pulls: Object.fromEntries(NAMES.map((name) => [name, prJson(setup.pulls[name])])),
  };
}

/** Entries from the queue's front built in one chain, each on the commit the one ahead is tested on. */
function builtTogether(view: QueueView): number {
  const entries = view.queue?.entries ?? [];
  let built = 0;
  for (const entry of entries) {
    if (entry.tested === undefined) break;
    const ahead = entries[built - 1];
    if (ahead !== undefined && entry.base !== ahead.tested) break;
    built += 1;
  }
  return built;
}

export const scenarios: Scenario[] = [
  {
    name: 'queue_waiting_e2e',
    description:
      "QueueWaiting for rozed-dev/e2e's e4/queued, read as rozed-bot, its admin, with a merge fixture generation's queued-slow-2 waiting to join the merge queue: open and out of the queue, ci running on its head (run again if it had finished), and auto-merge turned on by rozed-bot, squashing (enablePullRequestAutoMerge, unrecorded). Turned off again after the read, so it never joins. queued-fail is open too, with auto-merge off.",
    repo: 'rozed-dev/e2e',
    schema: SCHEMA,
    writes: true,
    async run(fetch, token) {
      const github = unrecorded(token);
      const number = generation();
      const listed = await openInto(github);
      const setup: WaitingSetup = {
        generation: number,
        pulls: {
          'queued-slow-2': named(listed, number, 'queued-slow-2'),
          'queued-fail': named(listed, number, 'queued-fail'),
        },
      };
      const slow = setup.pulls['queued-slow-2'];
      if ((await ciOn(github, slow.head)) !== undefined) await rerunCi(github, slow.head);
      const enabled = await enableAutoMerge(github, pullOf(slow), slow.id, {
        expectedHead: slow.head,
        method: 'SQUASH',
      });
      if (isRefusal(enabled) || enabled.autoMerge === undefined || enabled.inQueue) {
        throw new Error(`queued-slow-2 isn't waiting to join: ${JSON.stringify(enabled)}`);
      }
      try {
        const client = new GithubClient({ fetch, token: new Token(token) });
        await queueWaiting(client, REPO, BRANCH);
      } finally {
        const disabled = await disableAutoMerge(github, slow.id);
        if (isRefusal(disabled) || disabled.autoMerge !== undefined) {
          console.log(`turning auto-merge off for #${slow.number} failed`);
        }
      }
      return {
        generation: setup.generation,
        pulls: Object.fromEntries(WAITING_NAMES.map((name) => [name, prJson(setup.pulls[name])])),
      };
    },
  },
  {
    name: 'queue_view_e2e',
    description:
      "rozed-dev/e2e's merge queue for e4/queued, read as rozed-bot, its admin, as it tests a merge fixture generation's four pull requests: each added in turn once ci passed on it, through merge-async with merge_queue (queued-slow-1, queued-slow-2, queued-pass, then queued-fail), then QueueView every 20 s until GitHub has built two or more together and the one that fails in the queue is failing or gone.",
    repo: 'rozed-dev/e2e',
    schema: SCHEMA,
    writes: true,
    async run(fetch, token) {
      const github = unrecorded(token);
      const setup = await findPulls(github, generation());
      for (const name of NAMES) {
        const { head } = setup.pulls[name];
        const ci = await waitFor(`ci on ${name}`, 30 * SECOND, 25 * MINUTE, () =>
          ciOn(github, head),
        );
        if (ci !== 'success') throw new Error(`ci on ${name} ended ${ci}`);
      }
      const client = new GithubClient({ fetch, token: new Token(token) });
      for (const name of NAMES) {
        const pr = setup.pulls[name];
        const request = queueMerge(pr.head);
        if (isRefusal(request)) throw new Error(`${name}'s head isn't a commit`);
        const submitted = await mergeAsync(client, pullOf(pr), request);
        if (isRefusal(submitted) || submitted.kind !== 'accepted') {
          throw new Error(`${name} wasn't taken: ${JSON.stringify(submitted)}`);
        }
        await waitFor(`${name} to join`, SECOND, MINUTE, async () => {
          const answer = await mergeAsyncResult(client, pullOf(pr), submitted.uuid);
          return answer.status === 'pending' ? undefined : answer;
        });
      }
      const failing = setup.pulls['queued-fail'].number;
      let together = 0;
      await waitFor(
        'the queue to test together and fail one',
        20 * SECOND,
        12 * MINUTE,
        async () => {
          const view = await queueView(client, REPO, BRANCH);
          together = Math.max(together, builtTogether(view));
          const fail = view.queue?.entries.find((entry) => entry.pullRequest?.number === failing);
          const failed = fail === undefined || fail.state === 'UNMERGEABLE';
          return together > 1 && failed ? view : undefined;
        },
      );
      return asJson(setup);
    },
  },
  {
    name: 'queue_removal_e2e',
    description:
      "Why pull requests left rozed-dev/e2e's merge queue for e4/queued, read as rozed-bot with QueueRemoval, after queue_view_e2e added a merge fixture generation's four: queued-slow-2, which rozed-bot then took out by hand (dequeuePullRequest, after its GitHub stacks were read); queued-fail, once GitHub took it out when ci failed in the queue; and queued-pass, once it merged.",
    repo: 'rozed-dev/e2e',
    schema: SCHEMA,
    writes: true,
    async run(fetch, token) {
      const github = unrecorded(token);
      const setup = await findPulls(github, generation());
      const client = new GithubClient({ fetch, token: new Token(token) });
      const slow = setup.pulls['queued-slow-2'];
      const taken = await dequeueNamed(client, pullOf(slow), slow.id, BRANCH, []);
      if (isRefusal(taken))
        throw new Error(`queued-slow-2 wasn't taken out: ${JSON.stringify(taken)}`);
      const left = (pr: Pr) => async () => {
        const removal = await queueRemoval(github, pullOf(pr));
        return removal.inQueue || removal.removal === undefined ? undefined : removal;
      };
      await waitFor('queued-slow-2 to leave', 5 * SECOND, 2 * MINUTE, left(slow));
      await queueRemoval(client, pullOf(slow));
      const fail = setup.pulls['queued-fail'];
      await waitFor('queued-fail to leave', 30 * SECOND, 20 * MINUTE, left(fail));
      await queueRemoval(client, pullOf(fail));
      const pass = setup.pulls['queued-pass'];
      await waitFor('queued-pass to merge', 30 * SECOND, 25 * MINUTE, async () => {
        const removal = await queueRemoval(github, pullOf(pass));
        return removal.state === 'MERGED' ? removal : undefined;
      });
      await queueRemoval(client, pullOf(pass));
      return asJson(setup);
    },
  },
];
