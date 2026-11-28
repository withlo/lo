// Editing a term of a repository's definitions in main, as a tab's account: one commit of
// `terms.json` on the commit `refs/lo/terms` holds, written through GitHub's API, and the ref moved
// to it, only from that commit and only forward (`@lo/github`'s `terms.ts`). Nothing else is ever
// written: no branch, and no other ref. Each attempt is one turn of writes in the account's queue:
// whether the account may write, the ref read afresh with `terms.json`, the edit made in it in the
// background process, then a tree, a commit and the move, the queue's spacing apart.
//
// One edit of a repository's definitions is written at a time, whoever it's by: another waits for
// it. Where the ref moved meanwhile, the definitions are read again and the edit made again on
// them, three times at most; a term that changed since the edit started is never written over,
// but comes back to whoever edited it. An answer lost is settled by reading the ref, never by
// sending anything again. Nothing here calls Electron.

import { STORE_REF } from '@lo/artifact';
import {
  causeOf,
  GithubError,
  holds,
  moveTerms,
  saidBy,
  termsAccess,
  termsCommit,
  termsRefusal,
  termsTree,
  watchRef,
  type GithubClient,
  type OverviewRef,
  type RepoRef,
  type RefMove,
} from '@lo/github';

import { detailsOf, githubCause } from '../../../ipc/cause.ts';
import type { EditOutcome, StoreFound, TermEdit } from '../contract.ts';
import type { EditInput, EditMade } from '../jobs.ts';
import { Unexpected } from './fetch.ts';
import { storeAt, type Stores } from './terms.ts';

/** How many times an edit is made again on definitions that moved as it was written. */
export const EDIT_AGAIN = 3;

/** What edits write with. */
export interface EditWrites {
  /**
   * Runs `request` as `login`, in a turn of writes in its account's queue, given how long to wait
   * between two writes in it; or answers `paused`, with when that ends, while GitHub has asked Lo
   * to hold off writing.
   */
  write<T>(
    login: string,
    request: (client: GithubClient, spacing: number) => Promise<T>,
    paused: (until: number) => T,
  ): Promise<T>;
  /** Runs `request` as `login`, in a turn of reads in its account's queue, as Check again does. */
  read<T>(login: string, request: (client: GithubClient) => Promise<T>): Promise<T>;
  /** Makes an edit in `terms.json`: the background process's `overview.edit`. */
  make(input: EditInput): Promise<EditMade>;
  readonly stores: Stores;
  readonly log: (line: string) => void;
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now?: (() => number) | undefined;
  /** Waits `ms` milliseconds. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
}

/** What the ref held, as an edit read it: nothing, a commit of `terms.json`, or neither. */
type Read =
  | { kind: 'none' }
  | { kind: 'file'; commit: string; found: StoreFound; bytes: Uint8Array }
  | { kind: 'unreadable'; found: Extract<StoreFound, { kind: 'unreadable' }> };

/**
 * What one attempt came to: an outcome, or `again`, where the ref moved as it was written; and
 * whether the definitions are to be read again afterwards, outside the turn, which holds the queue.
 */
type Step = { kind: 'done'; outcome: EditOutcome; reread?: boolean } | { kind: 'again' };

/** The account an edit is by, and the repository whose definitions it changes. */
interface Editing {
  readonly login: string;
  readonly repository: RepoRef;
}

/** Every edit of the definitions main writes, one at a time for each repository. */
export class Edits {
  readonly #writes: EditWrites;
  readonly #now: () => number;
  readonly #sleep: (ms: number) => Promise<void>;
  /** The edit last asked for in each repository, by its key, which the next waits for. */
  readonly #last = new Map<string, Promise<unknown>>();

  constructor(writes: EditWrites) {
    this.#writes = writes;
    this.#now = writes.now ?? Date.now;
    this.#sleep =
      writes.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, Math.max(0, ms))));
  }

  /** Writes `edit` to `repository`'s definitions as `login`, once the edit before it is done. */
  edit(login: string, repository: RepoRef, edit: TermEdit): Promise<EditOutcome> {
    return this.#inTurn(repository, () => this.#edit({ login, repository }, edit));
  }

  /**
   * Settles an edit whose answer was lost: whether `repository`'s definitions hold `commit`, the
   * edit's, or a commit after it, read as `login`.
   */
  check(login: string, repository: RepoRef, commit: string): Promise<EditOutcome> {
    return this.#inTurn(repository, () => this.#check({ login, repository }, commit));
  }

  #inTurn<T>(repository: RepoRef, run: () => Promise<T>): Promise<T> {
    const key = repository.key;
    const before = this.#last.get(key) ?? Promise.resolve();
    const now = before.then(run, run);
    const settled = now.then(
      () => {},
      () => {},
    );
    this.#last.set(key, settled);
    void settled.then(() => {
      if (this.#last.get(key) === settled) this.#last.delete(key);
    });
    return now;
  }

  async #edit(editing: Editing, edit: TermEdit): Promise<EditOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      let step: Step;
      try {
        step = await this.#writes.write(
          editing.login,
          (client, spacing) => this.#attempt(editing, edit, client, spacing),
          (until): Step => ({
            kind: 'done',
            outcome: {
              kind: 'failed',
              cause: { kind: 'rateLimit', resets: Math.round(until) },
              details: null,
            },
          }),
        );
      } catch (error) {
        return this.#failed(editing, error, `editing "${edit.term}"`);
      }
      if (step.kind === 'again') {
        if (attempt < EDIT_AGAIN) continue;
        this.#writes.log(
          `${editing.repository.toString()}'s definitions moved each time "${edit.term}" was written`,
        );
        this.#reread(editing);
        return { kind: 'refused', why: 'changing', details: null };
      }
      if (step.reread) this.#reread(editing);
      return step.outcome;
    }
  }

  /** One attempt at `edit`, in a turn of writes. */
  async #attempt(
    editing: Editing,
    edit: TermEdit,
    client: GithubClient,
    spacing: number,
  ): Promise<Step> {
    const { repository } = editing;
    const acting = { kind: 'account', login: editing.login } as const;
    const access = await termsAccess(client, repository);
    this.#writes.stores.access(acting, repository, access.push);
    if (!access.push) return done({ kind: 'refused', why: 'push', details: null });

    const read = await this.#read(client, editing);
    if (read.kind === 'unreadable') {
      this.#writes.stores.wrote(acting, repository, read.found, null);
      const { why } = read.found;
      return done({
        kind: 'unreadable',
        why: why === 'tooLarge' ? { kind: 'tooLarge' } : { kind: 'notStore', why },
      });
    }
    const made = await this.#writes.make({
      bytes: read.kind === 'file' ? read.bytes : null,
      key: edit.key,
      base: edit.base,
      edit: {
        term: edit.term,
        definition: edit.definition,
        aliases: edit.aliases,
        login: editing.login,
        at: githubTime(this.#now(), client),
      },
    });
    const found: StoreFound = read.kind === 'file' ? read.found : { kind: 'none' };
    const bytes = read.kind === 'file' ? read.bytes : null;
    switch (made.kind) {
      case 'edited':
        break;
      case 'same':
        // Another write, or one of this account's whose answer was lost, wrote it already.
        this.#writes.stores.wrote(acting, repository, found, bytes);
        return done({ kind: 'saved' });
      case 'changed':
        this.#writes.stores.wrote(acting, repository, found, bytes);
        return done({ kind: 'changed', term: made.term });
      case 'refused':
        return done({ kind: 'invalid', message: made.message });
      case 'unreadable':
        return done({ kind: 'unreadable', why: { kind: 'store', problem: made.problem } });
      case 'tooLarge':
        return done({ kind: 'unreadable', why: { kind: 'tooLarge' } });
      default:
        made satisfies never;
        throw new Error('An edit came to nothing known.');
    }

    const parent = read.kind === 'file' ? read.commit : undefined;
    let tree: Awaited<ReturnType<typeof termsTree>>;
    let commit: string;
    try {
      tree = await termsTree(client, repository, made.text);
      await this.#sleep(spacing);
      commit = await termsCommit(client, repository, {
        tree: tree.tree,
        parent,
        message: `${edit.base === null ? 'Add' : 'Edit'} ${JSON.stringify(edit.term)}`,
      });
      await this.#sleep(spacing);
    } catch (error) {
      // A tree or a commit nothing points to changes nothing: one whose answer was lost too.
      const refused = termsRefusal(error);
      if (!refused) throw error;
      return this.#refused(editing, refused.why, refused.said);
    }
    const written = new TextEncoder().encode(made.text);
    const ours: StoreFound = { kind: 'file', commit, id: tree.blob, size: written.length };

    let move: RefMove;
    try {
      move = await moveTerms(client, access.repositoryId, { from: parent, to: commit });
    } catch (error) {
      if (!(error instanceof GithubError) || !error.mayHavePosted()) throw error;
      // Its answer was lost, and it may have moved: the ref says.
      this.#writes.log(
        `moving ${repository.toString()}'s ${STORE_REF} to ${commit}: no answer: ${error.message}`,
      );
      return this.#settle(editing, client, commit, written, ours, error);
    }
    switch (move.kind) {
      case 'moved':
        this.#writes.stores.wrote(acting, repository, ours, written);
        return done({ kind: 'saved' });
      case 'refused':
        return this.#refused(editing, move.why, move.said);
      case 'behind':
        return { kind: 'again' };
      case 'unsure': {
        // GitHub says only that something went wrong, which it says of a ref that moved since it
        // was read, and of its own failures: the ref says which.
        let now: OverviewRef;
        try {
          now = await this.#ref(client, editing);
        } catch (error) {
          this.#writes.log(`reading ${STORE_REF} after a move that went wrong: ${describe(error)}`);
          return done({ kind: 'unconfirmed', commit, details: detailsOf(move.said) ?? null });
        }
        if (now.kind === 'commit' && now.sha === commit) {
          this.#writes.stores.wrote(acting, repository, ours, written);
          return done({ kind: 'saved' });
        }
        const still = now.kind === 'commit' ? now.sha === parent : parent === undefined;
        if (!still) return { kind: 'again' };
        this.#writes.log(`moving ${repository.toString()}'s ${STORE_REF}: ${move.said}`);
        return done({
          kind: 'failed',
          cause: { kind: 'github' },
          details: detailsOf(move.said) ?? null,
        });
      }
      default:
        move satisfies never;
        throw new Error('Moving the ref came to nothing known.');
    }
  }

  /**
   * Settles a move whose answer was lost by reading the ref, in the same turn: it holds `commit`,
   * or a commit after it, or it doesn't, which GitHub not answering is why of; or that read fails
   * too, and it's `unconfirmed`.
   */
  async #settle(
    editing: Editing,
    client: GithubClient,
    commit: string,
    written: Uint8Array,
    ours: StoreFound,
    lost: GithubError,
  ): Promise<Step> {
    const details = detailsOf(lost.said()) ?? null;
    let now: OverviewRef;
    let held: boolean;
    try {
      now = await this.#ref(client, editing);
      held =
        now.kind === 'commit' &&
        (now.sha === commit || (await holds(client, editing.repository, now.sha, commit)));
    } catch (error) {
      this.#writes.log(`reading ${STORE_REF} after a move with no answer: ${describe(error)}`);
      return done({ kind: 'unconfirmed', commit, details });
    }
    const acting = { kind: 'account', login: editing.login } as const;
    if (!held) return done({ kind: 'failed', cause: { kind: 'timeout' }, details });
    if (now.kind === 'commit' && now.sha === commit) {
      this.#writes.stores.wrote(acting, editing.repository, ours, written);
      return done({ kind: 'saved' });
    }
    // A commit after it, someone else's: read whole, after the turn.
    return done({ kind: 'saved' }, true);
  }

  async #check(editing: Editing, commit: string): Promise<EditOutcome> {
    try {
      const held = await this.#writes.read(editing.login, async (client) => {
        const now = await this.#ref(client, editing);
        if (now.kind !== 'commit') return false;
        return now.sha === commit || holds(client, editing.repository, now.sha, commit);
      });
      if (!held) return { kind: 'failed', cause: { kind: 'timeout' }, details: null };
    } catch (error) {
      this.#writes.log(`checking an edit of ${editing.repository.toString()}: ${describe(error)}`);
      return { kind: 'unconfirmed', commit, details: detailsOf(saidBy(error)) ?? null };
    }
    this.#reread(editing);
    return { kind: 'saved' };
  }

  /** What the ref holds now, asked afresh. */
  async #ref(client: GithubClient, { repository }: Editing): Promise<OverviewRef> {
    const answer = await watchRef(client, repository, STORE_REF, undefined);
    if (answer.notModified)
      throw new Unexpected('GitHub said nothing changed, with nothing asked.');
    return answer.value;
  }

  /** The ref, and `terms.json` in the commit it holds, read afresh, from what's kept where it can. */
  async #read(client: GithubClient, editing: Editing): Promise<Read> {
    const ref = await this.#ref(client, editing);
    if (ref.kind === 'none') return { kind: 'none' };
    if (ref.kind === 'other') {
      return {
        kind: 'unreadable',
        found: { kind: 'unreadable', object: ref.sha, why: 'notCommit', size: null },
      };
    }
    const { repository } = editing;
    const { stores } = this.#writes;
    const at = await storeAt(client, repository, ref.sha, (id) => stores.file(repository, id));
    if (at.found.kind === 'unreadable') return { kind: 'unreadable', found: at.found };
    if (at.found.kind !== 'file' || at.bytes === null) {
      throw new Unexpected('The definitions’ commit gave no terms.json to read.');
    }
    return { kind: 'file', commit: ref.sha, found: at.found, bytes: at.bytes };
  }

  /** GitHub refused the write, for `why`: without push access, the account's said so. */
  #refused(editing: Editing, why: 'push' | 'rule', said: string): Step {
    if (why === 'push') {
      const acting = { kind: 'account', login: editing.login } as const;
      this.#writes.stores.access(acting, editing.repository, false);
    }
    this.#writes.log(`writing ${editing.repository.toString()}'s definitions: ${said}`);
    return done({ kind: 'refused', why, details: detailsOf(said) ?? null });
  }

  #failed(editing: Editing, error: unknown, what: string): EditOutcome {
    this.#writes.log(`${what} in ${editing.repository.toString()}: ${describe(error)}`);
    const refused = termsRefusal(error);
    if (refused) {
      if (refused.why === 'push') {
        const acting = { kind: 'account', login: editing.login } as const;
        this.#writes.stores.access(acting, editing.repository, false);
      }
      return { kind: 'refused', why: refused.why, details: detailsOf(refused.said) ?? null };
    }
    const cause = githubCause(
      causeOf(error, { login: editing.login, owner: editing.repository.owner, now: this.#now() }),
    );
    return { kind: 'failed', cause, details: detailsOf(saidBy(error)) ?? null };
  }

  /** Reads the definitions again, as the account, whole: never inside a turn of writes. */
  #reread({ login, repository }: Editing): void {
    void this.#writes.stores.read({ kind: 'account', login }, repository, {
      priority: 'foreground',
      force: true,
    });
  }
}

function done(outcome: EditOutcome, reread = false): Step {
  return { kind: 'done', outcome, reread };
}

/**
 * The time now as GitHub's clock has it, to the second, as an RFC 3339 time in UTC: this
 * computer's, moved by how far ahead GitHub's was in its last answers.
 */
export function githubTime(now: number, client: Pick<GithubClient, 'githubAhead'>): string {
  const at = new Date(Math.floor((now + (client.githubAhead() ?? 0)) / 1000) * 1000);
  return at.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
