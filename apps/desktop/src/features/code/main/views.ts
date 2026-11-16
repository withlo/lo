// Where each view of a pull request's tab stands with trust: decided again each time the tab, git,
// the entries or the dismissals change, and sent to the window when it changes. A view an entry
// names has its pull request's repositories read from GitHub, and a decision rests only on a read
// that started after the view opened and after its pull request was last pushed to or reloaded, so
// IDs read for a repository that has since lost its name to another are never used for the other.
// Views of one pull request share a read once it's new enough for each, and it's forgotten once the
// last of them closes. A read that fails leaves its views untrusted, and is tried again after 5 s,
// doubling to 5 minutes, while a view still needs it. Nothing here calls Electron, so it runs under
// unit tests.

import type { PullRequestRepositories, ReadPriority } from '@lo/github';

import type { Status, Trusting } from '../contract.ts';
import { decide, needsRead, type Decision, type DecidedView, type Read } from './decide.ts';
import type { TrustEntry } from '../settings.ts';

/** What the tracker needs of a view, as the tab has it now. */
export interface ViewInfo extends DecidedView {
  readonly id: string;
  /** Whether a read can be made for it yet: who it acts as is known. */
  readonly canRead: boolean;
  /**
   * The pull request's heads as the tab has them, GitHub's newest and the one on screen, which
   * change as it's pushed to and reloaded: a read made before they changed is read again.
   */
  readonly heads: string;
}

export interface ViewsOptions {
  /** A view as the tab has it now, or nothing once it's closed. */
  readonly view: (id: string) => ViewInfo | undefined;
  /**
   * Reads the repositories view `view`'s pull request joins, from GitHub: as one someone at the
   * screen waits on (`foreground`), or not. One given up on through `signal` leaves the queue.
   */
  readonly read: (
    view: ViewInfo,
    priority: ReadPriority,
    signal: AbortSignal | undefined,
  ) => Promise<PullRequestRepositories>;
  /** Whether the banner was dismissed for a repository, by its name. */
  readonly dismissed: (repo: string) => boolean;
  readonly publish: (status: Status) => void;
  readonly log: (line: string) => void;
  /** The first wait before a failed read is tried again, in ms, doubling to {@link RETRY_MAX}. */
  readonly retryFirst?: number;
}

/** The first wait before a failed read is tried again, in ms. */
export const RETRY_FIRST = 5_000;
/** The longest wait between tries of a read. */
export const RETRY_MAX = 5 * 60_000;

/**
 * A pull request's reads: the newest that came back, the newest under way, and the newest that
 * failed since, waiting to be tried again. Each is stamped with when it started, on the tracker's
 * own clock, which a view's own stamp is compared with.
 */
interface Reads {
  last?: { readonly started: number; readonly repositories: PullRequestRepositories };
  pending?: { readonly started: number };
  failed?: {
    readonly started: number;
    readonly attempt: number;
    timer: ReturnType<typeof setTimeout> | undefined;
  };
}

/** A view followed: its pull request's key, since when its reads count, and what was sent. */
interface Followed {
  readonly key: string;
  readonly heads: string;
  /** Only a read started after this, on the tracker's clock, decides it. */
  readonly since: number;
  decision: Decision;
  status: Status;
  sent: string;
}

/** What Lo says of a read that failed. */
export const UNREAD =
  "Lo couldn't check with GitHub that this is the repo you trusted. It tries again by itself.";

/** The key a view's pull request's reads are kept by: its repository's name in any case, and number. */
function keyOf(view: { readonly repo: string; readonly number: number }): string {
  return `${view.repo.toLowerCase()}#${view.number}`;
}

export class TrustViews {
  readonly #options: ViewsOptions;
  readonly #retryFirst: number;
  /** The views followed, by id. */
  readonly #views = new Map<string, Followed>();
  /** Each pull request's reads, by {@link keyOf}, while a view of it is followed. */
  readonly #reads = new Map<string, Reads>();
  /** How far trusting each view has got, by id, while main is trusting it. */
  readonly #trusting = new Map<string, Trusting>();
  /** The entries, once the settings file has been read. */
  #entries: readonly TrustEntry[] | undefined;
  /** The tracker's clock, which only goes forward: each view and read is stamped from it. */
  #clock = 0;
  #stopped = false;

  constructor(options: ViewsOptions) {
    this.#options = options;
    this.#retryFirst = options.retryFirst ?? RETRY_FIRST;
  }

  /** The entries Lo reads in the settings file, as they change. Every view is decided again. */
  setEntries(entries: readonly TrustEntry[]): void {
    this.#entries = entries;
    this.updateAll();
  }

  /** The entries, once the settings file has been read. */
  get entries(): readonly TrustEntry[] | undefined {
    return this.#entries;
  }

  /** Decides view `id` again, as when the tab says it changed, and forgets it once it's closed. */
  update(id: string): void {
    if (this.#stopped) return;
    const view = this.#options.view(id);
    const followed = this.#views.get(id);
    if (!view) {
      this.#views.delete(id);
      if (followed) this.#release(followed.key);
      return;
    }
    const key = keyOf(view);
    // A view just opened, or of another pull request now, or pushed to or reloaded, counts only
    // reads that start from now on.
    const fresh = followed?.key === key && followed.heads === view.heads;
    const since = fresh ? followed.since : this.#tick();
    if (needsRead(view, this.#entries) && view.canRead && this.#wantsRead(key, since)) {
      this.#startRead(view);
    }
    const decision = decide(view, this.#entries, this.#readFor(key, since));
    const trusting = this.#trusting.get(id);
    const status: Status = {
      view: id,
      repo: view.repo,
      pull: view.number,
      head: decision.head,
      trust: decision.trust,
      dismissed: this.#options.dismissed(view.repo),
      ...(trusting === undefined ? {} : { trusting }),
    };
    const sent = JSON.stringify(status);
    this.#views.set(id, { key, heads: view.heads, since, decision, status, sent });
    if (followed && followed.key !== key) this.#release(followed.key);
    if (followed?.sent !== sent) this.#options.publish(status);
  }

  /**
   * How far trusting view `id` has got, as main asks the reader and writes what they said, or, with
   * nothing, that it's over: its status says so.
   */
  setTrusting(id: string, step: Trusting | undefined): void {
    if (step === undefined) this.#trusting.delete(id);
    else this.#trusting.set(id, step);
    this.update(id);
  }

  /** Decides every view followed again. */
  updateAll(): void {
    for (const id of this.#views.keys()) this.update(id);
  }

  /** Where view `id` stands, deciding it first, or nothing for a view that isn't open. */
  status(id: string): Status | undefined {
    this.update(id);
    const kept = this.#views.get(id);
    return kept?.status;
  }

  /** What was last decided for view `id`, if it's followed. */
  decision(id: string): Decision | undefined {
    return this.#views.get(id)?.decision;
  }

  /**
   * The entry that trusts view `id`: as last decided, or, while it's checked again after a push or
   * a reload, as the read before that decided it, since it's the entry that will trust it again.
   * Nothing when no entry trusts it, or nothing has been read to say.
   */
  trustedBy(id: string): TrustEntry | undefined {
    const followed = this.#views.get(id);
    if (!followed) return undefined;
    if (followed.decision.trust.kind === 'trusted') return followed.decision.by;
    const last = this.#reads.get(followed.key)?.last;
    const view = this.#options.view(id);
    if (!last || !view) return undefined;
    // While the local copy fetches the push, the read before still says which entry it was.
    const decision = decide({ ...view, local: true }, this.#entries, {
      kind: 'read',
      repositories: last.repositories,
    });
    return decision.trust.kind === 'trusted' ? decision.by : undefined;
  }

  /**
   * Reads afresh the repositories view `id`'s pull request joins, as when the reader asks to
   * trust it, ahead of polls, since the reader waits on it, and decides its views again with them.
   * Once `signal` aborts, nobody waits on it: if it's still waiting its turn, it's never made.
   */
  async readNow(id: string, signal?: AbortSignal): Promise<PullRequestRepositories> {
    const view = this.#options.view(id);
    if (!view) throw new Error('The view is closed.');
    this.update(id);
    const key = keyOf(view);
    const started = this.#tick();
    const repositories = await this.#options.read(view, 'foreground', signal);
    this.#landed(key, started, repositories);
    return repositories;
  }

  /** Stops every read waiting to be tried again. Nothing is decided after. */
  stop(): void {
    this.#stopped = true;
    for (const key of this.#reads.keys()) this.#forget(key);
    this.#views.clear();
    this.#trusting.clear();
  }

  #tick(): number {
    this.#clock += 1;
    return this.#clock;
  }

  /** What was read of pull request `key` that a view followed since `since` may rest on. */
  #readFor(key: string, since: number): Read | undefined {
    const reads = this.#reads.get(key);
    if (reads?.last && reads.last.started > since) {
      return { kind: 'read', repositories: reads.last.repositories };
    }
    if (reads?.failed && reads.failed.started > since) return { kind: 'failed', message: UNREAD };
    return undefined;
  }

  /**
   * Whether a view followed since `since` needs pull request `key` read now: nothing it may rest
   * on came back, none is under way that it could, and none failed for it that waits its turn.
   */
  #wantsRead(key: string, since: number): boolean {
    const reads = this.#reads.get(key);
    if (!reads) return true;
    if (reads.last && reads.last.started > since) return false;
    if (reads.pending && reads.pending.started > since) return false;
    return !(reads.failed && reads.failed.started > since && reads.failed.timer !== undefined);
  }

  /** Forgets pull request `key`'s reads once no view followed is of it. */
  #release(key: string): void {
    for (const followed of this.#views.values()) if (followed.key === key) return;
    this.#forget(key);
  }

  #forget(key: string): void {
    const failed = this.#reads.get(key)?.failed;
    if (failed?.timer) clearTimeout(failed.timer);
    this.#reads.delete(key);
  }

  /** Keeps a read of pull request `key` started at `started` that came back, if it's the newest. */
  #landed(key: string, started: number, repositories: PullRequestRepositories): void {
    if (this.#stopped || ![...this.#views.values()].some((followed) => followed.key === key)) {
      return;
    }
    let reads = this.#reads.get(key);
    if (!reads) {
      reads = {};
      this.#reads.set(key, reads);
    }
    if (reads.pending?.started === started) delete reads.pending;
    if (reads.last && reads.last.started > started) return;
    reads.last = { started, repositories };
    if (reads.failed && reads.failed.started < started) {
      if (reads.failed.timer) clearTimeout(reads.failed.timer);
      delete reads.failed;
    }
    this.updateAll();
  }

  /** Reads `view`'s pull request's repositories, now. */
  #startRead(view: ViewInfo): void {
    const key = keyOf(view);
    let reads = this.#reads.get(key);
    if (!reads) {
      reads = {};
      this.#reads.set(key, reads);
    }
    const kept = reads;
    // A read that failed keeps counting its tries, so the wait after each keeps growing.
    const tries = (kept.failed?.attempt ?? 0) + 1;
    if (kept.failed?.timer) {
      clearTimeout(kept.failed.timer);
      kept.failed.timer = undefined;
    }
    const started = this.#tick();
    kept.pending = { started };
    Promise.resolve()
      .then(() => this.#options.read(view, 'background', undefined))
      .then(
        (repositories) => this.#landed(key, started, repositories),
        (error: unknown) => {
          if (this.#stopped || this.#reads.get(key) !== kept) return;
          this.#options.log(
            `${key}: couldn't read its repositories (${error instanceof Error ? error.message : String(error)}).`,
          );
          if (kept.pending?.started === started) delete kept.pending;
          // A newer read came back, or is under way: it says more than this one.
          if ((kept.last && kept.last.started > started) || kept.pending) return;
          if (kept.failed?.timer) clearTimeout(kept.failed.timer);
          const failed: NonNullable<Reads['failed']> = {
            started,
            attempt: tries,
            timer: undefined,
          };
          const wait = Math.min(this.#retryFirst * 2 ** (tries - 1), RETRY_MAX);
          failed.timer = setTimeout(() => {
            failed.timer = undefined;
            if (this.#stopped || this.#reads.get(key) !== kept || kept.failed !== failed) return;
            // Only while a view still needs it, with the entries as they are now.
            for (const [id, followed] of this.#views) {
              const each = followed.key === key ? this.#options.view(id) : undefined;
              if (
                each?.canRead &&
                needsRead(each, this.#entries) &&
                this.#wantsRead(key, followed.since)
              ) {
                this.#startRead(each);
                return;
              }
            }
          }, wait);
          kept.failed = failed;
          this.updateAll();
        },
      );
  }
}
