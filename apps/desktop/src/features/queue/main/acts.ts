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
// until a read of the queue made after it answers, which shows what GitHub did; it's never sent
// again by itself. Before it's sent, a GitHub stack's layer above its bottom one isn't taken out,
// since GitHub takes a stack out from its bottom layer, and a layer of a stack with other open
// layers isn't moved, since GitHub queues a stack's layers in order.
//
// `a` on a pull request waiting to join turns its auto-merge off at once, asking nothing, since
// that merges nothing, in its turn too. Nothing here calls Electron.

import {
  describeMergeRefusal,
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

import type { MergeTurn, MergeWrites } from '../../merge/service.ts';
import type { Converting } from '../../stacks/service.ts';
import type { QueueTab } from '../../tab/contract.ts';
import type { Acted, ActKind, ActPlan, ActPlanned } from '../contract.ts';
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
  readonly log: (line: string) => void;
  /** The time, in milliseconds since the Unix epoch. */
  readonly now?: () => number;
  /** A new plan's key. */
  readonly newKey?: () => string;
}

/** A plan kept for the reader to confirm. */
interface Kept {
  readonly plan: ActPlan;
  /** The pull request's node ID, which the change names. */
  readonly pullRequestId: string;
  /** The open layers of its GitHub stack, bottom up, as GitHub listed them for the plan. */
  readonly layers: readonly number[];
}

/** A change whose answer was lost, holding its pull requests' turns until a read shows what it did. */
interface Unsettled {
  readonly id: string;
  readonly turn: MergeTurn;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `text` as a sentence, ending with a full stop if it ends without one. */
function sentence(text: string): string {
  const trimmed = text.trim();
  return /[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

/** Pull requests' numbers as a sentence names them: "#45", "#45 and #46", "#45, #46 and #47". */
export function numbers(prs: readonly number[]): string {
  const named = prs.map((pr) => `#${pr}`);
  const last = named.pop() ?? '';
  return named.length === 0 ? last : `${named.join(', ')} and ${last}`;
}

/** A number of minutes or hours, as a clock writes it: "05". */
function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** A clock time as the interface writes it: "14:05". */
function clock(at: number): string {
  const time = new Date(at);
  return `${twoDigits(time.getHours())}:${twoDigits(time.getMinutes())}`;
}

/** Why Lo changes nothing in a queue now with `poller`, whatever the queue holds, if it doesn't. */
export function offText(poller: Pick<ActPoller, 'status' | 'writesHeldUntil'>): string | undefined {
  const status = poller.status();
  if (status.signedOut)
    return 'The account is signed out of GitHub. Sign in again, then try again.';
  if (status.offline) return 'Offline. Change the queue once you’re back.';
  const until = poller.writesHeldUntil();
  return until === undefined
    ? undefined
    : `GitHub asked Lo to hold off until ${clock(until)}. Change the queue then.`;
}

/** GitHub's refusal, or Lo's before asking it, as a sentence. */
function refusalText(refusal: MergeRefusal): string {
  if (refusal.refusal === 'paused') {
    return `GitHub asked Lo to hold off until ${clock(refusal.until)}. Change the queue then.`;
  }
  return sentence(describeMergeRefusal(refusal));
}

/** Pull request `number`'s entry in `view`'s queue, if the read lists it. */
function entryIn(view: QueueView, number: number): QueueEntryFacts | undefined {
  return view.queue?.entries.find((entry) => entry.pullRequest?.number === number);
}

/** Why pull request `number` can't be changed in `view`'s queue: it isn't listed. */
function unlisted(view: QueueView, number: number): string {
  return queueViewCutShort(view)
    ? `Lo can’t see #${number} in the merge queue for ${view.branch}: GitHub didn’t list all of it.`
    : `#${number} isn’t in the merge queue for ${view.branch} any more.`;
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

function refused(why: string): Extract<Acted, { kind: 'refused' }> {
  return { kind: 'refused', why };
}

/** Why only an admin moves an entry to the front, for `login`. */
function notAdmin(login: string): string {
  return `GitHub lets only the repository’s admins move a pull request to the front of the merge queue, and ${login} isn’t one.`;
}

/** Waits `ms`. */
function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (typeof asked === 'string') return { kind: 'refused', why: asked };
    this.#keep(asked);
    return { kind: 'plan', plan: asked.plan };
  }

  /**
   * Sends the change the plan named `key` holds, once, if it can still go as the plan says, and
   * answers how it went; else asks again with a new plan, when what it named changed, or refuses.
   */
  async confirm(key: string): Promise<Acted> {
    const kept = this.#kept.get(key);
    if (!kept) {
      return refused(
        this.#used.has(key)
          ? 'That change was confirmed already.'
          : 'Lo no longer has that question. Ask again from the queue.',
      );
    }
    // A plan runs once, whatever comes of it.
    this.#kept.delete(key);
    this.#used.add(key);
    if (this.#stopped) return refused('Lo is quitting.');
    const checking = new AbortController();
    this.#checking.set(key, checking);
    try {
      const checked = await this.#guard(kept);
      // Cancelled while it checked: nothing goes, and no plan is kept in its place.
      if (checking.signal.aborted || this.#stopped) {
        if (checked.kind === 'again') this.#kept.delete(checked.plan.key);
        return refused(this.#stopped ? 'Lo is quitting.' : 'Cancelled. Nothing was sent.');
      }
      if (checked.kind !== 'send') return checked;
      // What the checks found at their start, once more, right before it goes: nothing waits from
      // here to the send.
      const still = this.#holds(kept.plan, checked.poller);
      if (still !== undefined) return refused(still);
      const { plan } = kept;
      const repo = new RepoRef(plan.owner, plan.repo);
      const turn = this.#options.writes.take(repo, [plan.number, ...plan.above]);
      if ('busy' in turn) return refused(`Lo is already merging #${turn.busy}.`);
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
    if (this.#stopped) return refused('Lo is quitting.');
    const found = this.#options.tab(id);
    if (!found) return refused('The merge queue’s tab is closed.');
    const { tab, watch } = found;
    const branch = watch.branch;
    if (watch.away !== undefined) return refused(watch.away);
    let poller: ActPoller;
    try {
      poller = await this.#options.poller(tab.login);
    } catch (error) {
      return refused(describe(error));
    }
    const off = offText(poller);
    if (off !== undefined) return refused(off);
    const waiting = await watch.freshWaiting(ACT_WITHIN, this.#ended.get(id));
    if (typeof waiting === 'string') {
      return refused(
        `Lo couldn’t read the pull requests waiting to join the merge queue for ${branch} again, so it didn’t turn off auto-merge: ${sentence(waiting)}`,
      );
    }
    const pull = waiting.pullRequests.find((each) => each.number === number);
    if (!pull) {
      return refused(
        waiting.total > waiting.pullRequests.length || waiting.leftOut.length > 0
          ? `Lo can’t see #${number} among the pull requests into ${branch}: GitHub didn’t list all of them.`
          : `#${number} isn’t open into ${branch} any more.`,
      );
    }
    if (pull.inQueue) return refused(`#${number} is in the merge queue already.`);
    if (pull.autoMerge === undefined) return refused(`Auto-merge is off for #${number} already.`);
    // Once more right before it goes: nothing waits from here to the send.
    const now = this.#options.tab(id);
    if (now?.watch.branch !== branch) {
      return refused('The merge queue’s tab changed. Turn off auto-merge from it again.');
    }
    if (now.watch.away !== undefined) return refused(now.watch.away);
    const stillOff = offText(poller);
    if (stillOff !== undefined) return refused(stillOff);
    const repo = new RepoRef(tab.owner, tab.repo);
    const turn = this.#options.writes.take(repo, [number]);
    if ('busy' in turn) return refused(`Lo is already merging #${turn.busy}.`);
    let answer: AutoMergeState | MergeRefusal;
    try {
      answer = await poller.disableAutoMerge(PullRef.of(repo, number), pull.id);
    } catch (error) {
      const endedAt = this.#endedNow(id);
      if (error instanceof GithubError && !error.mayHavePosted()) {
        turn.give();
        return refused(`${sentence(error.message)} Nothing was sent.`);
      }
      this.#settle(id, 'waiting', endedAt, turn);
      return {
        kind: 'unknown',
        why: `Lo can’t tell whether auto-merge is off for #${number}: ${this.#lost(error)} Lo reads the pull requests waiting to join again, which shows whether it is, and sends nothing again.`,
      };
    }
    const endedAt = this.#endedNow(id);
    if (isRefusal(answer)) {
      turn.give();
      this.#refresh(id, endedAt);
      return refused(refusalText(answer));
    }
    if (answer.inQueue) {
      turn.give();
      this.#refresh(id, endedAt);
      return {
        kind: 'partly',
        why: `#${number} joined the merge queue for ${branch} before auto-merge went off, so it merges once the queue’s checks pass. Take it out of the queue to stop it.`,
      };
    }
    if (answer.autoMerge === undefined) {
      turn.give();
      this.#refresh(id, endedAt);
      return { kind: 'autoMergeOff' };
    }
    this.#settle(id, 'waiting', endedAt, turn);
    return {
      kind: 'unknown',
      why: `GitHub answered, but not with auto-merge off for #${number}. Lo reads the pull requests waiting to join again, which shows whether it is.`,
    };
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

  /** Merge queue tab `id` closed, or its account went: its question is dropped. */
  drop(id: string): void {
    for (const [key, kept] of this.#kept) {
      if (kept.plan.id === id) this.#kept.delete(key);
    }
  }

  /** Plans no more and sends nothing more; the turns held for changes not yet settled go back. */
  stop(): void {
    this.#stopped = true;
    this.#kept.clear();
    for (const checking of this.#checking.values()) checking.abort();
    for (const unsettled of this.#unsettled) unsettled.turn.give();
    this.#unsettled.clear();
  }

  /** Why `plan`'s question no longer stands after `view`, a read of its queue, or nothing. */
  #dropped(plan: ActPlan, view: QueueView): string | undefined {
    if (view.branch !== plan.branch) return `The tab shows ${view.branch}’s queue now.`;
    const entry = entryIn(view, plan.number);
    if (!entry) {
      return queueViewCutShort(view)
        ? undefined
        : `#${plan.number} left the merge queue for ${plan.branch} since Lo asked.`;
    }
    if (entry.pullRequest?.head !== plan.head) {
      return `#${plan.number} has a newer push since Lo asked, so Lo didn’t change the queue.`;
    }
    return undefined;
  }

  /** What `kind` for `number` in tab `id`'s queue would do, read afresh, or why it can't. */
  async #ask(id: string, number: number, kind: ActKind): Promise<Kept | string> {
    if (this.#stopped) return 'Lo is quitting.';
    const found = this.#options.tab(id);
    if (!found) return 'The merge queue’s tab is closed.';
    const { tab, watch } = found;
    const branch = watch.branch;
    if (watch.away !== undefined) return watch.away;
    let poller: ActPoller;
    try {
      poller = await this.#options.poller(tab.login);
    } catch (error) {
      return describe(error);
    }
    const off = offText(poller);
    if (off !== undefined) return off;
    const view = await watch.fresh(ACT_WITHIN, this.#ended.get(id));
    if (typeof view === 'string') {
      return `Lo couldn’t read the merge queue for ${branch} again: ${sentence(view)}`;
    }
    const entry = entryIn(view, number);
    const pull = entry?.pullRequest;
    if (!entry || !pull) return unlisted(view, number);
    if (kind === 'jump' && view.viewerPermission !== 'ADMIN') return notAdmin(tab.login);
    if (!isFullSha(pull.head)) return `Lo hasn’t read #${number}’s head.`;
    const repo = new RepoRef(tab.owner, tab.repo);
    // Its GitHub stack as GitHub has it now, which decides what leaves with it.
    let holding: GithubStack[] | undefined;
    try {
      holding = await poller.readOnce((client) => stacksHolding(client, repo, number));
    } catch (error) {
      return `Lo couldn’t read #${number}’s GitHub stack, so it didn’t ask: ${describe(error)}`;
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
        return `Take #${bottom} out instead: GitHub takes a stack out from its bottom layer.`;
      }
      above = aboveIn(view, layers.slice(1));
    } else if (stack && others.length > 0) {
      return `#${number} is in GitHub stack #${stack.number} with ${numbers(others)}, which GitHub queues in order, so Lo doesn’t move it to the front on its own.`;
    }
    const [busy] = this.#options.writes.busy(repo, [number, ...above]);
    if (busy !== undefined) return `Lo is already merging #${busy}.`;
    // The tab may have moved on while Lo read.
    const now = this.#options.tab(id);
    if (now?.watch.branch !== branch) return 'The merge queue’s tab changed. Ask again from it.';
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
  #holds(plan: ActPlan, poller: ActPoller | undefined): string | undefined {
    const found = this.#options.tab(plan.id);
    if (!found) return 'The merge queue’s tab is closed. Nothing was sent.';
    if (found.watch.branch !== plan.branch) {
      return `The tab shows ${found.watch.branch}’s queue now. Nothing was sent.`;
    }
    if (found.watch.away !== undefined) return found.watch.away;
    return poller && offText(poller);
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
      return refused(describe(error));
    }
    const held = this.#holds(plan, poller);
    if (held !== undefined) return refused(held);
    const found = this.#options.tab(plan.id);
    if (!found) return refused('The merge queue’s tab is closed. Nothing was sent.');
    const view = await found.watch.fresh(ACT_WITHIN, this.#ended.get(plan.id));
    if (typeof view === 'string') {
      return refused(
        `Lo couldn’t read the merge queue for ${plan.branch} again, so it didn’t send it: ${sentence(view)}`,
      );
    }
    const dropped = this.#dropped(plan, view);
    if (dropped !== undefined) return refused(dropped);
    const entry = entryIn(view, plan.number);
    if (!entry) return refused(unlisted(view, plan.number));
    if (plan.kind === 'jump' && view.viewerPermission !== 'ADMIN') {
      return refused(notAdmin(plan.login));
    }
    if (plan.kind === 'remove') {
      const above = aboveIn(view, kept.layers.slice(1));
      if (!same(above, plan.above)) {
        const again: Kept = {
          ...kept,
          plan: { ...plan, key: this.#newKey(), above, position: entry.position },
        };
        this.#keep(again);
        return {
          kind: 'again',
          plan: again.plan,
          why: `The layers of #${plan.number}’s GitHub stack in the queue changed. Check what leaves with it now, then confirm.`,
        };
      }
    }
    const prs = [plan.number, ...plan.above];
    const repo = new RepoRef(plan.owner, plan.repo);
    const converting = this.#options.converting(repo);
    if (converting && prs.some((pr) => converting.prs.includes(pr))) {
      return refused(
        `Lo is making ${numbers(converting.prs)} a GitHub stack. Change the queue once that’s done.`,
      );
    }
    const [busy] = this.#options.writes.busy(repo, prs);
    if (busy !== undefined) return refused(`Lo is already merging #${busy}.`);
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
        return refused(`${sentence(error.message)} Nothing was sent.`);
      }
      this.#settle(plan.id, 'queue', endedAt, turn);
      const lost = this.#lost(error);
      return {
        kind: 'unknown',
        why:
          plan.kind === 'remove'
            ? `Lo can’t tell whether #${plan.number} left the merge queue for ${plan.branch}: ${lost} It may be out. Lo reads the queue again, which shows it, and sends nothing again.`
            : `Lo can’t tell whether GitHub took #${plan.number} out of the merge queue for ${plan.branch} to move it: ${lost} It may be out, and Lo didn’t add it back. Lo reads the queue again, which shows it.`,
      };
    }
    const endedAt = this.#endedNow(plan.id);
    const done = (acted: Acted): Acted => {
      turn.give();
      this.#refresh(plan.id, endedAt);
      return acted;
    };
    if (isRefusal(answer)) return done(refused(refusalText(answer)));
    switch (answer.kind) {
      case 'dequeued':
        return done(
          isRefusal(answer.answer)
            ? refused(refusalText(answer.answer))
            : { kind: 'removed', numbers: [plan.number, ...plan.above] },
        );
      case 'moved':
        return done({ kind: 'moved', position: answer.entry.position });
      case 'notBack': {
        const { failure } = answer;
        const out = `GitHub took #${plan.number} out of the merge queue for ${plan.branch} to move it`;
        if (isRefusal(failure)) {
          return done({
            kind: 'partly',
            why: `${out}, then wouldn’t add it back: ${refusalText(failure)} It’s out of the queue. Add it again from its merge panel.`,
          });
        }
        const error = new GithubError(failure);
        if (!error.mayHavePosted()) {
          return done({
            kind: 'partly',
            why: `${out}, then Lo couldn’t add it back: ${sentence(error.message)} It’s out of the queue. Add it again from its merge panel.`,
          });
        }
        this.#settle(plan.id, 'queue', endedAt, turn);
        return {
          kind: 'unknown',
          why: `${out}, and Lo can’t tell whether it added it back: ${sentence(error.message)} It may be out. Lo reads the queue again, which shows it, and sends nothing again.`,
        };
      }
      default:
        answer satisfies never;
        throw new Error(`an answer Lo doesn't know: ${JSON.stringify(answer)}`);
    }
  }

  /** Notes that a change from tab `id` ended now, and returns when. */
  #endedNow(id: string): number {
    const at = this.#now();
    this.#ended.set(id, at);
    return at;
  }

  /** Why a change's answer may be lost, as a sentence. */
  #lost(error: unknown): string {
    if (error instanceof GithubError)
      return `GitHub’s answer didn’t reach Lo: ${sentence(error.message)}`;
    this.#options.log(`changing a merge queue: ${describe(error)}`);
    return `Lo couldn’t read GitHub’s answer: ${sentence(describe(error))}`;
  }

  /** Reads tab `id`'s queue and those waiting to join again, after a change that ended at `endedAt`. */
  #refresh(id: string, endedAt: number): void {
    const found = this.#options.tab(id);
    if (!found) return;
    void found.watch.fresh(0, endedAt);
    void found.watch.freshWaiting(0, endedAt);
  }

  /**
   * Holds `turn` for a change from tab `id` that ended at `endedAt` and whose answer was lost, until
   * a read of what it changed (`kind`), made after then, answers; read now, and again while they
   * fail, waiting longer each time. The turn goes back once the tab closes, or Lo stops.
   */
  #settle(id: string, kind: 'queue' | 'waiting', endedAt: number, turn: MergeTurn): void {
    const unsettled: Unsettled = { id, turn };
    this.#unsettled.add(unsettled);
    void (async () => {
      let wait = SETTLE_AGAIN;
      for (;;) {
        if (this.#stopped || !this.#unsettled.has(unsettled)) break;
        const found = this.#options.tab(id);
        if (!found) break;
        const read =
          kind === 'queue'
            ? await found.watch.fresh(0, endedAt)
            : await found.watch.freshWaiting(0, endedAt);
        if (typeof read !== 'string') {
          // Those waiting say whether auto-merge is off; the queue, whether it joined.
          if (kind === 'waiting') void found.watch.fresh(0, endedAt);
          break;
        }
        await pause(wait);
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
}
