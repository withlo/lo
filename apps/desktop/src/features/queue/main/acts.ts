// Changing a merge queue from its tab, in main: `x` takes an entry out, and `J` moves one to the
// front, which GitHub lets only the repository's admins do. Each is planned from a read of the
// queue no older than 40 s, read again first when the last one failed or is older, and kept under
// a key for the reader to confirm; the window confirms the key and never sends the change itself.
// A plan runs once. As it's confirmed, main checks it again: the tab is still open on the same
// branch, its account is there, GitHub can be reached and isn't holding writes, the entry is still
// in the queue at the head the question named, the layers of its GitHub stack that leave with it
// are still those named, no conversion to a GitHub stack runs on it, and no other merge write to
// any of them is under way. When what the question named changed, it asks again; else it refuses.
//
// Each change takes the turns of the pull requests it changes among merge writes, app-wide, which
// the merge feature hands out (`merge.writes`), so it never races a merge, an auto-merge change or
// another change to the queue of the same pull request. A change whose answer was lost holds them
// until a read of the branch it changed, made after it, answers, which shows what GitHub did: the
// tab's own read while it shows that branch, else one of its own, at once when the tab closes or
// moves on. It's never sent again by itself. Before it's sent, a GitHub stack's layer above its
// bottom one isn't taken out, since GitHub takes a stack out from its bottom layer, and a layer of a
// stack with other open layers isn't moved, since GitHub queues a stack's layers in order. Nor is
// the entry at the front: moving it gains nothing, and GitHub tests it, and those tested with it,
// again from the start.
//
// `a` on a pull request waiting to join turns its auto-merge off at once, asking nothing, since
// that merges nothing, in its turn too. Nothing here calls Electron.

import {
  GithubError,
  isFullSha,
  isRefusal,
  openLayers,
  PullRef,
  queueViewCutShort,
  RepoRef,
  stacksHolding,
  type AutoMergeState,
  type Dequeued,
  type GithubClient,
  type GithubStack,
  type Jumped,
  type MergeRefusal,
  type PollStatus,
  type QueueEntryFacts,
  type QueueView,
} from '@lo/github';

import { githubCause } from '../../../ipc/cause.ts';
import type { MergeTurn, MergeWrites } from '../../merge/service.ts';
import type { Converting } from '../../stacks/service.ts';
import type { QueueTab } from '../../tab/contract.ts';
import type { Acted, ActKind, ActPlan, ActPlanned, ActWhy } from '../contract.ts';
import {
  causeOf,
  LEFT_OUT,
  NO_ANSWER,
  QUEUE_CHANGED,
  rateLimited,
  refusalOf,
  signedOut,
  textOf,
} from './causes.ts';
import type { QueueWatch } from './watch.ts';

/** How old a read of the queue a change may act on: 40 s. Older, it's read again first. */
export const ACT_WITHIN = 40_000;

/** The first wait before reading the queue again, when a read that settles a change fails. */
export const SETTLE_AGAIN = 5_000;

/** The longest wait between reads that settle a change, while they fail. */
export const SETTLE_MOST = 120_000;

/** What changing the queue uses of an account's poller. */
export interface ActPoller {
  status(): Pick<PollStatus, 'offline' | 'signedOut'>;
  writesHeldUntil(): number | undefined;
  readOnce<T>(request: (client: GithubClient) => Promise<T>, signal?: AbortSignal): Promise<T>;
  dequeue(
    pull: PullRef,
    pullRequestId: string,
    branch: string,
    above: readonly number[],
  ): Promise<Dequeued | MergeRefusal>;
  jump(pull: PullRef, pullRequestId: string, expectedHead: string): Promise<Jumped | MergeRefusal>;
  disableAutoMerge(pull: PullRef, pullRequestId: string): Promise<AutoMergeState | MergeRefusal>;
}

/** What changing the queue uses of a merge queue's tab's reads. */
export type ActWatch = Pick<QueueWatch, 'branch' | 'away' | 'fresh' | 'freshWaiting'>;

export interface QueueActsOptions {
  /** Merge queue tab `id`, while it's open, with its reads. */
  readonly tab: (id: string) => { readonly tab: QueueTab; readonly watch: ActWatch } | undefined;
  /** An account's poller. Throws for an account Lo doesn't have. */
  readonly poller: (login: string) => Promise<ActPoller>;
  /** The turns of merge writes to pull requests, app-wide. */
  readonly writes: MergeWrites;
  /** The conversion to a GitHub stack changing `repo`'s base branches, if one is. */
  readonly converting: (repo: RepoRef) => Converting | undefined;
  /**
   * Reads `branch`'s merge queue, or those waiting to join it, in `on`'s repository as its account,
   * apart from any tab: what settles a change once its tab closed or shows another branch. Throws
   * when it can't.
   */
  readonly readBranch: (on: ActOn, branch: string, kind: SettleKind) => Promise<void>;
  readonly log: (line: string) => void;
  /** The time, in milliseconds since the Unix epoch. */
  readonly now?: () => number;
  /** A new plan's key. */
  readonly newKey?: () => string;
  /** The change the plan named `key` holds passed its checks, and is about to be sent. */
  readonly sent?: (key: string) => void;
}

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly plan: ActPlan;
  /** The pull request's node ID, which the change names. */
  readonly pullRequestId: string;
  /** The open layers of its GitHub stack, bottom up, as GitHub listed them for the plan. */
  readonly layers: readonly number[];
}

/** The repository and account a change was made in, as a tab names them. */
export type ActOn = Pick<QueueTab, 'owner' | 'repo' | 'login'>;

/** What a read that settles a change reads: the queue, or those waiting to join it. */
export type SettleKind = 'queue' | 'waiting';

/** A change whose answer was lost, holding its pull requests' turns until a read shows what it did. */
interface Unsettled {
  /** The tab it was made from. */
  readonly id: string;
  readonly on: ActOn;
  /** The branch whose queue it changed. */
  readonly branch: string;
  readonly kind: SettleKind;
  /** When it ended: a read made after then settles it. */
  readonly endedAt: number;
  readonly turn: MergeTurn;
  /** Ends the wait before the next read, while it waits. */
  wake: (() => void) | undefined;
  /** Its tab closed or moved on while it read: the next read comes without a wait. */
  nudged: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/**
 * Why nothing in a queue changes now as `login` with `poller`, whatever the queue holds, if
 * nothing does. GitHub giving no answer crosses as its cause, with what the poller last heard
 * behind it, for the window to word.
 */
export function offWhy(
  poller: Pick<ActPoller, 'status' | 'writesHeldUntil'>,
  login: string,
): ActWhy | undefined {
  const status = poller.status();
  if (status.signedOut) return signedOut(login);
  if (status.offline) {
    return { why: '', cause: githubCause(status.offline.cause), details: status.offline.error };
  }
  const until = poller.writesHeldUntil();
  return until === undefined ? undefined : rateLimited(until);
}

/** Why a read of the queue, or of those waiting to join it, failed: `text`, GitHub's own. */
function unread(text: string, checking = false): ActWhy {
  return { why: '', details: text, ...(checking && { checking }) };
}

/** Why a change no longer stands, with nothing said: the reader can't see the question any more. */
const UNSEEN: ActWhy = { why: '', next: 'gone' };

/** Pull request `number`'s entry in `view`'s queue, if the read lists it. */
function entryIn(view: QueueView, number: number): QueueEntryFacts | undefined {
  return view.queue?.entries.find((entry) => entry.pullRequest?.number === number);
}

/** Why pull request `number` can't be changed in `view`'s queue: it isn't listed. */
function unlisted(view: QueueView, number: number): ActWhy {
  return queueViewCutShort(view) ? { why: LEFT_OUT } : left(number);
}

/** Why a question about pull request `number` no longer stands: it left the queue. */
function left(number: number): ActWhy {
  return { why: `#${number} left the merge queue.`, next: 'gone' };
}

/** Why a merge write to `busy` holds back a change to the queue. */
function merging(busy: number): ActWhy {
  return { why: `#${busy} is still merging.` };
}

/**
 * Which of `layers`, a GitHub stack's open layers above an entry, bottom up, leave the queue with
 * it: those `view` lists, or every one when it may not list them all, as GitHub decides.
 */
export function aboveIn(view: QueueView, layers: readonly number[]): number[] {
  const cutShort = queueViewCutShort(view);
  return layers.filter((layer) => cutShort || entryIn(view, layer) !== undefined);
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((each, index) => each === b[index]);
}

function refused(why: ActWhy): Extract<Acted, { kind: 'refused' }> {
  return { kind: 'refused', ...why };
}

/** Why only an admin moves an entry to the front, for `login`. */
function notAdmin(login: string): ActWhy {
  return { why: `${login} doesn’t have permission.`, next: 'none' };
}

/** Why the entry of pull request `number`, at the front, isn't moved there. */
function atFront(number: number): ActWhy {
  return { why: `#${number} is already at the front.`, next: 'none' };
}

export class QueueActs {
  readonly #options: QueueActsOptions;
  readonly #now: () => number;
  readonly #newKey: () => string;
  /** The plans kept for the reader to confirm, by key: a tab's last one only. */
  readonly #kept = new Map<string, Kept>();
  /** The keys of plans confirmed, which never run again. */
  readonly #used = new Set<string>();
  /** The checks under way at a press, by their plan's key: cancelling one stops it before it's sent. */
  readonly #checking = new Map<string, AbortController>();
  /** When the last change from each tab ended, by its id: what it acts on next is read after then. */
  readonly #ended = new Map<string, number>();
  readonly #unsettled = new Set<Unsettled>();
  #stopped = false;

  constructor(options: QueueActsOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#newKey = options.newKey ?? (() => crypto.randomUUID());
  }

  /**
   * Plans `kind` for pull request `number` in merge queue tab `id`'s queue, and keeps it for the
   * reader to confirm, in place of the tab's last plan; or says why there's none.
   */
  async plan(id: string, number: number, kind: ActKind): Promise<ActPlanned> {
    const asked = await this.#ask(id, number, kind);
    if (!('plan' in asked)) return { kind: 'refused', ...asked };
    this.#keep(asked);
    return { kind: 'plan', plan: asked.plan };
  }

  /**
   * Sends the change the plan named `key` holds, once, if it can still go as the plan says, and
   * answers how it went; else asks again with a new plan, when what it named changed, or refuses.
   */
  async confirm(key: string): Promise<Acted> {
    const kept = this.#kept.get(key);
    // Confirmed already, its button is busy until it's answered: one confirmed again was asked by
    // nothing on screen.
    if (!kept) return refused(this.#used.has(key) ? UNSEEN : { why: QUEUE_CHANGED });
    // A plan runs once, whatever comes of it.
    this.#kept.delete(key);
    this.#used.add(key);
    if (this.#stopped) return refused(UNSEEN);
    const checking = new AbortController();
    this.#checking.set(key, checking);
    try {
      const checked = await this.#guard(kept);
      // Cancelled while it checked: nothing goes, and no plan is kept in its place.
      if (checking.signal.aborted || this.#stopped) {
        if (checked.kind === 'again') this.#kept.delete(checked.plan.key);
        return refused(UNSEEN);
      }
      if (checked.kind !== 'send') return checked;
      // What the checks found at their start, once more, right before it goes: nothing waits from
      // here to the send.
      const still = this.#holds(kept.plan, checked.poller);
      if (still !== undefined) return refused(still);
      const { plan } = kept;
      const repo = new RepoRef(plan.owner, plan.repo);
      const turn = this.#options.writes.take(repo, [plan.number, ...plan.above]);
      if ('busy' in turn) return refused(merging(turn.busy));
      this.#options.sent?.(key);
      return await this.#send(kept, checked.poller, turn);
    } finally {
      this.#checking.delete(key);
    }
  }

  /**
   * Forgets the plan named `key`. While its confirmation is being checked, stops it: nothing is
   * sent. Once it was sent, it goes on.
   */
  cancel(key: string): void {
    this.#kept.delete(key);
    this.#checking.get(key)?.abort();
  }

  /**
   * Turns off auto-merge for pull request `number`, waiting to join merge queue tab `id`'s queue,
   * at once, in its turn among merge writes: nothing merges, so the reader isn't asked first. It
   * goes once those waiting to join were read in the last 40 s, read again first when not, and
   * list it with auto-merge on, out of the queue.
   */
  async autoMergeOff(id: string, number: number): Promise<Acted> {
    if (this.#stopped) return refused(UNSEEN);
    const found = this.#options.tab(id);
    if (!found) return refused(UNSEEN);
    const { tab, watch } = found;
    const branch = watch.branch;
    if (watch.away !== undefined) return refused(signedOut(tab.login));
    let poller: ActPoller;
    try {
      poller = await this.#options.poller(tab.login);
    } catch (error) {
      return refused(causeOf(error, tab.login, tab.owner));
    }
    const off = offWhy(poller, tab.login);
    if (off !== undefined) return refused(off);
    const waiting = await watch.freshWaiting(ACT_WITHIN, this.#ended.get(id));
    if (typeof waiting === 'string') return refused(unread(waiting));
    const pull = waiting.pullRequests.find((each) => each.number === number);
    if (!pull) {
      return refused(
        waiting.total > waiting.pullRequests.length || waiting.leftOut.length > 0
          ? { why: LEFT_OUT }
          : { why: `#${number} is no longer open into ${branch}.`, next: 'gone' },
      );
    }
    if (pull.inQueue) {
      return refused({ why: `#${number} is already in the merge queue.`, next: 'none' });
    }
    if (pull.autoMerge === undefined) {
      return refused({ why: 'Auto-merge is already off.', next: 'none' });
    }
    // Once more right before it goes: nothing waits from here to the send.
    const now = this.#options.tab(id);
    if (now?.watch.branch !== branch) return refused({ why: QUEUE_CHANGED });
    if (now.watch.away !== undefined) return refused(signedOut(tab.login));
    const stillOff = offWhy(poller, tab.login);
    if (stillOff !== undefined) return refused(stillOff);
    const repo = new RepoRef(tab.owner, tab.repo);
    const turn = this.#options.writes.take(repo, [number]);
    if ('busy' in turn) return refused(merging(turn.busy));
    let answer: AutoMergeState | MergeRefusal;
    try {
      answer = await poller.disableAutoMerge(PullRef.of(repo, number), pull.id);
    } catch (error) {
      const endedAt = this.#endedNow(id);
      if (error instanceof GithubError && !error.mayHavePosted()) {
        turn.give();
        return refused(causeOf(error, tab.login, tab.owner));
      }
      this.#settle({ id, on: tab, branch, kind: 'waiting', endedAt }, turn);
      return { kind: 'unknown', why: NO_ANSWER, details: this.#lost(error) };
    }
    const endedAt = this.#endedNow(id);
    if (isRefusal(answer)) {
      turn.give();
      this.#refresh(id, endedAt);
      return refused(refusalOf(answer, tab.login));
    }
    if (answer.inQueue) {
      turn.give();
      this.#refresh(id, endedAt);
      return {
        kind: 'partly',
        why: `#${number} had already joined the merge queue.`,
        next: 'remove',
      };
    }
    if (answer.autoMerge === undefined) {
      turn.give();
      this.#refresh(id, endedAt);
      return { kind: 'autoMergeOff' };
    }
    this.#settle({ id, on: tab, branch, kind: 'waiting', endedAt }, turn);
    // GitHub answered, but not with auto-merge off: a read of those waiting shows whether it is.
    return { kind: 'unknown', why: '' };
  }

  /**
   * A read of merge queue tab `id`'s queue answered: a question it no longer lists, at the head it
   * named, is dropped, as is one of a branch the tab no longer shows.
   */
  heard(id: string, view: QueueView): void {
    for (const [key, kept] of this.#kept) {
      if (kept.plan.id !== id) continue;
      if (this.#dropped(kept.plan, view) !== undefined) this.#kept.delete(key);
    }
  }

  /**
   * Merge queue tab `id` closed, shows another branch, or its account went: its question is
   * dropped, and a change from it whose answer was lost is read again at once, apart from the tab.
   */
  drop(id: string): void {
    for (const [key, kept] of this.#kept) {
      if (kept.plan.id === id) this.#kept.delete(key);
    }
    for (const unsettled of this.#unsettled) {
      if (unsettled.id !== id) continue;
      if (unsettled.wake) unsettled.wake();
      else unsettled.nudged = true;
    }
  }

  /** Plans no more and sends nothing more; the turns held for changes not yet settled go back. */
  stop(): void {
    this.#stopped = true;
    this.#kept.clear();
    for (const checking of this.#checking.values()) checking.abort();
    for (const unsettled of this.#unsettled) {
      unsettled.turn.give();
      unsettled.wake?.();
    }
    this.#unsettled.clear();
  }

  /** Why `plan`'s question no longer stands after `view`, a read of its queue, or nothing. */
  #dropped(plan: ActPlan, view: QueueView): ActWhy | undefined {
    // The dialog closes as its tab shows another branch.
    if (view.branch !== plan.branch) return UNSEEN;
    const entry = entryIn(view, plan.number);
    if (!entry) return queueViewCutShort(view) ? undefined : left(plan.number);
    if (entry.pullRequest?.head !== plan.head) {
      return { why: `#${plan.number}’s revision is out of date.`, next: 'ask' };
    }
    return undefined;
  }

  /** What `kind` for `number` in tab `id`'s queue would do, read afresh, or why it can't. */
  async #ask(id: string, number: number, kind: ActKind): Promise<Kept | ActWhy> {
    if (this.#stopped) return UNSEEN;
    const found = this.#options.tab(id);
    if (!found) return UNSEEN;
    const { tab, watch } = found;
    const branch = watch.branch;
    if (watch.away !== undefined) return signedOut(tab.login);
    let poller: ActPoller;
    try {
      poller = await this.#options.poller(tab.login);
    } catch (error) {
      return causeOf(error, tab.login, tab.owner);
    }
    const off = offWhy(poller, tab.login);
    if (off !== undefined) return off;
    const view = await watch.fresh(ACT_WITHIN, this.#ended.get(id));
    if (typeof view === 'string') return unread(view, true);
    const entry = entryIn(view, number);
    const pull = entry?.pullRequest;
    if (!entry || !pull) return unlisted(view, number);
    if (kind === 'jump' && view.viewerPermission !== 'ADMIN') return notAdmin(tab.login);
    if (kind === 'jump' && entry.position <= 1) return atFront(number);
    // Its head as GitHub listed it, cut short: it's checked as it's read again.
    if (!isFullSha(pull.head)) return { why: '', checking: true };
    const repo = new RepoRef(tab.owner, tab.repo);
    // Its GitHub stack as GitHub has it now, which decides what leaves with it.
    let holding: GithubStack[] | undefined;
    try {
      holding = await poller.readOnce((client) => stacksHolding(client, repo, number));
    } catch (error) {
      return { ...causeOf(error, tab.login, tab.owner), checking: true };
    }
    const stack = holding?.find((each) =>
      openLayers(each).some((layer) => layer.number === number),
    );
    const layers = stack ? openLayers(stack).map((layer) => layer.number) : [number];
    const others = layers.filter((layer) => layer !== number);
    let above: number[] = [];
    if (kind === 'remove') {
      const [bottom] = layers;
      if (bottom !== undefined && bottom !== number) {
        // GitHub takes a stack out from its bottom layer.
        return { why: `Remove the bottom layer, #${bottom}, instead`, next: 'none' };
      }
      above = aboveIn(view, layers.slice(1));
    } else if (stack && others.length > 0) {
      return { why: 'GitHub queues a stack’s layers in order', next: 'none' };
    }
    const [busy] = this.#options.writes.busy(repo, [number, ...above]);
    if (busy !== undefined) return merging(busy);
    // The tab may have moved on while Lo read.
    const now = this.#options.tab(id);
    if (now?.watch.branch !== branch) return { why: QUEUE_CHANGED };
    return {
      plan: {
        key: this.#newKey(),
        id,
        owner: tab.owner,
        repo: tab.repo,
        branch,
        login: tab.login,
        kind,
        number,
        title: pull.title,
        position: entry.position,
        head: pull.head,
        stack: stack && others.length > 0 ? stack.number : null,
        above,
      },
      pullRequestId: pull.id,
      layers,
    };
  }

  /** Keeps `kept`, in place of its tab's last plan. */
  #keep(kept: Kept): void {
    this.drop(kept.plan.id);
    this.#kept.set(kept.plan.key, kept);
  }

  /** Why `plan` can't go from its tab now, as the tab and its account's `poller` say. */
  #holds(plan: ActPlan, poller: ActPoller | undefined): ActWhy | undefined {
    const found = this.#options.tab(plan.id);
    // The dialog closes with its tab, and as the tab shows another branch.
    if (!found || found.watch.branch !== plan.branch) return UNSEEN;
    if (found.watch.away !== undefined) return signedOut(plan.login);
    return poller && offWhy(poller, plan.login);
  }

  /**
   * Checks `kept` as it's confirmed: sends it with `poller` when everything holds; asks again with
   * a new plan when what it named changed; else refuses.
   */
  async #guard(
    kept: Kept,
  ): Promise<
    | Extract<Acted, { kind: 'again' } | { kind: 'refused' }>
    | { readonly kind: 'send'; readonly poller: ActPoller }
  > {
    const { plan } = kept;
    const tab = this.#holds(plan, undefined);
    if (tab !== undefined) return refused(tab);
    let poller: ActPoller;
    try {
      poller = await this.#options.poller(plan.login);
    } catch (error) {
      return refused(causeOf(error, plan.login, plan.owner));
    }
    const held = this.#holds(plan, poller);
    if (held !== undefined) return refused(held);
    const found = this.#options.tab(plan.id);
    if (!found) return refused(UNSEEN);
    const view = await found.watch.fresh(ACT_WITHIN, this.#ended.get(plan.id));
    if (typeof view === 'string') return refused(unread(view));
    const dropped = this.#dropped(plan, view);
    if (dropped !== undefined) return refused(dropped);
    const entry = entryIn(view, plan.number);
    if (!entry) return refused(unlisted(view, plan.number));
    if (plan.kind === 'jump' && view.viewerPermission !== 'ADMIN') {
      return refused(notAdmin(plan.login));
    }
    if (plan.kind === 'jump' && entry.position <= 1) return refused(atFront(plan.number));
    if (plan.kind === 'remove') {
      const above = aboveIn(view, kept.layers.slice(1));
      if (!same(above, plan.above)) {
        const again: Kept = {
          ...kept,
          plan: { ...plan, key: this.#newKey(), above, position: entry.position },
        };
        this.#keep(again);
        return { kind: 'again', plan: again.plan, why: 'The layers removed with it have changed.' };
      }
    }
    const prs = [plan.number, ...plan.above];
    const repo = new RepoRef(plan.owner, plan.repo);
    const converting = this.#options.converting(repo);
    if (converting && prs.some((pr) => converting.prs.includes(pr))) {
      return refused({ why: 'GitHub is still changing this stack.' });
    }
    const [busy] = this.#options.writes.busy(repo, prs);
    if (busy !== undefined) return refused(merging(busy));
    return { kind: 'send', poller };
  }

  /** Sends `kept`'s change, in its pull requests' `turn`, and answers how it went. */
  async #send(kept: Kept, poller: ActPoller, turn: MergeTurn): Promise<Acted> {
    const { plan, pullRequestId } = kept;
    const pull = PullRef.of(new RepoRef(plan.owner, plan.repo), plan.number);
    let answer: { kind: 'dequeued'; answer: Dequeued | MergeRefusal } | Jumped | MergeRefusal;
    try {
      answer =
        plan.kind === 'remove'
          ? {
              kind: 'dequeued',
              answer: await poller.dequeue(pull, pullRequestId, plan.branch, plan.above),
            }
          : await poller.jump(pull, pullRequestId, plan.head);
    } catch (error) {
      const endedAt = this.#endedNow(plan.id);
      if (error instanceof GithubError && !error.mayHavePosted()) {
        turn.give();
        return refused(causeOf(error, plan.login, plan.owner));
      }
      this.#settle(this.#changeOf(plan, endedAt), turn);
      return { kind: 'unknown', why: NO_ANSWER, details: this.#lost(error) };
    }
    const endedAt = this.#endedNow(plan.id);
    const done = (acted: Acted): Acted => {
      turn.give();
      this.#refresh(plan.id, endedAt);
      return acted;
    };
    if (isRefusal(answer)) return done(refused(refusalOf(answer, plan.login)));
    switch (answer.kind) {
      case 'dequeued':
        return done(
          isRefusal(answer.answer)
            ? refused(refusalOf(answer.answer, plan.login))
            : { kind: 'removed', numbers: [plan.number, ...plan.above] },
        );
      case 'moved':
        return done({ kind: 'moved', position: answer.entry.position });
      case 'notBack': {
        // GitHub took it out of the queue to move it, then didn't add it back.
        const { failure } = answer;
        const out = {
          kind: 'partly',
          why: 'It left the merge queue and wasn’t added back.',
          next: 'open',
        } as const;
        if (isRefusal(failure)) {
          return done({ ...out, details: refusalOf(failure, plan.login).details });
        }
        const error = new GithubError(failure);
        if (!error.mayHavePosted()) return done({ ...out, details: error.message });
        this.#settle(this.#changeOf(plan, endedAt), turn);
        return { kind: 'unknown', why: NO_ANSWER, details: error.message };
      }
      default:
        answer satisfies never;
        throw new Error(`an answer Lo doesn’t know: ${JSON.stringify(answer)}`);
    }
  }

  /** Notes that a change from tab `id` ended now, and returns when. */
  #endedNow(id: string): number {
    const at = this.#now();
    this.#ended.set(id, at);
    return at;
  }

  /** What a change whose answer may be lost heard instead, as it came. */
  #lost(error: unknown): string {
    if (!(error instanceof GithubError))
      this.#options.log(`changing a merge queue: ${describe(error)}`);
    return textOf(error);
  }

  /** Reads tab `id`'s queue and those waiting to join again, after a change that ended at `endedAt`. */
  #refresh(id: string, endedAt: number): void {
    const found = this.#options.tab(id);
    if (!found) return;
    void found.watch.fresh(0, endedAt);
    void found.watch.freshWaiting(0, endedAt);
  }

  /** What a change to the queue `plan` names, which ended at `endedAt`, is settled by reading. */
  #changeOf(plan: ActPlan, endedAt: number): Omit<Unsettled, 'turn' | 'wake' | 'nudged'> {
    return { id: plan.id, on: plan, branch: plan.branch, kind: 'queue', endedAt };
  }

  /**
   * Holds `turn` for `change`, whose answer was lost, until a read of what it changed, of the branch
   * it changed, made after it ended, answers; read now, and again while they fail, waiting longer
   * each time, but not once its tab closes or moves on. The turn goes back once a read answers, its
   * account is gone, or Lo stops.
   */
  #settle(change: Omit<Unsettled, 'turn' | 'wake' | 'nudged'>, turn: MergeTurn): void {
    const unsettled: Unsettled = { ...change, turn, wake: undefined, nudged: false };
    this.#unsettled.add(unsettled);
    void (async () => {
      let wait = SETTLE_AGAIN;
      while (!this.#stopped && this.#unsettled.has(unsettled)) {
        if (await this.#settled(unsettled)) break;
        await this.#rest(unsettled, wait);
        wait = Math.min(wait * 2, SETTLE_MOST);
      }
      this.#unsettled.delete(unsettled);
      turn.give();
    })().catch((error: unknown) => {
      this.#options.log(`settling a change to a merge queue: ${describe(error)}`);
      this.#unsettled.delete(unsettled);
      turn.give();
    });
  }

  /**
   * Reads what `unsettled` changed, of the branch it changed, and says whether that settles it: the
   * tab's own read while the tab shows that branch, else one apart from the tab; or none, once the
   * account it was made as is gone.
   */
  async #settled(unsettled: Unsettled): Promise<boolean> {
    const { id, on, branch, kind, endedAt } = unsettled;
    const found = this.#options.tab(id);
    if (found && found.watch.branch === branch && found.watch.away === undefined) {
      // A read the tab finishes on another branch answers as a failure.
      const read =
        kind === 'queue'
          ? await found.watch.fresh(0, endedAt)
          : await found.watch.freshWaiting(0, endedAt);
      if (typeof read === 'string') return false;
      // Those waiting say whether auto-merge is off; the queue, whether it joined.
      if (kind === 'waiting') void found.watch.fresh(0, endedAt);
      return true;
    }
    try {
      await this.#options.poller(on.login);
    } catch {
      // The account is gone: nothing it sends can follow, and nothing it reads can settle it.
      return true;
    }
    try {
      await this.#options.readBranch(on, branch, kind);
      return true;
    } catch (error) {
      this.#options.log(`settling a change to ${branch}’s merge queue: ${describe(error)}`);
      return false;
    }
  }

  /** Waits `ms` before `unsettled` is read again, or less, once its tab closes or moves on. */
  #rest(unsettled: Unsettled, ms: number): Promise<void> {
    if (unsettled.nudged) {
      unsettled.nudged = false;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        unsettled.wake = undefined;
        resolve();
      };
      const timer = setTimeout(done, ms);
      unsettled.wake = done;
    });
  }
}
