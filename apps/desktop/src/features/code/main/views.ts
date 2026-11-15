// Where each view of a pull request's tab stands with trust: decided again each time the tab, git,
// the entries or the dismissals change, and sent to the window when it changes. A view an entry
// names has its pull request's repositories read from GitHub, once for each pull request while Lo
// runs, kept for every view of it; a read that fails leaves its views untrusted, and is tried
// again after 5 s, doubling to 5 minutes, while a view still needs it. Nothing here calls
// Electron, so it runs under unit tests.

import type { PullRequestRepositories } from '@lo/github';

import type { Status } from '../contract.ts';
import { decide, needsRead, type Decision, type DecidedView, type Read } from './decide.ts';
import type { TrustEntry } from '../settings.ts';

/** What the tracker needs of a view, as the tab has it now. */
export interface ViewInfo extends DecidedView {
  readonly id: string;
  /** Whether a read can be made for it yet: who it acts as is known. */
  readonly canRead: boolean;
}

export interface ViewsOptions {
  /** A view as the tab has it now, or nothing once it's closed. */
  readonly view: (id: string) => ViewInfo | undefined;
  /** Reads the repositories view `view`'s pull request joins, from GitHub. */
  readonly read: (view: ViewInfo) => Promise<PullRequestRepositories>;
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

/** A pull request's repositories as Lo has read them, or is reading or waiting to read them. */
type Kept =
  | { kind: 'reading' }
  | { kind: 'read'; repositories: PullRequestRepositories }
  | {
      kind: 'failed';
      message: string;
      attempt: number;
      timer: ReturnType<typeof setTimeout> | undefined;
    };

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
  /** The views followed, each with what was last decided and sent. */
  readonly #views = new Map<string, { decision: Decision; status: Status; sent: string }>();
  /** Each pull request's repositories, by {@link keyOf}. */
  readonly #reads = new Map<string, Kept>();
  /** The entries, once the settings file has been read. */
  #entries: readonly TrustEntry[] | undefined;
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
    if (!view) {
      this.#views.delete(id);
      return;
    }
    if (needsRead(view, this.#entries) && view.canRead) this.#startRead(view);
    const decision = decide(view, this.#entries, this.#readOf(view));
    const status: Status = {
      view: id,
      repo: view.repo,
      pull: view.number,
      head: decision.head,
      trust: decision.trust,
      dismissed: this.#options.dismissed(view.repo),
    };
    const sent = JSON.stringify(status);
    const kept = this.#views.get(id);
    this.#views.set(id, { decision, status, sent });
    if (kept?.sent !== sent) this.#options.publish(status);
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
   * Keeps `repositories`, read afresh for `view`'s pull request as the reader asked to trust it,
   * in place of what was read before, and decides its views again.
   */
  took(
    view: { readonly repo: string; readonly number: number },
    repositories: PullRequestRepositories,
  ): void {
    this.#forget(keyOf(view));
    this.#reads.set(keyOf(view), { kind: 'read', repositories });
    this.updateAll();
  }

  /** Stops every read waiting to be tried again. Nothing is decided after. */
  stop(): void {
    this.#stopped = true;
    for (const key of this.#reads.keys()) this.#forget(key);
    this.#views.clear();
  }

  #readOf(view: ViewInfo): Read | undefined {
    const kept = this.#reads.get(keyOf(view));
    switch (kept?.kind) {
      case undefined:
      case 'reading':
        return undefined;
      case 'read':
        return { kind: 'read', repositories: kept.repositories };
      case 'failed':
        return { kind: 'failed', message: kept.message };
      default:
        kept satisfies never;
        return undefined;
    }
  }

  #forget(key: string): void {
    const kept = this.#reads.get(key);
    if (kept?.kind === 'failed' && kept.timer) clearTimeout(kept.timer);
    this.#reads.delete(key);
  }

  /** Reads `view`'s pull request's repositories, unless they're read, being read, or waiting. */
  #startRead(view: ViewInfo, attempt?: number): void {
    const key = keyOf(view);
    const kept = this.#reads.get(key);
    if (kept && !(kept.kind === 'failed' && kept.timer === undefined)) return;
    // A read that failed, waited, and found no view needing it then, keeps counting its tries.
    const tries = attempt ?? (kept?.kind === 'failed' ? kept.attempt + 1 : 1);
    this.#reads.set(key, { kind: 'reading' });
    Promise.resolve()
      .then(() => this.#options.read(view))
      .then(
        (repositories) => {
          if (this.#stopped || this.#reads.get(key)?.kind !== 'reading') return;
          this.#reads.set(key, { kind: 'read', repositories });
          this.updateAll();
        },
        (error: unknown) => {
          if (this.#stopped || this.#reads.get(key)?.kind !== 'reading') return;
          this.#options.log(
            `${key}: couldn't read its repositories (${error instanceof Error ? error.message : String(error)}).`,
          );
          const wait = Math.min(this.#retryFirst * 2 ** (tries - 1), RETRY_MAX);
          const failed: Kept = {
            kind: 'failed',
            message: UNREAD,
            attempt: tries,
            timer: undefined,
          };
          failed.timer = setTimeout(() => {
            failed.timer = undefined;
            if (this.#stopped || this.#reads.get(key) !== failed) return;
            // Only while a view still needs it, with the entries as they are now.
            const needing = [...this.#views.keys()]
              .map((id) => this.#options.view(id))
              .find(
                (each) =>
                  each !== undefined &&
                  keyOf(each) === key &&
                  each.canRead &&
                  needsRead(each, this.#entries),
              );
            if (needing) this.#startRead(needing, tries + 1);
          }, wait);
          this.#reads.set(key, failed);
          this.updateAll();
        },
      );
  }
}
