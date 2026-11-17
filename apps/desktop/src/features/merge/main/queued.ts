// Each view's pull request in a merge queue, in main. While a view's merge status says its pull
// request is queued and the view is on screen, the queue of the branch it merges into is read every
// 20 s, backing off to every 2 minutes while reads fail, for its place, where it stands and when it
// should merge. A read that no longer lists it shows the place the merge status last said, until
// the status, which the poller reads as often and which says whether it merged, moves on. Once the
// status no longer says queued, for a pull request Lo saw queued while it ran, and it hasn't merged,
// why it left is read once. A view off screen reads nothing and keeps what it
// had. A queue is a branch's and read only while shown, so none of it goes through the poller's
// cache. Nothing here calls Electron.

import { GithubError, PullRef, queueRemoval, queueView, type Poller } from '@lo/github';

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
import { aheadOf, leftOf, placeOf, queuePages } from './places.ts';

/** How often the queue of a queued pull request on screen is read while reads succeed. */
export const PLACE_EVERY = 20_000;
/** The longest wait between reads of it, while they fail. */
export const PLACE_MOST = 120_000;

/** What the queue's reads use of an account's poller. */
export type QueuePoller = Pick<Poller, 'readOnce'>;

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

/** A view whose merge status was heard. */
interface Watched {
  readonly id: string;
  readonly pull: PullRef;
  readonly login: string;
  /** The branch it merges into, as its status last said. */
  base: string | undefined;
  /** Whether its status says it's queued now. */
  queued: boolean;
  /** Whether Lo saw it queued, and hasn't asked why it left since. */
  seen: boolean;
  place: QueuePlace | null;
  left: LeftQueue | null;
  /** When its place was last read, or failed to be. */
  doneAt: number | undefined;
  /** How long to wait after the last read. */
  wait: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Whether its place is being read now. */
  reading: boolean;
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
   * screen; no longer queued, for one Lo saw queued, why it left is read once; merged, nothing.
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
        watched.seen = true;
        // Back in the queue: why it left before is old news.
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
        watched.queued = false;
        watched.place = null;
        this.#cancel(watched);
        if (watched.seen) {
          watched.seen = false;
          void this.#readRemoval(watched);
        }
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
      const poller = await this.#options.poller(watched.login);
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
      seen: false,
      place: null,
      left: null,
      doneAt: undefined,
      wait: PLACE_EVERY,
      timer: undefined,
      reading: false,
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
    watched.queued = false;
    watched.seen = false;
    watched.place = null;
    watched.left = null;
    this.#cancel(watched);
    this.#send(watched);
  }

  #let(watched: Watched): void {
    this.#cancel(watched);
    watched.abort.abort();
  }

  #now(): number {
    return this.#options.now?.() ?? Date.now();
  }

  /** Whether `watched` is still what view `id` is watched as. */
  #current(watched: Watched): boolean {
    return !this.#stopped && this.#views.get(watched.id) === watched;
  }

  /** Reads the queue of a queued view on screen when it's due, unless it's read or due already. */
  #schedule(watched: Watched): void {
    if (!watched.queued || watched.base === undefined) return;
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
    let place: QueuePlace | undefined;
    try {
      const poller = await this.#options.poller(watched.login);
      const read = await poller.readOnce(
        (client) => queueView(client, watched.pull.repo, base),
        watched.abort.signal,
      );
      place = placeOf(read, watched.pull.number, watched.login);
    } catch (error) {
      if (this.#current(watched)) {
        this.#options.log(`${watched.pull.toString()}: the queue for ${base}: ${describe(error)}`);
      }
    }
    watched.reading = false;
    watched.doneAt = this.#now();
    if (!this.#current(watched) || !watched.queued || watched.base !== base) return;
    if (place === undefined) {
      // What was read last stays, until a read answers.
      watched.wait = Math.min(watched.wait * 2, PLACE_MOST);
    } else {
      watched.wait = PLACE_EVERY;
      watched.place = place;
      this.#send(watched);
    }
    this.#schedule(watched);
  }

  /** Reads once why a view's pull request left its merge queue, and says so unless it merged. */
  async #readRemoval(watched: Watched): Promise<void> {
    let left: LeftQueue | undefined;
    try {
      const poller = await this.#options.poller(watched.login);
      const removal = await poller.readOnce(
        (client) => queueRemoval(client, watched.pull),
        watched.abort.signal,
      );
      left = leftOf(removal, watched.login);
    } catch (error) {
      const why = error instanceof GithubError ? error.message : describe(error);
      if (this.#current(watched)) this.#options.log(`${watched.pull.toString()}: ${why}`);
      left = { at: null, why: { kind: 'unknown', why: why.slice(0, 4096) }, partial: false };
    }
    // Queued again meanwhile, or let go: what it says is old news.
    if (!this.#current(watched) || watched.queued) return;
    watched.left = left ?? null;
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
