// Each view's pull request in a merge queue, in main. While a view's merge status says its pull
// request is queued and the view is on screen, the queue of the branch it merges into is read every
// 20 s, backing off to every 2 minutes while reads fail, for its place, where it stands and when it
// should merge. A read that no longer lists it says so, never the place it had, and asks the
// poller to read the pull request again at once, once for each leaving, since the poller reads it
// only every few minutes while Lo isn't in front: that read says whether it merged. Once the status
// no longer says queued, for a pull request Lo saw queued while it ran, and it hasn't merged, why it
// left is read: a removal from before it joined the queue, or none yet, is read once more after a
// short wait, and then Lo can't tell why. A view off screen reads nothing and keeps what it had, as
// does one whose account is signed out, until it's back. A queue is a branch's and read only while
// shown, so none of it goes through the poller's cache. Nothing here calls Electron.

import { GithubError, PullRef, queueRemoval, queueView, type Poller } from '@lo/github';
import { leftSince } from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type {
  Ahead,
  InQueue,
  LeftQueue,
  MergeStatusView,
  Queued,
  QueuePlace,
} from '../contract.ts';
import { aheadOf, joinedAt, leftOf, placeOf, queuePages } from './places.ts';

/** How often the queue of a queued pull request on screen is read while reads succeed. */
export const PLACE_EVERY = 20_000;
/** The longest wait between reads of it, while they fail. */
export const PLACE_MOST = 120_000;
/** How long to wait before reading why it left once more, when GitHub's timeline hasn't caught up. */
export const REMOVAL_AGAIN = 15_000;
/**
 * How far Lo's clock may be from GitHub's: a pull request Lo first saw queued at a time on its own
 * clock joined the queue no later than that, on GitHub's, give or take this.
 */
const CLOCK_SLACK = 60_000;

/** What the queue's reads use of an account's poller. */
export type QueuePoller = Pick<Poller, 'readOnce' | 'changed' | 'status' | 'onChange'>;

export interface QueueReadsOptions {
  /** The poller of each account, as the accounts feature provides it. */
  readonly poller: (login: string) => Promise<QueuePoller>;
  /** What main has of a view now, or nothing once it's closed. */
  readonly view: (id: string) => Pick<PullTabInfo, 'repository' | 'number' | 'acting'> | undefined;
  /** The view on screen, if a pull request's is. */
  readonly onScreen: () => string | undefined;
  readonly publish: (queued: Queued) => void;
  readonly log: (line: string) => void;
  /** The time now, in milliseconds since the Unix epoch; `Date.now` unless a test says. */
  readonly now?: () => number;
}

/** Why a view's pull request left its merge queue, while it's read. */
interface Leaving {
  /** When it joined the queue, on GitHub's clock: a removal from before is an earlier entry's. */
  readonly since: number | undefined;
  /** How many reads of it answered without settling it. */
  tries: number;
  /** Whether it waits for its account to be back, or for its next try. */
  due: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
}

/** A view whose merge status was heard. */
interface Watched {
  readonly id: string;
  readonly pull: PullRef;
  readonly login: string;
  /** The branch it merges into, as its status last said. */
  base: string | undefined;
  /** Whether its status says it's queued now. */
  queued: boolean;
  /** When Lo first heard it queued since it last wasn't, on Lo's clock. */
  heardQueuedAt: number | undefined;
  /** When it joined the queue, on GitHub's clock, as the last read that listed it said. */
  joined: number | undefined;
  /** Whether the pull request was read again since the queue stopped listing it. */
  askedAgain: boolean;
  place: QueuePlace | null;
  left: LeftQueue | null;
  /** Why it left, while that's read. */
  leaving: Leaving | undefined;
  /** When its place was last read, or failed to be. */
  doneAt: number | undefined;
  /** How long to wait after the last read. */
  wait: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether its place is being read now. */
  reading: boolean;
  /** Its account's poller, once had, which says when the account is signed out and back. */
  poller: QueuePoller | undefined;
  /** Stops hearing the poller's changes. */
  unheard: (() => void) | undefined;
  /** Gives up what's read for it once it's let go. */
  readonly abort: AbortController;
  /** What was last sent, to send nothing that didn't change. */
  sent: string | undefined;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Nothing of a merge queue, for a view that isn't in one and never left one. */
const NOTHING: InQueue = { place: null, left: null };
const NOTHING_SAID = JSON.stringify(NOTHING);

export class QueueReads {
  readonly #options: QueueReadsOptions;
  readonly #views = new Map<string, Watched>();
  #stopped = false;

  constructor(options: QueueReadsOptions) {
    this.#options = options;
  }

  /**
   * Hears view `id`'s merge status, each time it changes: queued, its queue is read while it's on
   * screen; no longer queued, for one Lo saw queued, why it left is read; merged, nothing.
   */
  heard({ id, view }: MergeStatusView): void {
    if (this.#stopped) return;
    const watched = this.#watch(id);
    if (!watched) return;
    if (view.kind === 'none') {
      this.#reset(watched);
      return;
    }
    if (view.kind !== 'known') return;
    const { state } = view;
    watched.base = state.base;
    switch (state.verdict) {
      case 'queued':
        watched.queued = true;
        watched.heardQueuedAt ??= this.#now();
        // Back in the queue: why it left before is old news.
        this.#endLeaving(watched);
        watched.left = null;
        this.#send(watched);
        this.#schedule(watched);
        return;
      case 'merged':
        this.#reset(watched);
        return;
      case 'closed':
      case 'ready':
      case 'waiting':
      case 'blocked':
        this.#cancel(watched);
        if (watched.queued) this.#leave(watched);
        watched.place = null;
        this.#send(watched);
        return;
      default:
        state.verdict satisfies never;
    }
  }

  /** The view on screen is `active` now: only its queue is read. */
  shown(active: string | undefined): void {
    for (const watched of this.#views.values()) {
      if (watched.id === active) this.#schedule(watched);
      else this.#cancel(watched);
    }
  }

  /** View `id` changed, or closed: a closed view, or one that reads another pull request, is let go. */
  follow(id: string): void {
    if (!this.#views.has(id)) return;
    this.#watch(id);
  }

  /** View `id`'s pull request in a merge queue now. */
  current(id: string): InQueue {
    const watched = this.#views.get(id);
    return watched ? { place: watched.place, left: watched.left } : NOTHING;
  }

  /** Whether `url` is a page view `id`'s place or leaving links: a failed check's run. */
  links(id: string, url: string): boolean {
    const watched = this.#views.get(id);
    return watched !== undefined && queuePages(watched.place, watched.left).has(url);
  }

  /** Forgets why view `id`'s pull request left its merge queue. */
  forgetLeft(id: string): void {
    const watched = this.#views.get(id);
    if (!watched?.left) return;
    watched.left = null;
    this.#send(watched);
  }

  /**
   * What's ahead in the merge queue of the branch view `id`'s pull request merges into, read once,
   * now, as someone waits for it.
   */
  async ahead(id: string): Promise<Ahead> {
    const watched = this.#views.get(id);
    const base = watched?.base;
    if (!watched || base === undefined) {
      throw new IpcError('unavailable', 'Lo hasn’t read whether this pull request can merge.');
    }
    try {
      const poller = await this.#pollerOf(watched);
      const read = await poller.readOnce(
        (client) => queueView(client, watched.pull.repo, base),
        watched.abort.signal,
        'foreground',
      );
      return aheadOf(read, watched.pull.number);
    } catch (error) {
      const why = error instanceof GithubError ? error.message : describe(error);
      throw new IpcError('unavailable', `Lo couldn’t read the merge queue for ${base}: ${why}`);
    }
  }

  /** Reads nothing more, and sends nothing more. */
  stop(): void {
    this.#stopped = true;
    for (const watched of this.#views.values()) this.#let(watched);
    this.#views.clear();
  }

  /**
   * What's watched of view `id` as it is now: afresh for a new pull request or account, nothing
   * for a closed view or one acting as nobody, which are let go.
   */
  #watch(id: string): Watched | undefined {
    const info = this.#options.view(id);
    const known = this.#views.get(id);
    const login = info?.acting?.kind === 'account' ? info.acting.login : undefined;
    if (!info || login === undefined) {
      if (known) {
        this.#let(known);
        this.#views.delete(id);
        // A closed view's is forgotten with it; one acting as nobody shows none.
        if (info) this.#cleared(known);
      }
      return undefined;
    }
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    if (known && known.pull.key === pull.key && known.login.toLowerCase() === login.toLowerCase()) {
      return known;
    }
    if (known) {
      this.#let(known);
      this.#cleared(known);
    }
    const fresh: Watched = {
      id,
      pull,
      login,
      base: undefined,
      queued: false,
      heardQueuedAt: undefined,
      joined: undefined,
      askedAgain: false,
      place: null,
      left: null,
      leaving: undefined,
      doneAt: undefined,
      wait: PLACE_EVERY,
      timer: undefined,
      reading: false,
      poller: undefined,
      unheard: undefined,
      abort: new AbortController(),
      sent: known?.sent === undefined ? undefined : NOTHING_SAID,
    };
    this.#views.set(id, fresh);
    return fresh;
  }

  /** Says a view let go shows nothing of a merge queue, if it showed something. */
  #cleared(watched: Watched): void {
    if (watched.sent !== undefined && watched.sent !== NOTHING_SAID) {
      this.#publish(watched.id, NOTHING);
    }
  }

  /** A view that's no longer queued, or never left: nothing more is read, or shown. */
  #reset(watched: Watched): void {
    this.#cancel(watched);
    this.#endLeaving(watched);
    watched.queued = false;
    watched.heardQueuedAt = undefined;
    watched.joined = undefined;
    watched.askedAgain = false;
    watched.place = null;
    watched.left = null;
    this.#send(watched);
  }

  #let(watched: Watched): void {
    this.#cancel(watched);
    this.#endLeaving(watched);
    watched.unheard?.();
    watched.unheard = undefined;
    watched.abort.abort();
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  /** Whether `watched` is still what view `id` is watched as. */
  #current(watched: Watched): boolean {
    return !this.#stopped && this.#views.get(watched.id) === watched;
  }

  /** Whether `watched`'s account is signed out, as its poller last said. */
  #away(watched: Watched): boolean {
    return watched.poller?.status().signedOut === true;
  }

  /**
   * The poller of `watched`'s account, had once: as it says the account is back, what waited for
   * it is read.
   */
  async #pollerOf(watched: Watched): Promise<QueuePoller> {
    if (watched.poller) return watched.poller;
    const poller = await this.#options.poller(watched.login);
    if (this.#current(watched) && !watched.poller) {
      watched.poller = poller;
      watched.unheard = poller.onChange(() => this.#back(watched));
    }
    return poller;
  }

  /** `watched`'s poller changed: once its account is back, what waited for it is read. */
  #back(watched: Watched): void {
    if (!this.#current(watched) || this.#away(watched)) return;
    this.#schedule(watched);
    const leaving = watched.leaving;
    if (leaving?.due && leaving.timer === undefined) void this.#readRemoval(watched, leaving);
  }

  /** Reads the queue of a queued view on screen when it's due, unless it's read or due already. */
  #schedule(watched: Watched): void {
    if (!watched.queued || watched.base === undefined || this.#away(watched)) return;
    if (this.#options.onScreen() !== watched.id) return;
    if (watched.reading || watched.timer !== undefined) return;
    const due = watched.doneAt === undefined ? 0 : watched.doneAt + watched.wait - this.#now();
    watched.timer = setTimeout(
      () => {
        watched.timer = undefined;
        void this.#readPlace(watched);
      },
      Math.max(0, due),
    );
  }

  #cancel(watched: Watched): void {
    clearTimeout(watched.timer);
    watched.timer = undefined;
  }

  async #readPlace(watched: Watched): Promise<void> {
    const base = watched.base;
    if (!this.#current(watched) || !watched.queued || base === undefined) return;
    watched.reading = true;
    let read: { place: QueuePlace; joined: number | undefined } | undefined;
    let poller: QueuePoller | undefined;
    try {
      poller = await this.#pollerOf(watched);
      // Signed out: nothing is read until the account is back.
      if (!poller.status().signedOut) {
        const view = await poller.readOnce(
          (client) => queueView(client, watched.pull.repo, base),
          watched.abort.signal,
        );
        read = {
          place: placeOf(view, watched.pull.number, watched.login),
          joined: joinedAt(view, watched.pull.number),
        };
      }
    } catch (error) {
      if (this.#current(watched)) {
        this.#options.log(`${watched.pull.toString()}: the queue for ${base}: ${describe(error)}`);
      }
    }
    watched.reading = false;
    if (!this.#current(watched) || !watched.queued || watched.base !== base) return;
    if (poller?.status().signedOut) return;
    watched.doneAt = this.#now();
    if (read === undefined) {
      // What was read last stays, until a read answers.
      watched.wait = Math.min(watched.wait * 2, PLACE_MOST);
    } else {
      const { place, joined } = read;
      watched.wait = PLACE_EVERY;
      watched.place = place;
      if (place.kind === 'listed') {
        watched.joined = joined ?? watched.joined;
        watched.askedAgain = false;
      } else if (!place.partial && !watched.askedAgain && poller) {
        // It's no longer in the queue. The poller reads the pull request every 20 s only while Lo
        // is in front, so it's asked to at once, which says whether it merged.
        watched.askedAgain = true;
        poller.changed(watched.pull).catch((error: unknown) => {
          this.#options.log(`${watched.pull.toString()}: reading it again: ${describe(error)}`);
        });
      }
      this.#send(watched);
    }
    this.#schedule(watched);
  }

  /** `watched`'s status no longer says queued: why it left is read, unless Lo never saw it there. */
  #leave(watched: Watched): void {
    const heard = watched.heardQueuedAt;
    const since = watched.joined ?? (heard === undefined ? undefined : heard - CLOCK_SLACK);
    watched.queued = false;
    watched.heardQueuedAt = undefined;
    watched.joined = undefined;
    watched.askedAgain = false;
    this.#endLeaving(watched);
    const leaving: Leaving = { since, tries: 0, due: true, timer: undefined };
    watched.leaving = leaving;
    void this.#readRemoval(watched, leaving);
  }

  #endLeaving(watched: Watched): void {
    clearTimeout(watched.leaving?.timer);
    watched.leaving = undefined;
  }

  /**
   * Reads why `watched`'s pull request left its merge queue, and says so unless it merged: a
   * removal from before it joined, or none yet, is read once more after a short wait, and then Lo
   * can't tell why. While its account is signed out, the read waits for it to be back.
   */
  async #readRemoval(watched: Watched, leaving: Leaving): Promise<void> {
    const ongoing = () => this.#current(watched) && watched.leaving === leaving;
    if (!ongoing()) return;
    leaving.due = false;
    let left: LeftQueue | null;
    try {
      const poller = await this.#pollerOf(watched);
      if (poller.status().signedOut) {
        leaving.due = true;
        return;
      }
      const removal = await poller.readOnce(
        (client) => queueRemoval(client, watched.pull),
        watched.abort.signal,
      );
      if (!ongoing()) return;
      if (leftSince(removal, leaving.since)) {
        left = leftOf(removal, watched.login) ?? null;
      } else if (leaving.tries === 0) {
        leaving.tries += 1;
        leaving.due = true;
        leaving.timer = setTimeout(() => {
          leaving.timer = undefined;
          if (!this.#away(watched)) void this.#readRemoval(watched, leaving);
        }, REMOVAL_AGAIN);
        return;
      } else if (removal.inQueue) {
        // GitHub says it's in the queue again: its status will say so too.
        left = null;
      } else {
        left = {
          at: null,
          why: { kind: 'unknown', why: null },
          partial: removal.leftOut.length > 0,
        };
      }
    } catch (error) {
      if (!ongoing()) return;
      const why = error instanceof GithubError ? error.message : describe(error);
      this.#options.log(`${watched.pull.toString()}: ${why}`);
      left = { at: null, why: { kind: 'unknown', why: why.slice(0, 4096) }, partial: false };
    }
    watched.leaving = undefined;
    watched.left = left;
    this.#send(watched);
  }

  #send(watched: Watched): void {
    const queue: InQueue = { place: watched.place, left: watched.left };
    const said = JSON.stringify(queue);
    if (said === watched.sent) return;
    // Nothing to say for a view that never said anything.
    if (watched.sent === undefined && said === NOTHING_SAID) return;
    watched.sent = said;
    this.#publish(watched.id, queue);
  }

  #publish(id: string, queue: InQueue): void {
    try {
      this.#options.publish({ id, queue });
    } catch (error) {
      this.#options.log(`sending the merge queue's place: ${describe(error)}`);
    }
  }
}
