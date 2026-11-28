// A pull request's tab's overview in main: the ref `refs/lo/pr/<n>`, read in the pull request's
// repository, then in its fork, then, for a pull request from a fork, the copy the repository keeps
// of the fork's (`refs/lo/kept/pr/<n>`), through GitHub's REST API as the tab's account, with each
// answer's ETag, so a read that finds nothing changed costs nothing. It's read as the tab is shown
// and as Lo comes back on screen (once in 30 s at most), and again every 30 s while the tab is on
// screen and Lo is, in front or behind another window (every 5 minutes while Lo is off screen),
// never sooner than GitHub's `x-poll-interval` asks; a public pull request opened without an
// account is read once. A commit Lo hasn't seen is read whole before it's offered, and a newer one
// never takes the place of the one on screen until it's loaded. What was read is kept, so the
// overview shows at once the next time, offline too; and once none of them holds one, what was
// kept stays on screen, a saved copy, as it does the next time. A closed or merged pull request's
// is never forgotten to make room. A stack's overview, `refs/lo/stack/<id>`, is read the same way,
// beside its layer's.
//
// The tab opens on its overview when it has one to show, deciding within a bound, so what that
// waits for goes first: as the tab is shown, the ref is read at once, in the pull request's own
// repository before the tab knows where its head is, ahead of the account's polls and other
// background reads. The reads that wait on each other (the ref, the commit's listing, its text, the
// first figures the text names and its byline) take one turn in the account's queue, so nothing
// else goes between them, and nothing in that turn waits on a read queued behind it. The overview
// is sent to the window once its text is read; its first figures come next, for the window's
// first frame, and its byline after them. A byline that fails is read again by itself, after a
// wait that grows with each failure, and never counts as the ref's failure. Nothing here calls
// Electron.

import { ARTIFACT, namedFigures } from '@lo/artifact';
import {
  keptOverviewRef,
  keptStackOverviewRef,
  overviewRef,
  RepoRef,
  saidBy,
  stackOverviewRef,
  watchRef,
  type GithubClient,
  type OverviewRef,
  type ReadPriority,
  type ReadPriorityNow,
} from '@lo/github';

import { IpcError } from '../../../ipc/contract.ts';
import type { Acting } from '../../tab/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import {
  FIRST_FIGURES,
  type Byline,
  type CodeAccess,
  type CodeReply,
  type OverviewCommit,
  type OverviewFile,
  type OverviewState,
  type Problem,
} from '../contract.ts';
import { entryAt, isReadable } from './listing.ts';
import type { Blobs } from './blobs.ts';
import { codeAccess, CodeReading } from './code.ts';
import { fetchBlob, isGone, readByline, readOverview, sizeOnly, type Github } from './fetch.ts';
import { problemOf, retryWait } from './problems.ts';
import type { PullKey, SavedRefs } from './saved.ts';
import { SinceReads } from './since.ts';
import { BlockTexts } from './texts.ts';

/**
 * How often the ref is read while the tab is on screen and Lo is, in front or behind another
 * window, in milliseconds.
 */
export const FOREGROUND_EVERY = 30_000;
/** How often while Lo is off screen: minimized, hidden or behind a locked screen. */
export const BACKGROUND_EVERY = 5 * 60_000;

/** What a tab's overview reads with. */
export interface OverviewReads {
  /**
   * Runs `request` with GitHub's client for `acting`, in its turn: ahead of background reads while
   * it's a `foreground` one.
   */
  github<T>(
    acting: Acting,
    request: (client: GithubClient) => Promise<T>,
    priority?: ReadPriorityNow,
  ): Promise<T>;
  readonly blobs: Blobs;
  readonly saved: SavedRefs;
}

/**
 * What a tab's overview is of: its pull request, or, `id`, the stack it's a layer of, whose
 * overview is on `refs/lo/stack/<id>` and read the same way, beside the pull request's.
 */
export type OverviewSubject = { kind: 'pull' } | { kind: 'stack'; id: number };

export interface OverviewTabOptions {
  readonly id: string;
  /** What the overview is of: the pull request unless said. */
  readonly subject?: OverviewSubject | undefined;
  readonly reads: OverviewReads;
  /** Sends the overview to the window, each time it changes. */
  readonly publish: (state: OverviewState) => void;
  readonly log: (line: string) => void;
  /** The time now, in milliseconds since the Unix epoch. */
  readonly now?: (() => number) | undefined;
  /**
   * Called after each read of the ref that went through while there's an overview to show, for
   * what's read with it, after it, such as the repository's definitions: in a turn as `priority`
   * says, and `shown` when the tab was just shown, or Retry pressed.
   */
  readonly onRead?: ((priority: ReadPriorityNow, shown: boolean) => void) | undefined;
  /** Called after each read of the ref that failed, with why, for what's read with the overview. */
  readonly onFailed?: ((problem: Problem) => void) | undefined;
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

/** What the ref holds, in the repository, its fork or the repository's copy of the fork's. */
type Found =
  | { kind: 'none' }
  | { kind: 'other' }
  | { kind: 'commit'; sha: string; source: OverviewCommit['source']; repository: RepoRef };

export class OverviewTab {
  readonly id: string;
  readonly subject: OverviewSubject;
  readonly #options: OverviewTabOptions;
  readonly #now: () => number;
  /** The pull request, once the tab knows its repository. */
  #pull: { repository: RepoRef; number: number } | undefined;
  #acting: Acting | undefined;
  /** The fork the head is in, `null` for none, once the tab knows. */
  #fork: RepoRef | null | undefined;
  /** Whether the head is in a fork, one GitHub no longer has included, once the tab knows. */
  #forked = false;
  /** Whether the pull request is closed or merged, once the tab knows. */
  #ended: boolean | undefined;
  #onScreen = false;
  #foreground = false;
  #found: OverviewState['found'] = 'unknown';
  #shown: OverviewCommit | undefined;
  #newer: OverviewCommit | undefined;
  /** Whether the overview on screen is what was kept, and GitHub hasn't said since it's there. */
  #saved = false;
  #problem: Problem | undefined;
  /** Whether the code the overview names can be read, by the tab's local copy. */
  #code: CodeAccess = 'waiting';
  #failures = 0;
  /** Each repository's last answer, by its source and name. */
  readonly #heard = new Map<string, Heard>();
  /** The read under way. */
  #reading: Promise<void> | undefined;
  /** Whether to read again once the one under way is done. */
  #again = false;
  /**
   * Whether someone waits on the next read to go through, so it goes ahead of background reads:
   * the tab was just shown, or Retry was pressed.
   */
  #awaited = false;
  /** What waits for the tab to know where its head is, which tells the fork to look in. */
  #headWaiters: (() => void)[] = [];
  /** What waits for the tab to know who it acts as, to read a file it didn't keep. */
  #actingWaiters: (() => void)[] = [];
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
  /** How many times in a row the byline failed to come, and when it's read again. */
  #bylineFailures = 0;
  #bylineTimer: ReturnType<typeof setTimeout> | undefined;
  #closed = false;
  #said: string | undefined;
  /** The read of the overview's code under way, which closing the tab stops. */
  readonly #codeRead = new CodeReading();
  /** The files the overview's blocks show, read until the tab closes. */
  readonly blocks: BlockTexts;
  /** What changed since the overview's commit, read until the tab closes. */
  readonly since: SinceReads;

  constructor(options: OverviewTabOptions) {
    this.#options = options;
    this.id = options.id;
    this.subject = options.subject ?? { kind: 'pull' };
    this.#now = options.now ?? Date.now;
    this.blocks = new BlockTexts({ log: options.log });
    this.since = new SinceReads({ log: options.log });
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
      this.#ended = undefined;
      this.#takeSaved();
      moved = pull !== undefined;
    }
    this.#acting = info.acting;
    if (info.acting) for (const resolve of this.#actingWaiters.splice(0)) resolve();
    const code = codeAccess(info.local);
    const access = code !== this.#code;
    this.#code = code;
    const fork = info.head?.fork;
    const forkNow =
      info.head === undefined ? undefined : fork ? new RepoRef(fork.owner, fork.name) : null;
    const forked = info.head?.forked ?? false;
    if (!sameFork(this.#fork, forkNow) || forked !== this.#forked) {
      moved ||= this.#fork !== undefined;
      this.#fork = forkNow;
      this.#forked = forked;
      if (forkNow !== undefined) this.#headKnown();
    }
    this.#follow(info.state);
    const shown = onScreen && !this.#onScreen;
    if (shown) this.#awaited = true;
    this.#onScreen = onScreen;
    this.#foreground = foreground;
    if (!onScreen) this.#stopTimer();
    else if (shown || moved) this.#read();
    else this.#schedule();
    // The tab changes often, as its local copy is fetched: only what this says is sent.
    if (pull === undefined || moved || access || said !== info.acting?.kind) this.#publish();
  }

  /**
   * Lo came back on screen, which reads the ref at once if it hasn't been read in the last 30 s, so
   * a new overview shows promptly, unless GitHub asked Lo to wait for the rate limit; or it went off
   * screen. Coming back often reads no more often than that.
   */
  setForeground(foreground: boolean): void {
    if (this.#closed || foreground === this.#foreground) return;
    this.#foreground = foreground;
    const readAt = this.#readAt;
    const stale = readAt === undefined || this.#now() - readAt >= FOREGROUND_EVERY;
    if (foreground && stale && this.#onScreen && this.#problem?.kind !== 'rateLimited') {
      this.#read();
    } else {
      this.#schedule();
    }
  }

  /**
   * Reads the ref again now, after a failure or where it's read once, and settles once that read is
   * done, however it went, so what asked for it can say it's looking until then.
   */
  async retry(): Promise<void> {
    if (this.#closed) return;
    this.#failures = 0;
    // Asked to, a pull request read once without an account is read again.
    this.#readOnce = false;
    this.#awaited = true;
    this.#read();
    // A read already under way reads again once it's done: settled once neither is left.
    while (this.#reading) await this.#reading.catch(() => undefined);
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
    const pull = this.#pull;
    return {
      id: this.id,
      ref: pull === undefined ? '' : this.#ref(pull),
      watching: this.#acting?.kind === 'account',
      found: this.#found,
      overview: this.#shown ?? null,
      newer: this.#newer ?? null,
      saved: this.#saved,
      problem: this.#problem ?? null,
      code: this.#code,
    };
  }

  /** Whether `commit` is the overview on screen, or the newer one. */
  holds(commit: string): boolean {
    return this.#shown?.id === commit || this.#newer?.id === commit;
  }

  /**
   * Files of overview commit `commit`, the one on screen or the newer one, by their paths, in the
   * order asked: kept ones at once, the rest raw from GitHub, each once it hashes to its ID, as the
   * tab acts once it knows who that is. Only `artifact.md` and figures are ever read, only of a
   * commit whose text was read, and a file too large for any reader to want its bytes comes with its
   * size alone. A file asked for twice is read once, and both answers are the same.
   */
  async files(commit: string, paths: readonly string[]): Promise<OverviewFile[]> {
    const overview = [this.#shown, this.#newer].find((each) => each?.id === commit);
    if (!overview) {
      throw new IpcError('moved', 'That isn’t the overview on screen, or the newer one.');
    }
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
        answer = await this.#file(repository, entry.id, entry.size);
        read.set(entry.id, answer);
      }
      answers.push(answer);
    }
    return answers;
  }

  /**
   * The file `id` names, of `size` bytes, in `repository`, as `files` answers: as it was kept, or
   * read as the tab acts, once it knows who that is.
   */
  async #file(repository: RepoRef, id: string, size: number | null): Promise<OverviewFile> {
    // GitHub's listing gave no size, and said nothing of why.
    if (size === null) return { kind: 'unread', why: '' };
    if (sizeOnly(size)) return { kind: 'file', size, bytes: null };
    const { blobs } = this.#options.reads;
    // What was kept needs no account: a tab opened again shows the overview it kept at once,
    // before it has worked out who it acts as.
    const kept = blobs.get(id);
    if (kept) return { kind: 'file', size: kept.length, bytes: kept };
    const acting = await this.#actingKnown();
    // What the window draws on screen, as the overview's figures fill in, while it's on screen.
    const priority = (): ReadPriority => (this.#onScreen ? 'foreground' : 'background');
    const github: Github = (request) => this.#options.reads.github(acting, request, priority);
    try {
      const bytes = await fetchBlob(github, acting, blobs, repository, id);
      return { kind: 'file', size: bytes.length, bytes };
    } catch (error) {
      this.#options.log(`reading file ${id} of the overview: ${describe(error)}`);
      return { kind: 'unread', why: saidBy(error) };
    }
  }

  /** Who the tab acts as, once it knows: refused if the tab closes first. */
  async #actingKnown(): Promise<Acting> {
    while (!this.#closed) {
      const acting = this.#acting;
      if (acting) return acting;
      await new Promise<void>((resolve) => this.#actingWaiters.push(resolve));
    }
    throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
  }

  /** Stops everything, as the tab closes or Lo quits. */
  close(): void {
    this.#closed = true;
    this.#headKnown();
    for (const resolve of this.#actingWaiters.splice(0)) resolve();
    this.#stopTimer();
    clearTimeout(this.#bylineTimer);
    this.#codeRead.stop();
    this.blocks.stop();
    this.since.stop();
  }

  /**
   * Reads the overview's code with `read`, asked for as `key` says: one read at a time, as
   * {@link CodeReading} runs them, until the tab closes.
   */
  readCode(key: string, read: (signal: AbortSignal) => Promise<CodeReply>): Promise<CodeReply> {
    if (this.#closed) throw new IpcError('missing', 'There’s no pull request’s tab with that id.');
    return this.#codeRead.run(key, read);
  }

  /**
   * Follows whether the pull request is closed or merged, `state`, which keeps what's kept of its
   * overview from being forgotten to make room, until it's open again.
   */
  #follow(state: PullTabInfo['state']): void {
    const pull = this.#pull;
    // A stack isn't closed: what's kept of its overview can go to make room.
    if (state === undefined || !pull || this.subject.kind === 'stack') return;
    const ended = state === 'merged' || state === 'closed';
    if (ended === this.#ended) return;
    this.#ended = ended;
    try {
      this.#options.reads.saved.close(this.#key(pull), ended);
    } catch (error) {
      this.#options.log(`keeping the overview of a closed pull request: ${describe(error)}`);
    }
  }

  /** What was kept of the pull request's overview, on screen at once if nothing is yet. */
  #takeSaved(): void {
    const pull = this.#pull;
    if (!pull || this.#shown) return;
    let kept: OverviewCommit | undefined;
    try {
      kept = this.#options.reads.saved.get(this.#key(pull));
    } catch (error) {
      this.#options.log(`reading what was kept of the overview: ${describe(error)}`);
    }
    if (kept) {
      this.#shown = kept;
      this.#saved = true;
    }
  }

  /**
   * Whether the ref is read now: the tab is on screen, and knows who it acts as. Where its head is
   * matters only once the pull request's repository holds no overview.
   */
  #canRead(): boolean {
    if (this.#closed || !this.#onScreen || !this.#pull || !this.#acting) return false;
    return this.#acting.kind === 'account' || !this.#readOnce;
  }

  /** Settles once the tab knows where its head is, or closes. */
  #headKnowable(): Promise<void> {
    if (this.#fork !== undefined || this.#closed) return Promise.resolve();
    return new Promise((resolve) => this.#headWaiters.push(resolve));
  }

  /** The tab knows where its head is, or closed: what waited for it goes on. */
  #headKnown(): void {
    for (const resolve of this.#headWaiters.splice(0)) resolve();
  }

  /** Reads the ref now, or once the read under way is done. */
  #read(): void {
    this.#stopTimer();
    if (!this.#canRead()) return;
    if (this.#reading) {
      this.#again = true;
      return;
    }
    // Waited on while the tab is on screen. Shown again, or Retry pressed, while this read is under
    // way: the next goes ahead too.
    const awaited = this.#awaited;
    this.#awaited = false;
    const priority = (): ReadPriority => (awaited && this.#onScreen ? 'foreground' : 'background');
    this.#reading = this.#readNow(priority).then((through) => {
      this.#reading = undefined;
      // What's read with the overview needs one to show, and GitHub within reach.
      const shows = this.#shown !== undefined || this.#newer !== undefined;
      if (through && shows && !this.#closed) this.#options.onRead?.(priority, awaited);
      const problem = this.#problem;
      if (!through && problem && !this.#closed) this.#options.onFailed?.(problem);
      if (this.#again) {
        this.#again = false;
        this.#read();
      } else {
        this.#schedule();
      }
      this.#publish();
    });
  }

  /** Reads the ref, and what it holds, and says whether that went through. */
  async #readNow(priority: ReadPriorityNow): Promise<boolean> {
    const pull = this.#pull;
    const acting = this.#acting;
    if (!pull || !acting) return false;
    // Each read waits on the one before, so they go in one turn in the account's queue.
    const inTurn = (work: (github: Github) => Promise<boolean>) =>
      this.#options.reads.github(acting, (client) => work((request) => request(client)), priority);
    this.#asking = 0;
    try {
      if (!(await inTurn((github) => this.#readRef(github, acting, pull, true)))) {
        // The fork is for the tab's head to say, which the tab reads in the same queue: it's
        // waited for between turns, never in one.
        await this.#headKnowable();
        if (this.#closed) return false;
        await inTurn((github) => this.#readRef(github, acting, pull, false));
      }
      if (this.#closed) return false;
      this.#failures = 0;
      this.#problem = undefined;
      this.#readAt = this.#now();
      this.#floor = this.#asking;
      if (acting.kind === 'anonymous') this.#readOnce = true;
      return true;
    } catch (error) {
      if (this.#closed) return false;
      this.#failures += 1;
      const { owner } = pull.repository;
      const { problem, wait } = problemOf(error, acting, this.#failures, this.#now(), owner);
      this.#problem = problem;
      this.#options.log(`reading ${this.#ref(pull)}: ${describe(error)}`);
      this.#retryIn(wait);
      return false;
    }
  }

  /**
   * Reads the ref, in the pull request's repository unless `base` is false, then in its fork, and
   * takes what it holds. Says whether it did: not when what it holds is for the fork to say, and
   * the tab doesn't know where its head is yet.
   */
  async #readRef(
    github: Github,
    acting: Acting,
    pull: { repository: RepoRef; number: number },
    base: boolean,
  ): Promise<boolean> {
    const found = await this.#find(github, pull, base);
    if (found === undefined) return false;
    if (!this.#closed) await this.#take(found, github, acting, pull);
    return true;
  }

  /**
   * What the ref holds: in the pull request's repository, unless `base` is false, else in its fork;
   * nothing yet when that's for the fork to say, and the tab doesn't know where its head is.
   */
  async #find(
    github: Github,
    pull: { repository: RepoRef; number: number },
    base: boolean,
  ): Promise<Found | undefined> {
    if (base) {
      const there = await this.#ask(github, 'base', pull.repository, this.#ref(pull));
      if (there.kind === 'commit') {
        return { kind: 'commit', sha: there.sha, source: 'base', repository: pull.repository };
      }
      if (there.kind === 'other') return { kind: 'other' };
    }
    const fork = this.#fork;
    if (fork === undefined) return undefined;
    if (fork && !fork.equals(pull.repository)) {
      let there: OverviewRef;
      try {
        there = await this.#ask(github, 'fork', fork, this.#ref(pull));
      } catch (error) {
        // A fork GitHub no longer has, or the account can't see, holds no overview it can read.
        if (!isGone(error)) throw error;
        there = { kind: 'none' };
      }
      if (there.kind === 'commit') {
        return { kind: 'commit', sha: there.sha, source: 'fork', repository: fork };
      }
      if (there.kind === 'other') return { kind: 'other' };
    }
    // Only a fork's pull request has a copy, kept by the overview workflow, a gone fork's too.
    if (!this.#forked) return { kind: 'none' };
    const kept = await this.#ask(github, 'kept', pull.repository, this.#keptRef(pull));
    if (kept.kind === 'commit') {
      return { kind: 'commit', sha: kept.sha, source: 'kept', repository: pull.repository };
    }
    return kept.kind === 'other' ? { kind: 'other' } : { kind: 'none' };
  }

  /** `ref` in `repository`, asked with the ETag of the last answer from there. */
  async #ask(
    github: Github,
    source: OverviewCommit['source'],
    repository: RepoRef,
    ref: string,
  ): Promise<OverviewRef> {
    const key = `${source} ${repository.key}`;
    const heard = this.#heard.get(key);
    const answer = await github((client) => watchRef(client, repository, ref, heard?.etag));
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

  /**
   * Takes what the ref holds: a commit Lo hasn't seen is read whole, then offered; or, with nothing
   * on screen yet, shown and kept once its text is read, and its byline read after.
   */
  async #take(
    found: Found,
    github: Github,
    acting: Acting,
    pull: { repository: RepoRef; number: number },
  ): Promise<void> {
    const { saved } = this.#options.reads;
    if (found.kind !== 'commit') {
      this.#found = found.kind === 'none' ? 'none' : 'notCommit';
      this.#newer = undefined;
      this.#keepCopy(pull);
      return;
    }
    this.#found = 'commit';
    const shown = this.#moved(this.#shown, found, pull);
    if (shown) {
      this.#shown = shown;
      this.#saved = false;
      this.#newer = undefined;
      // One shown before its byline came, which failed to: read it again.
      if (shown.byline === null) await this.#readByline(shown, github, pull);
      return;
    }
    const newer = this.#moved(this.#newer, found, pull);
    if (newer) {
      this.#newer = newer;
      if (newer.byline === null) await this.#readByline(newer, github, pull);
      return;
    }
    const listed = await readOverview(
      github,
      acting,
      this.#options.reads.blobs,
      found.repository,
      found.sha,
      found.source,
    );
    if (this.#closed) return;
    saved.set(this.#key(pull), listed, this.#ended);
    if (this.#shown) {
      // A newer commit is offered once read, with its byline when that comes.
      this.#newer = listed;
      await this.#readByline(listed, github, pull);
      return;
    }
    // The window checks it while its first figures and its byline come.
    this.#shown = listed;
    this.#saved = false;
    this.#publish();
    await this.#readFirstFigures(listed, github, acting);
    if (!this.#closed) await this.#readByline(listed, github, pull);
  }

  /**
   * `commit`, the overview on screen or the newer one, if it's the commit `found` names: as it is,
   * or, found elsewhere now, as the fork's overview found in the repository's copy once the fork
   * is gone, from there, kept so, with nothing offered in its place, since it's the same overview.
   */
  #moved(
    commit: OverviewCommit | undefined,
    found: Extract<Found, { kind: 'commit' }>,
    pull: { repository: RepoRef; number: number },
  ): OverviewCommit | undefined {
    if (commit?.id !== found.sha) return undefined;
    const there = new RepoRef(commit.repository.owner, commit.repository.name);
    if (commit.source === found.source && there.equals(found.repository)) return commit;
    const moved: OverviewCommit = {
      ...commit,
      source: found.source,
      repository: { owner: found.repository.owner, name: found.repository.name },
    };
    this.#options.reads.saved.set(this.#key(pull), moved, this.#ended);
    return moved;
  }

  /**
   * None of the places the overview is read from holds one: what's on screen stays, a saved copy,
   * and so does what was kept of it, unless its text is no longer kept, which leaves nothing to
   * show again.
   */
  #keepCopy(pull: { repository: RepoRef; number: number }): void {
    const { saved, blobs } = this.#options.reads;
    const shown = this.#shown;
    const text = shown?.read ? entryAt(shown.entries, ARTIFACT) : undefined;
    if (shown && (!shown.read || (text !== undefined && blobs.has(text.id)))) return;
    if (shown) {
      this.#shown = undefined;
      this.#saved = false;
    }
    saved.forget(this.#key(pull));
  }

  /**
   * Reads the first figures `commit`'s text names, which a first screen may show, into the store,
   * so the window's first frame has them: in the turn held, never waiting on a read behind it. One
   * that fails is left for the window to ask for.
   */
  async #readFirstFigures(commit: OverviewCommit, github: Github, acting: Acting): Promise<void> {
    const { blobs } = this.#options.reads;
    const text = commit.read ? entryAt(commit.entries, ARTIFACT) : undefined;
    const bytes = text?.kind === 'file' ? blobs.get(text.id) : undefined;
    if (!bytes) return;
    const repository = new RepoRef(commit.repository.owner, commit.repository.name);
    for (const path of namedFigures(new TextDecoder().decode(bytes), FIRST_FIGURES)) {
      const entry = isReadable(path) ? entryAt(commit.entries, path) : undefined;
      if (entry?.kind !== 'file' || entry.size === null || sizeOnly(entry.size)) continue;
      try {
        await fetchBlob(github, acting, blobs, repository, entry.id, true);
      } catch (error) {
        this.#options.log(`reading ${path} of the overview: ${describe(error)}`);
      }
      if (this.#closed) return;
    }
  }

  /**
   * Reads the byline of `commit`, the overview on screen or the newer one, read without it, and
   * keeps the commit with it. One that fails is read again by itself, and with the ref: it's no
   * failure of the ref's, and the overview shows the same without it.
   */
  async #readByline(
    commit: OverviewCommit,
    github: Github,
    pull: { repository: RepoRef; number: number },
  ): Promise<void> {
    const repository = new RepoRef(commit.repository.owner, commit.repository.name);
    let byline: Byline;
    try {
      byline = await readByline(github, repository, commit.id);
    } catch (error) {
      this.#options.log(`reading who wrote overview ${commit.id}: ${describe(error)}`);
      this.#bylineFailures += 1;
      this.#retryByline();
      return;
    }
    this.#bylineFailures = 0;
    if (this.#closed) return;
    const read = { ...commit, byline };
    // Another overview took its place meanwhile, kept as it was read.
    if (this.#shown === commit) this.#shown = read;
    else if (this.#newer === commit) this.#newer = read;
    else return;
    this.#options.reads.saved.set(this.#key(pull), read, this.#ended);
  }

  /**
   * Reads the byline of the overview on screen again by itself, as a public pull request's tab,
   * which reads the ref once, needs: after a wait that grows with each failure, once the tab is on
   * screen.
   */
  #retryByline(): void {
    clearTimeout(this.#bylineTimer);
    this.#bylineTimer = setTimeout(() => {
      this.#bylineTimer = undefined;
      const [commit, acting, pull] = [this.#shown, this.#acting, this.#pull];
      if (this.#closed || !commit || commit.byline !== null || !acting || !pull) return;
      // Hidden, it waits for the tab to be shown.
      if (!this.#onScreen) {
        this.#retryByline();
        return;
      }
      void this.#options.reads
        .github(acting, (client) => this.#readByline(commit, (request) => request(client), pull))
        .then(() => this.#publish());
    }, retryWait(this.#bylineFailures));
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
   * or 5 minutes while Lo is off screen, and never sooner than GitHub's `x-poll-interval` asked. A
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

  /** The ref the overview is on: the pull request's, or its stack's. */
  #ref(pull: { number: number }): string {
    return this.subject.kind === 'pull'
      ? overviewRef(pull.number)
      : stackOverviewRef(this.subject.id);
  }

  /** The ref the repository keeps its copy of a fork's on. */
  #keptRef(pull: { number: number }): string {
    return this.subject.kind === 'pull'
      ? keptOverviewRef(pull.number)
      : keptStackOverviewRef(this.subject.id);
  }

  /** What's kept of the overview is keyed by: its repository, and its pull request or stack. */
  #key(pull: { repository: RepoRef; number: number }): PullKey {
    const number = this.subject.kind === 'pull' ? pull.number : this.subject.id;
    return { repository: pull.repository.toString(), number };
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

function sameFork(a: RepoRef | null | undefined, b: RepoRef | null | undefined): boolean {
  if (a === undefined || b === undefined || a === null || b === null) return a === b;
  return a.equals(b);
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
