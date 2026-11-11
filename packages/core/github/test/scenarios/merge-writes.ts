/**
 * The merge writes recorded on `rozed-dev/e2e` as `rozed-bot`: async merges, the merge queue,
 * auto-merge, GitHub stacks and base branches. Each recording ran its scenario against GitHub with
 * what was made on GitHub for it (its {@link Setup}, kept in the cassette); the replay runs the
 * scenario with the same setup, so both send the same requests in the same order.
 *
 * The pull requests the recordings opened are rozed-bot's, on branches named `e9b/<kind>-<run>`
 * into `e9b/base`, which no ruleset covers. The others are E4's (#25–#30 on `e4/gated` are only
 * refused, and keep their states), its merge queue's (on `e4/queued`, used up and made again
 * between recordings), and E1's closed #14.
 *
 * Before every merge, enqueue and auto-merge, Lo reads the GitHub stacks holding the pull request.
 * The scenarios but `stacks`, `stackMerge` and `layerMoved` were recorded before it did, so those
 * lookups are in a cassette of their own, {@link LOOKUPS}, replayed with them: none of their pull
 * requests was ever in a stack, as their timelines show, so GitHub's answer, none, was the same
 * then ({@link lookups}).
 */

import { cassette, type CassetteInfo, type Interaction } from '@lo/testing';

import type { GithubClient } from '../../src/client.ts';
import { GithubError } from '../../src/errors.ts';
import type { PullRequestMergeMethod } from '../../src/generated/graphql.ts';
import { Fields } from '../../src/json.ts';
import {
  addToStack,
  changeBase,
  createStack,
  dequeue,
  directMerge,
  disableAutoMerge,
  enableAutoMerge,
  enqueue,
  isRefusal,
  mergeAsync,
  mergeAsyncResult,
  queueMerge,
  readAsyncMerge,
  retarget,
  runConversionStep,
  stacks as listStacks,
  unstack,
  withCommit,
  withLayersBelow,
  type AsyncMerge,
  type AutoMergeRequest,
  type AutoMergeState,
  type Dequeued,
  type GithubStack,
  type MergeRefusal,
  type MergeRequest,
  type QueueEntry,
  type Retarget,
  type StackList,
  type StepDone,
  type Submitted,
} from '../../src/merge-writes.ts';
import { readPullSummary, type PullSummary } from '../../src/pulls.ts';
import { PullRef, RepoRef } from '../../src/refs.ts';

export const REPO = 'rozed-dev/e2e';
/** The base branch of the pull requests the recorder opens. */
export const BASE = 'e9b/base';

/** Waits for GitHub, in milliseconds: a pause when recording, nothing when replaying. */
export type Pause = (ms: number) => Promise<void>;

/** A pull request that doesn't exist, which `refused` merges. */
export const MISSING = 99999;

/**
 * The cassette of the stack lookups Lo makes before merging, enqueuing or turning auto-merge on
 * for the pull requests the scenarios recorded before it made them.
 */
export const LOOKUPS = 'merge_writes_e2e_lookups';

/** The recorded answers to Lo's stack lookups before those merges, from {@link LOOKUPS}. */
export function lookups(): Interaction[] {
  return cassette(LOOKUPS).interactions.map(({ interaction }) => interaction);
}

/** How long to wait between asking how an async merge goes, when recording. */
const POLL_MS = 1000;
/** The most times a scenario asks how one merge goes. */
const MAX_POLLS = 120;

export function repo(): RepoRef {
  return new RepoRef('rozed-dev', 'e2e');
}

/** What a call answered: its value, a refusal being a value too, or the error it failed with. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: GithubError };

/** `call`'s result: a {@link GithubError} is kept, anything else thrown is a bug and fails. */
export async function attempt<T>(call: Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await call };
  } catch (error) {
    if (error instanceof GithubError) return { ok: false, error };
    throw error;
  }
}

/** A pull request a scenario uses, as it was when the recorder set the scenario up. */
export interface Pr {
  number: number;
  nodeId: string;
  branch: string;
  head: string;
}

export function pullOf(pr: Pr): PullRef {
  return new PullRef('rozed-dev', 'e2e', pr.number);
}

/** What the recorder made or found for the scenarios: kept in each cassette as its setup. */
export interface Setup {
  /** The recorder's run, which names its branches. */
  run: number;
  /** rozed-bot's pull request into {@link BASE} that merges, when the run recorded `merged`. */
  merged: Pr | undefined;
  /**
   * rozed-bot's pull request into {@link BASE} with two commits, merged first at the first one,
   * when the run recorded `moved`.
   */
  moved: Pr | undefined;
  /**
   * A commit that's no pull request's head: `moved`'s first commit, or else `e9b/base`'s head when
   * the run started.
   */
  stale: string;
  /** rozed-bot's pull request into {@link BASE} that stays open, for the refusals. */
  open: Pr;
  /**
   * rozed-bot's pull requests made into a stack, bottom to top: the first into {@link BASE}, the
   * second into the first's branch, and the third on the second's branch, but into {@link BASE},
   * so it's retargeted before it joins. Empty when the run didn't record `stacks`.
   */
  stack: Pr[];
  /**
   * rozed-bot's pull requests made into a stack by the recorder, bottom to top, at the heads Lo
   * "showed", when the run recorded `layerMoved`. The recorder then pushed to the bottom one:
   * `pushed` is its head since.
   */
  layered: Pr[];
  pushed: string | undefined;
  /** E4's pull requests on `e4/gated`, which GitHub refuses to merge. */
  draft: Pr;
  conflict: Pr;
  passing: Pr;
  failing: Pr;
  /** E1's closed pull request. */
  closed: Pr;
  /** E4's pull requests for the merge queue on `e4/queued`. */
  queueSlow: Pr;
  queuePass: Pr;
  queueFail: Pr;
}

function readPr(fields: Fields): Pr {
  return {
    number: fields.integer('number'),
    nodeId: fields.text('node_id'),
    branch: fields.text('branch'),
    head: fields.text('head'),
  };
}

function readPrs(setup: Fields, key: string): Pr[] {
  const list: unknown = setup.raw(key) ?? [];
  if (!Array.isArray(list)) throw new Error(`the setup's ${key} isn't a list`);
  return list.map((pr: unknown, index) => readPr(new Fields(pr, `${key}[${index}]`)));
}

/** The setup a cassette keeps. */
export function setupOf(info: CassetteInfo): Setup {
  const setup = new Fields(info.setup, 'setup');
  const maybe = (key: string): Pr | undefined => {
    const fields = setup.maybeFields(key);
    return fields && readPr(fields);
  };
  const required = (key: string): Pr => readPr(setup.fields(key));
  return {
    run: setup.integer('run'),
    merged: maybe('merged'),
    moved: maybe('moved'),
    stale: setup.text('stale'),
    open: required('open'),
    stack: readPrs(setup, 'stack'),
    layered: readPrs(setup, 'layered'),
    pushed: setup.maybeText('pushed'),
    draft: required('draft'),
    conflict: required('conflict'),
    passing: required('passing'),
    failing: required('failing'),
    closed: required('closed'),
    queueSlow: required('queue_slow'),
    queuePass: required('queue_pass'),
    queueFail: required('queue_fail'),
  };
}

/** `value`, or a failure naming `what` that the run didn't make. */
function made<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`the run made ${what}`);
  return value;
}

/** The request `made` is, or a failure if Lo refused it. */
function requested(request: MergeRequest | { refusal: string }): MergeRequest {
  if (isRefusal(request)) throw new Error(`refused: ${JSON.stringify(request)}`);
  return request;
}

export function direct(sha: string, method: PullRequestMergeMethod): MergeRequest {
  return requested(directMerge(sha, method));
}

/** An async merge sent, and every answer to asking how it went. */
export interface Followed {
  submitted: Result<Submitted | MergeRefusal>;
  answers: Result<AsyncMerge>[];
}

/** Asks how the merge `uuid` on `pull` goes until it's no longer pending. */
export async function follow(
  client: GithubClient,
  pull: PullRef,
  uuid: string,
  pause: Pause,
): Promise<Result<AsyncMerge>[]> {
  const answers: Result<AsyncMerge>[] = [];
  for (let asked = 0; asked < MAX_POLLS; asked++) {
    await pause(POLL_MS);
    const answer = await attempt(mergeAsyncResult(client, pull, uuid));
    answers.push(answer);
    if (!(answer.ok && answer.value.status === 'pending')) break;
  }
  return answers;
}

/** The UUID of the merge `submitted` is, when GitHub answered `kind`. */
function uuidIf(
  submitted: Result<Submitted | MergeRefusal>,
  kind: 'accepted' | 'alreadyRunning',
): string | undefined {
  if (!submitted.ok || isRefusal(submitted.value)) return undefined;
  const { value } = submitted;
  return value.kind === kind ? value.uuid : undefined;
}

/** Sends `request` for `pull`, then follows the merge GitHub took, if it took one. */
export async function merge(
  client: GithubClient,
  pull: PullRef,
  request: MergeRequest,
  pause: Pause,
): Promise<Followed> {
  const submitted = await attempt(mergeAsync(client, pull, request));
  const uuid = uuidIf(submitted, 'accepted') ?? uuidIf(submitted, 'alreadyRunning');
  const answers = uuid === undefined ? [] : await follow(client, pull, uuid, pause);
  return { submitted, answers };
}

/** The pull request as REST has it now. */
export function pullNow(client: GithubClient, pr: Pr): Promise<Result<PullSummary>> {
  return attempt(client.get(`/repos/${REPO}/pulls/${pr.number}`, readPullSummary));
}

/** What merging rozed-bot's own pull request saw. */
export interface Merged {
  /** Squash-merged at its head: taken, then pending, then merged. */
  merged: Followed;
  /** Sent again once it's merged: done already. */
  again: Result<Submitted | MergeRefusal>;
  /** The first merge's UUID asked about again. */
  askedAgain: Result<AsyncMerge> | undefined;
  after: Result<PullSummary>;
}

export async function merged(client: GithubClient, setup: Setup, pause: Pause): Promise<Merged> {
  const pr = made(setup.merged, '`merged`');
  const pull = pullOf(pr);
  const title = `Fixture 9b: merge run ${setup.run}`;
  const request = withCommit(direct(pr.head, 'SQUASH'), title, undefined);
  const first = await merge(client, pull, request, pause);
  const again = await attempt(mergeAsync(client, pull, request));
  const uuid = uuidIf(first.submitted, 'accepted');
  const askedAgain =
    uuid === undefined ? undefined : await attempt(mergeAsyncResult(client, pull, uuid));
  const after = await pullNow(client, pr);
  return { merged: first, again, askedAgain, after };
}

/** What merging a pull request whose head moved saw, then merging it twice at once. */
export interface Moved {
  /** Sent with its first commit, which isn't its head. */
  stale: Followed;
  /** Sent with its head, then the same again before the first finished. */
  first: Result<Submitted | MergeRefusal>;
  second: Result<Submitted | MergeRefusal>;
  answers: Result<AsyncMerge>[];
  after: Result<PullSummary>;
}

export async function moved(client: GithubClient, setup: Setup, pause: Pause): Promise<Moved> {
  const pr = made(setup.moved, '`moved`');
  const pull = pullOf(pr);
  const stale = await merge(client, pull, direct(setup.stale, 'MERGE'), pause);
  await pause(3000);
  const request = direct(pr.head, 'MERGE');
  const first = await attempt(mergeAsync(client, pull, request));
  const second = await attempt(mergeAsync(client, pull, request));
  const uuid = uuidIf(first, 'accepted') ?? uuidIf(second, 'alreadyRunning');
  const answers = uuid === undefined ? [] : await follow(client, pull, uuid, pause);
  const after = await pullNow(client, pr);
  return { stale, first, second, answers, after };
}

/** What GitHub said to merges it refuses, on E4's and E1's pull requests, and about what it doesn't know. */
export interface Refused {
  draft: Followed;
  conflict: Followed;
  /** Waiting on an approval. */
  passing: Followed;
  /** A required check failed, and an approval is missing. */
  failing: Followed;
  closed: Followed;
  /** A pull request that doesn't exist. */
  missing: Followed;
  /** A UUID GitHub never gave. */
  unknownUuid: Result<AsyncMerge>;
  /** Into a queue on a branch with no merge queue. */
  noQueue: Followed;
}

/** A UUID no merge has. */
export const UNKNOWN_UUID = '00000000-0000-0000-0000-000000000000';

export async function refused(client: GithubClient, setup: Setup, pause: Pause): Promise<Refused> {
  const squash = (pr: Pr): MergeRequest => direct(pr.head, 'SQUASH');
  const draft = await merge(client, pullOf(setup.draft), squash(setup.draft), pause);
  const conflict = await merge(client, pullOf(setup.conflict), squash(setup.conflict), pause);
  const passing = await merge(client, pullOf(setup.passing), squash(setup.passing), pause);
  const failing = await merge(client, pullOf(setup.failing), squash(setup.failing), pause);
  const closed = await merge(client, pullOf(setup.closed), squash(setup.closed), pause);
  const missingPull = new PullRef('rozed-dev', 'e2e', MISSING);
  const missing = await merge(client, missingPull, direct(setup.open.head, 'SQUASH'), pause);
  const unknownUuid = await attempt(mergeAsyncResult(client, pullOf(setup.open), UNKNOWN_UUID));
  const intoQueue = requested(queueMerge(setup.open.head));
  const noQueue = await merge(client, pullOf(setup.open), intoQueue, pause);
  return { draft, conflict, passing, failing, closed, missing, unknownUuid, noQueue };
}

/** What the merge queue on `e4/queued` saw, and enqueuing where there's none. */
export interface Queue {
  /** The fail-in-queue pull request, enqueued expecting a head it doesn't have. */
  wrongHead: Result<QueueEntry | MergeRefusal>;
  /** The slow pull request, which is ready: auto-merge ("Merge when ready") turned on, then off. */
  autoMergeOn: Result<AutoMergeState | MergeRefusal>;
  autoMergeOff: Result<AutoMergeState | MergeRefusal>;
  /** The slow one enqueued at its head. */
  slow: Result<QueueEntry | MergeRefusal>;
  /** The fail-in-queue one enqueued at its head, jumping the queue, then taken out, twice. */
  jumped: Result<QueueEntry | MergeRefusal>;
  dequeued: Result<Dequeued | MergeRefusal>;
  dequeuedAgain: Result<Dequeued | MergeRefusal>;
  /** The passing one sent into the queue as an async merge, then sent again. */
  pass: Followed;
  passAgain: Result<Submitted | MergeRefusal>;
  /** rozed-bot's open pull request, on a branch with no queue, enqueued, and taken out of the queue it isn't in. */
  noQueue: Result<QueueEntry | MergeRefusal>;
  notQueued: Result<Dequeued | MergeRefusal>;
}

export async function queue(client: GithubClient, setup: Setup, pause: Pause): Promise<Queue> {
  const { queueSlow: slow, queuePass: pass, queueFail: fail } = setup;
  const wrongHead = await attempt(enqueue(client, pullOf(fail), fail.nodeId, setup.stale, false));
  const request = { expectedHead: slow.head, method: 'SQUASH' } as const;
  const autoMergeOn = await attempt(enableAutoMerge(client, pullOf(slow), slow.nodeId, request));
  await pause(2000);
  const autoMergeOff = await attempt(disableAutoMerge(client, slow.nodeId));
  await pause(2000);
  const slowEntry = await attempt(enqueue(client, pullOf(slow), slow.nodeId, slow.head, false));
  await pause(2000);
  const jumped = await attempt(enqueue(client, pullOf(fail), fail.nodeId, fail.head, true));
  await pause(1000);
  const dequeued = await attempt(dequeue(client, fail.nodeId));
  await pause(2000);
  const dequeuedAgain = await attempt(dequeue(client, fail.nodeId));
  const intoQueue = requested(queueMerge(pass.head));
  const passPull = pullOf(pass);
  const passMerge = await merge(client, passPull, intoQueue, pause);
  const passAgain = await attempt(mergeAsync(client, passPull, intoQueue));
  const { open } = setup;
  const noQueue = await attempt(enqueue(client, pullOf(open), open.nodeId, open.head, false));
  const notQueued = await attempt(dequeue(client, open.nodeId));
  return {
    wrongHead,
    autoMergeOn,
    autoMergeOff,
    slow: slowEntry,
    jumped,
    dequeued,
    dequeuedAgain,
    pass: passMerge,
    passAgain,
    noQueue,
    notQueued,
  };
}

/** What turning auto-merge on and off saw where GitHub refuses it. */
export interface AutoMerge {
  /** On E4's passing pull request, waiting on an approval: the repository doesn't allow it. */
  blocked: Result<AutoMergeState | MergeRefusal>;
  /** On rozed-bot's open pull request, which nothing blocks. */
  clean: Result<AutoMergeState | MergeRefusal>;
  /** Off, where it isn't on. */
  off: Result<AutoMergeState | MergeRefusal>;
  /** On, expecting a head the pull request doesn't have. */
  wrongHead: Result<AutoMergeState | MergeRefusal>;
}

/** Turns auto-merge on with a squash, expecting `expectedHead`. */
function squashing(expectedHead: string): AutoMergeRequest {
  return { expectedHead, method: 'SQUASH' };
}

export async function autoMerge(client: GithubClient, setup: Setup): Promise<AutoMerge> {
  const { passing, open } = setup;
  const [passingPull, openPull] = [pullOf(passing), pullOf(open)];
  const blocked = await attempt(
    enableAutoMerge(client, passingPull, passing.nodeId, squashing(passing.head)),
  );
  const clean = await attempt(enableAutoMerge(client, openPull, open.nodeId, squashing(open.head)));
  const off = await attempt(disableAutoMerge(client, passing.nodeId));
  const wrongHead = await attempt(
    enableAutoMerge(client, passingPull, passing.nodeId, squashing(setup.stale)),
  );
  return { blocked, clean, off, wrongHead };
}

/** What the Stacks API and changing base branches saw. */
export interface Stacks {
  /** A repository that doesn't exist: the API's "not found". */
  unavailable: Result<StackList | undefined>;
  /** e2e's stacks, before anything here. */
  listed: Result<StackList | undefined>;
  /** The bottom two made a stack, then the same again. */
  created: Result<GithubStack | MergeRefusal>;
  createdAgain: Result<GithubStack | MergeRefusal>;
  /** The open pull request and the third, which isn't based on it. */
  notAChain: Result<GithubStack | MergeRefusal>;
  /** The third added while it's based on the base branch, not the second's. */
  addUnchained: Result<GithubStack | MergeRefusal>;
  /**
   * The third moved onto the second's branch, then the same again, then expecting a branch it
   * isn't on.
   */
  retargeted: Result<StepDone | MergeRefusal>;
  retargetedAgain: Result<PullSummary | MergeRefusal>;
  retargetChanged: Result<PullSummary | MergeRefusal>;
  /** A base branch that doesn't exist. */
  missingBase: Result<PullSummary | MergeRefusal>;
  /** The third added, then the stack holding it listed. */
  added: Result<StepDone | MergeRefusal>;
  ofThird: Result<StackList | undefined>;
  /** Unstacked, then the stack made again from all three. */
  unstacked: Result<{ left: GithubStack | undefined } | MergeRefusal>;
  remade: Result<StepDone | MergeRefusal>;
}

function numbersOf(prs: readonly Pr[]): number[] {
  return prs.map((pr) => pr.number);
}

export async function stacks(client: GithubClient, setup: Setup, pause: Pause): Promise<Stacks> {
  const [bottom, middle, top] = setup.stack;
  if (
    bottom === undefined ||
    middle === undefined ||
    top === undefined ||
    setup.stack.length !== 3
  ) {
    throw new Error('the stack has three pull requests');
  }
  const rozedRepo = repo();
  const unavailable = await attempt(listStacks(client, new RepoRef('rozed-dev', 'does-not-exist')));
  const listed = await attempt(listStacks(client, rozedRepo));
  const created = await attempt(createStack(client, rozedRepo, numbersOf([bottom, middle])));
  await pause(2000);
  const createdAgain = await attempt(createStack(client, rozedRepo, numbersOf([bottom, middle])));
  const notAChain = await attempt(createStack(client, rozedRepo, numbersOf([setup.open, top])));
  const stack = created.ok && !isRefusal(created.value) ? created.value.number : 0;
  const addUnchained = await attempt(addToStack(client, rozedRepo, stack, numbersOf([top])));
  const ontoMiddle: Retarget = { pr: top.number, from: BASE, to: middle.branch };
  // As "Make this a GitHub stack" runs its steps.
  const retargeted = await attempt(
    runConversionStep(client, rozedRepo, { kind: 'retarget', retarget: ontoMiddle }),
  );
  await pause(2000);
  const retargetedAgain = await attempt(retarget(client, rozedRepo, ontoMiddle));
  const elsewhere: Retarget = { pr: top.number, from: 'e9b/elsewhere', to: BASE };
  const retargetChanged = await attempt(retarget(client, rozedRepo, elsewhere));
  const missingBase = await attempt(changeBase(client, pullOf(setup.open), 'e9b/does-not-exist'));
  const added = await attempt(
    runConversionStep(client, rozedRepo, { kind: 'addToStack', stack, prs: numbersOf([top]) }),
  );
  await pause(2000);
  const ofThird = await attempt(listStacks(client, rozedRepo, top.number));
  const unstacked = await attempt(unstack(client, rozedRepo, stack));
  await pause(3000);
  const remade = await attempt(
    runConversionStep(client, rozedRepo, {
      kind: 'createStack',
      prs: numbersOf([bottom, middle, top]),
    }),
  );
  return {
    unavailable,
    listed,
    created,
    createdAgain,
    notAChain,
    addUnchained,
    retargeted,
    retargetedAgain,
    retargetChanged,
    missingBase,
    added,
    ofThird,
    unstacked,
    remade,
  };
}

/** What merging the stack's top layer saw: every layer below merges with it. */
export interface StackMerge {
  merged: Followed;
  /** Each layer afterwards, bottom to top. */
  layers: Result<PullSummary>[];
  /** The open stacks holding the bottom layer afterwards: none, once every layer merged. */
  stack: Result<StackList | undefined>;
}

/** The layers below the top of `stack`, with their heads as set up: what Lo showed. */
export function layersBelow(stack: readonly Pr[]): { pr: number; head: string }[] {
  if (stack.length === 0) throw new Error('the stack has layers');
  return stack.slice(0, -1).map((pr) => ({ pr: pr.number, head: pr.head }));
}

export async function stackMerge(
  client: GithubClient,
  setup: Setup,
  pause: Pause,
): Promise<StackMerge> {
  const top = setup.stack.at(-1);
  const bottom = setup.stack[0];
  if (top === undefined || bottom === undefined) throw new Error('the stack has layers');
  const request = requested(withLayersBelow(direct(top.head, 'SQUASH'), layersBelow(setup.stack)));
  const followed = await merge(client, pullOf(top), request, pause);
  await pause(5000);
  const layers: Result<PullSummary>[] = [];
  for (const layer of setup.stack) layers.push(await pullNow(client, layer));
  const stack = await attempt(listStacks(client, repo(), bottom.number));
  return { merged: followed, layers, stack };
}

/** What merging a stack whose bottom layer moved saw: Lo refusing, then GitHub's own answer to a merge that names only the top's head. */
export interface LayerMoved {
  /** Lo's stack merge, with the bottom layer's head as Lo showed it: refused before sending. */
  refused: Result<Submitted | MergeRefusal>;
  /**
   * Lo's merge of the top naming no layer below: refused before sending, since the bottom would
   * merge with it. Not in the recording, which predates it; replayed from its lookup.
   */
  unnamed: Result<Submitted | MergeRefusal>;
  /**
   * The same merge sent past Lo, as `merge-async`'s own JSON, to see what GitHub does with a
   * merge that names only the top's head.
   */
  unchecked: Followed;
  /** Each layer afterwards, bottom to top. */
  layers: Result<PullSummary>[];
}

/**
 * Squash-merges `pull` at `head` through `merge-async` itself, past Lo's checks, then follows the
 * merge GitHub took, if it took one. The JSON is the bytes {@link directMerge} sends.
 */
async function mergePastLo(
  client: GithubClient,
  pull: PullRef,
  head: string,
  pause: Pause,
): Promise<Followed> {
  const path = `/repos/${REPO}/pulls/${pull.number}/merge-async`;
  const body = JSON.stringify({ sha: head, merge_method: 'squash', merge_action: 'direct_merge' });
  const sent = await attempt(client.write('PUT', path, body, readAsyncMerge));
  const submitted: Result<Submitted | MergeRefusal> = sent.ok
    ? { ok: true, value: submittedBy(sent.value) }
    : sent;
  const uuid = uuidIf(submitted, 'accepted');
  const answers = uuid === undefined ? [] : await follow(client, pull, uuid, pause);
  return { submitted, answers };
}

/** What a pending answer with a UUID is, as Lo reads one: accepted; any other, done. */
function submittedBy(answer: AsyncMerge): Submitted {
  const { uuid } = answer.details;
  return uuid !== undefined && answer.status === 'pending'
    ? { kind: 'accepted', uuid, answer }
    : { kind: 'done', answer };
}

export async function layerMoved(
  client: GithubClient,
  setup: Setup,
  pause: Pause,
): Promise<LayerMoved> {
  const top = setup.layered.at(-1);
  if (top === undefined) throw new Error('the run made `layered`');
  const pull = pullOf(top);
  const request = requested(
    withLayersBelow(direct(top.head, 'SQUASH'), layersBelow(setup.layered)),
  );
  const refusedMerge = await attempt(mergeAsync(client, pull, request));
  const plain = direct(top.head, 'SQUASH');
  const unnamed = await attempt(mergeAsync(client, pull, plain));
  const unchecked = await mergePastLo(client, pull, top.head, pause);
  await pause(5000);
  const layers: Result<PullSummary>[] = [];
  for (const layer of setup.layered) layers.push(await pullNow(client, layer));
  return { refused: refusedMerge, unnamed, unchecked, layers };
}
