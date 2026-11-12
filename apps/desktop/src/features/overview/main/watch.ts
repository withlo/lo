// A pull request's tab's overview in main: the ref `refs/lo/pr/<n>`, read in the pull request's
// repository, then in its fork, through GitHub's REST API as the tab's account, with each answer's
// ETag, so a read that finds nothing changed costs nothing. It's read as the tab is shown and as Lo
// comes to the front, and again every 30 s while the tab is on screen and Lo is in front (every 5
// minutes behind other windows), never sooner than GitHub's `x-poll-interval` asks; a public pull
// request opened without an account is read once. A commit Lo hasn't seen is read whole before it's
// offered, and a newer one never takes the place of the one on screen until it's loaded. What was
// read is kept, so the overview shows at once the next time, offline too. Nothing here calls
// Electron.

import {
  overviewRef,
  RepoRef,
  watchOverviewRef,
  type GithubClient,
  type OverviewRef,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { OverviewCommit, OverviewFile, OverviewState, Problem } from '../contract.ts';
import { entryAt, isReadable } from './listing.ts';
import type { Blobs } from './blobs.ts';
import { fetchBlob, isGone, readOverview, sizeOnly, type Github } from './fetch.ts';
import { problemOf, retryWait } from './problems.ts';
import type { SavedRefs } from './saved.ts';

/** How often the ref is read while the tab is on screen and Lo is in front, in milliseconds. */
export const FOREGROUND_EVERY = 30_000;
/** How often while Lo is behind other windows. */
export const BACKGROUND_EVERY = 5 * 60_000;

/** What a tab's overview reads with. */
export interface OverviewReads {
  /** Runs `request` with GitHub's client for `acting`, in its turn. */
  github<T>(acting: Acting, request: (client: GithubClient) => Promise<T>): Promise<T>;
  readonly blobs: Blobs;
  readonly saved: SavedRefs;
}

export interface OverviewTabOptions {
  readonly id: string;
  readonly reads: OverviewReads;
  /** Sends the overview to the window, each time it changes. */
  readonly publish: (state: OverviewState) => void;
  readonly log: (line: string) => void;
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now?: (() => number) | undefined;
}

/**
 * What was last read of the ref in one repository: the ETag GitHub gave, what it said, and how
 * many seconds its `x-poll-interval` asked Lo to wait before asking again, if it did.
 */
interface Heard {
  readonly etag: string;
  readonly ref: OverviewRef;
  readonly pollInterval: number | undefined;
}

/** What the ref holds, in the repository or its fork. */
type Found =
  | { kind: 'none' }
  | { kind: 'other' }
  | { kind: 'commit'; sha: string; source: OverviewCommit['source']; repository: RepoRef };

export class OverviewTab {
  readonly id: string;
  readonly #options: OverviewTabOptions;
  readonly #now: () => number;
  /** The pull request, once the tab knows its repository. */
  #pull: { repository: RepoRef; number: number } | undefined;
  #acting: Acting | undefined;
  /** The fork the head is in, `null` for none, once the tab knows. */
  #fork: RepoRef | null | undefined;
  #onScreen = false;
  #foreground = false;
  #found: OverviewState['found'] = 'unknown';
  #shown: OverviewCommit | undefined;
  #newer: OverviewCommit | undefined;
  /** Whether the overview on screen is what was kept, and GitHub hasn't said since it's there. */
  #saved = false;
  #problem: Problem | undefined;
  #failures = 0;
  /** Each repository's last answer, by its source and name. */
  readonly #heard = new Map<string, Heard>();
  /** The read under way. */
  #reading: Promise<void> | undefined;
  /** Whether to read again once the one under way is done. */
  #again = false;
  /** When the ref was last read through, in milliseconds since the Unix epoch. */
  #readAt: number | undefined;
  /**
   * The least time between reads GitHub asked for, with `x-poll-interval`, in the last read, in
   * milliseconds; and in the read under way.
   */
  #floor = 0;
  #asking = 0;
  /** Whether a public pull request read once has been. */
  #readOnce = false;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  #said: string | undefined;

  constructor(options: OverviewTabOptions) {
    this.#options = options;
    this.id = options.id;
    this.#now = options.now ?? Date.now;
  }

  /**
   * Follows the tab as it is now: its pull request, who it acts as and where its head is, whether
   * it's on screen, and whether Lo is in front. A tab shown reads the ref at once; one hidden reads
   * nothing until it's shown again.
   */
  update(info: PullTabInfo, onScreen: boolean, foreground: boolean): void {
    if (this.#closed) return;
    const repository = new RepoRef(info.repository.owner, info.repository.name);
    const pull = this.#pull;
    // What it reads changed: another name for the repository, or where the head is.
    let moved = false;
    const said = this.#acting?.kind;
    if (!pull || !pull.repository.equals(repository) || pull.number !== info.number) {
      this.#pull = { repository, number: info.number };
      this.#heard.clear();
      this.#takeSaved();
      moved = pull !== undefined;
    }
    this.#acting = info.acting;
    const fork = info.head?.fork;
    const forkNow =
      info.head === undefined ? undefined : fork ? new RepoRef(fork.owner, fork.name) : null;
    if (!sameFork(this.#fork, forkNow)) {
      moved ||= this.#fork !== undefined;
      this.#fork = forkNow;
    }
    const shown = onScreen && !this.#onScreen;
    this.#onScreen = onScreen;
    this.#foreground = foreground;
    if (!onScreen) this.#stopTimer();
    else if (shown || moved) this.#read();
    else this.#schedule();
    // The tab changes often, as its local copy is fetched: only what this says is sent.
    if (pull === undefined || moved || said !== info.acting?.kind) this.#publish();
  }

  /**
   * Lo came to the front, which reads the ref at once, so a new overview shows promptly, unless
   * GitHub asked Lo to wait for the rate limit; or it went behind another window.
   */
  setForeground(foreground: boolean): void {
    if (this.#closed || foreground === this.#foreground) return;
    this.#foreground = foreground;
    if (foreground && this.#onScreen && this.#problem?.kind !== 'rateLimited') this.#read();
    else this.#schedule();
  }

  /** Reads the ref again now, after a failure. */
  retry(): void {
    if (this.#closed) return;
    this.#failures = 0;
    this.#read();
  }

  /** Puts the newer overview on screen. */
  load(): void {
    const newer = this.#newer;
    if (this.#closed || !newer) return;
    this.#shown = newer;
    this.#newer = undefined;
    this.#saved = false;
    this.#publish();
  }

  /** The overview as the window gets it. */
  state(): OverviewState {
    const number = this.#pull?.number;
    return {
      id: this.id,
      ref: number === undefined ? '' : overviewRef(number),
      watching: this.#acting?.kind === 'account',
      found: this.#found,
      overview: this.#shown ?? null,
      newer: this.#newer ?? null,
      saved: this.#saved,
      problem: this.#problem ?? null,
    };
  }

  /**
   * Files of overview commit `commit`, the one on screen or the newer one, by their paths, in the
   * order asked: kept ones at once, the rest raw from GitHub, each once it hashes to its ID. Only
   * `artifact.md` and figures are ever read, only of a commit whose text was read, and a file too
   * large for any reader to want its bytes comes with its size alone. A file asked for twice is read
   * once, and both answers are the same.
   */
  async files(commit: string, paths: readonly string[]): Promise<OverviewFile[]> {
    const overview = [this.#shown, this.#newer].find((each) => each?.id === commit);
    const acting = this.#acting;
    if (!overview || !acting) {
      throw new IpcError('moved', "That isn't the overview on screen, or the newer one.");
    }
    const github: Github = (request) => this.#options.reads.github(acting, request);
    const repository = new RepoRef(overview.repository.owner, overview.repository.name);
    const answers: OverviewFile[] = [];
    // Each file's answer, by its ID, never by its path, which may be long.
    const read = new Map<string, OverviewFile>();
    for (const path of paths) {
      if (!overview.read || !isReadable(path)) {
        answers.push({ kind: 'refused' });
        continue;
      }
      const entry = entryAt(overview.entries, path);
      if (!entry) {
        answers.push({ kind: 'missing' });
        continue;
      }
      if (entry.kind !== 'file') {
        answers.push({ kind: 'notFile', is: entry.kind });
        continue;
      }
      let answer = read.get(entry.id);
      if (!answer) {
        answer = await this.#file(github, repository, entry.id, entry.size);
        read.set(entry.id, answer);
      }
      answers.push(answer);
    }
    return answers;
  }

  /** The file `id` names, of `size` bytes, in `repository`, as {@link OverviewTab.files} answers. */
  async #file(
    github: Github,
    repository: RepoRef,
    id: string,
    size: number | null,
  ): Promise<OverviewFile> {
    if (size === null) return { kind: 'unread', why: "GitHub didn't say how large it is." };
    if (sizeOnly(size)) return { kind: 'file', size, bytes: null };
    try {
      const bytes = await fetchBlob(github, this.#options.reads.blobs, repository, id);
      return { kind: 'file', size: bytes.length, bytes };
    } catch (error) {
      this.#options.log(`reading file ${id} of the overview: ${describe(error)}`);
      return { kind: 'unread', why: describe(error) };
    }
  }

  /** Stops everything, as the tab closes or Lo quits. */
  close(): void {
    this.#closed = true;
    this.#stopTimer();
  }

  /** What was kept of the pull request's overview, on screen at once if nothing is yet. */
  #takeSaved(): void {
    const pull = this.#pull;
    if (!pull || this.#shown) return;
    let kept: OverviewCommit | undefined;
    try {
      kept = this.#options.reads.saved.get(keyOf(pull));
    } catch (error) {
      this.#options.log(`reading what was kept of the overview: ${describe(error)}`);
    }
    if (kept) {
      this.#shown = kept;
      this.#saved = true;
    }
  }

  /** Whether the ref is read now: the tab is on screen, and knows who it acts as and its head. */
  #canRead(): boolean {
    if (this.#closed || !this.#onScreen || !this.#pull || !this.#acting) return false;
    if (this.#fork === undefined) return false;
    return this.#acting.kind === 'account' || !this.#readOnce;
  }

  /** Reads the ref now, or once the read under way is done. */
  #read(): void {
    this.#stopTimer();
    if (!this.#canRead()) return;
    if (this.#reading) {
      this.#again = true;
      return;
    }
    this.#reading = this.#readNow().finally(() => {
      this.#reading = undefined;
      if (this.#again) {
        this.#again = false;
        this.#read();
      } else {
        this.#schedule();
      }
      this.#publish();
    });
  }

  async #readNow(): Promise<void> {
    const pull = this.#pull;
    const acting = this.#acting;
    if (!pull || !acting) return;
    const github: Github = (request) => this.#options.reads.github(acting, request);
    this.#asking = 0;
    try {
      const found = await this.#find(github, pull);
      if (this.#closed) return;
      await this.#take(found, github, pull);
      if (this.#closed) return;
      this.#failures = 0;
      this.#problem = undefined;
      this.#readAt = this.#now();
      this.#floor = this.#asking;
      if (acting.kind === 'anonymous') this.#readOnce = true;
    } catch (error) {
      if (this.#closed) return;
      this.#failures += 1;
      const { problem, wait } = problemOf(error, acting, this.#failures, this.#now());
      this.#problem = problem;
      this.#options.log(`reading ${overviewRef(pull.number)}: ${describe(error)}`);
      this.#retryIn(wait);
    }
  }

  /** What the ref holds: in the pull request's repository, else in its fork. */
  async #find(github: Github, pull: { repository: RepoRef; number: number }): Promise<Found> {
    const base = await this.#ask(github, 'base', pull.repository, pull.number);
    if (base.kind === 'commit') {
      return { kind: 'commit', sha: base.sha, source: 'base', repository: pull.repository };
    }
    if (base.kind === 'other') return { kind: 'other' };
    const fork = this.#fork;
    if (!fork || fork.equals(pull.repository)) return { kind: 'none' };
    let there: OverviewRef;
    try {
      there = await this.#ask(github, 'fork', fork, pull.number);
    } catch (error) {
      // A fork GitHub no longer has, or the account can't see, holds no overview it can read.
      if (isGone(error)) return { kind: 'none' };
      throw error;
    }
    if (there.kind === 'commit') {
      return { kind: 'commit', sha: there.sha, source: 'fork', repository: fork };
    }
    return there.kind === 'other' ? { kind: 'other' } : { kind: 'none' };
  }

  /** The ref in `repository`, asked with the ETag of the last answer from there. */
  async #ask(
    github: Github,
    source: OverviewCommit['source'],
    repository: RepoRef,
    number: number,
  ): Promise<OverviewRef> {
    const key = `${source} ${repository.key}`;
    const heard = this.#heard.get(key);
    const answer = await github((client) =>
      watchOverviewRef(client, repository, number, heard?.etag),
    );
    if (answer.notModified) {
      if (!heard) throw new Error('GitHub said nothing changed, with nothing asked before.');
      // A `304` doesn't say again how long to wait: the answer it stands for did.
      const asked = answer.pollInterval ?? heard.pollInterval;
      this.#asking = Math.max(this.#asking, (asked ?? 0) * 1000);
      return heard.ref;
    }
    const { pollInterval } = answer;
    this.#asking = Math.max(this.#asking, (pollInterval ?? 0) * 1000);
    if (answer.etag === undefined) this.#heard.delete(key);
    else this.#heard.set(key, { etag: answer.etag, ref: answer.value, pollInterval });
    return answer.value;
  }

  /** Takes what the ref holds: a commit Lo hasn't seen is read whole, then shown or offered. */
  async #take(
    found: Found,
    github: Github,
    pull: { repository: RepoRef; number: number },
  ): Promise<void> {
    const { saved } = this.#options.reads;
    if (found.kind !== 'commit') {
      this.#found = found.kind === 'none' ? 'none' : 'notCommit';
      this.#newer = undefined;
      saved.forget(keyOf(pull));
      return;
    }
    this.#found = 'commit';
    const shown = this.#shown;
    if (shown?.id === found.sha && shown.source === found.source) {
      this.#saved = false;
      this.#newer = undefined;
      return;
    }
    if (this.#newer?.id === found.sha && this.#newer.source === found.source) return;
    const commit = await readOverview(
      github,
      this.#options.reads.blobs,
      found.repository,
      found.sha,
      found.source,
    );
    if (this.#closed) return;
    saved.set(keyOf(pull), commit);
    if (this.#shown) {
      this.#newer = commit;
    } else {
      this.#shown = commit;
      this.#saved = false;
    }
  }

  /** Reads the ref again after `wait`, while the tab is on screen. */
  #retryIn(wait: number): void {
    this.#stopTimer();
    if (!this.#onScreen || this.#closed) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#read();
    }, wait);
  }

  /**
   * Reads the ref again when it's next due, while the tab is on screen: 30 s after the last read,
   * or 5 minutes behind other windows, and never sooner than GitHub's `x-poll-interval` asked. A
   * public pull request read once isn't read again, and a failure waits as long as it said.
   */
  #schedule(): void {
    if (this.#reading || this.#closed) return;
    if (this.#problem !== undefined) {
      // A failure's retry is set already, unless the tab was hidden since.
      if (this.#timer === undefined) this.#retryIn(retryWait(Math.max(1, this.#failures)));
      return;
    }
    this.#stopTimer();
    if (!this.#canRead()) return;
    const every = Math.max(this.#foreground ? FOREGROUND_EVERY : BACKGROUND_EVERY, this.#floor);
    const due = this.#readAt === undefined ? 0 : this.#readAt + every - this.#now();
    this.#timer = setTimeout(
      () => {
        this.#timer = undefined;
        this.#read();
      },
      Math.max(0, due),
    );
  }

  #stopTimer(): void {
    clearTimeout(this.#timer);
    this.#timer = undefined;
  }

  #publish(): void {
    if (this.#closed) return;
    const state = this.state();
    const said = JSON.stringify(state);
    if (said === this.#said) return;
    this.#said = said;
    this.#options.publish(state);
  }
}

/** A pull request, as what's kept of its overview is keyed. */
function keyOf(pull: { repository: RepoRef; number: number }): {
  repository: string;
  number: number;
} {
  return { repository: pull.repository.toString(), number: pull.number };
}

function sameFork(a: RepoRef | null | undefined, b: RepoRef | null | undefined): boolean {
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  return a.equals(b);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
