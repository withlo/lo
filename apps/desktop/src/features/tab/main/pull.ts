// A pull request's tab in main: which account it acts as, what GitHub says of the pull request, how
// that stands, and its local copy. The account's poller watches the pull request from the moment
// the tab knows its account, so the strip has its title; the rest starts the first time the tab is
// shown. What's on screen stays on the head the tab opened at until the newer push is loaded.
// Nothing here calls Electron.

import { type PullRequestRefs, parseOid } from '@lo/git';
import {
  decideAccount,
  GithubError,
  PullRef,
  RepoRef,
  type Poller,
  type PollEvent,
  type PullRequest,
  type PullSummary,
} from '@lo/github';

import type { LocalGit } from '../../../main/git.ts';
import type { GithubAccess } from '../../accounts/service.ts';
import type {
  Acting,
  Connection,
  Files,
  Header,
  Local,
  LocalState,
  Problem,
  PullState,
  PullView,
} from '../contract.ts';
import { LocalCopy, retryWait } from './local.ts';
import {
  connectionOf,
  filesFromDetails,
  headerFromDetails,
  headerFromOpened,
  isUnreached,
  problemOf,
  rateLimitedUntil,
  readPull,
  withSummary,
  type Opened,
} from './reads.ts';

/** The parts of GitHub a pull request's tab uses. */
export type TabGithub = Pick<
  GithubAccess,
  'anonymous' | 'accounts' | 'client' | 'poller' | 'accountForRepo' | 'rememberAccountForOwner'
>;

/** What a tab keeps of its pull request, with the tab, so the strip and the next start have it. */
export interface Kept {
  readonly title?: string | undefined;
  readonly state?: PullState | undefined;
  /** The account it acts as, or `null` once it should be worked out again. */
  readonly login?: string | null | undefined;
  /** The repository by the name GitHub gives it now: `owner/name`. */
  readonly repository?: string | undefined;
}

/** Where a pull request's tab sends what changed: to the window, on the feature's topics. */
export interface TabPublish {
  pull(view: PullView): void;
  files(files: Files): void;
  local(local: Local): void;
}

export interface PullTabOptions {
  readonly id: string;
  /** The pull request as the tab was opened on it. */
  readonly link: { readonly owner: string; readonly repo: string; readonly number: number };
  /** The account the tab acted as when Lo last ran, if any. */
  readonly login?: string | undefined;
  /** The repository's name as GitHub last gave it, if known. */
  readonly repository?: string | undefined;
  readonly github: TabGithub;
  readonly git: LocalGit;
  readonly publish: TabPublish;
  /** Keeps what changed of the pull request with the tab. */
  readonly keep: (kept: Kept) => void;
  readonly log: (line: string) => void;
}

/** What a pull request's tab sends the window when it asks. */
export interface Snapshot {
  pull: PullView;
  files: Files | undefined;
  local: Local;
}

export class PullTab {
  readonly id: string;
  readonly pull: PullRef;
  readonly #options: PullTabOptions;
  #acting: Acting | undefined;
  #poller: Poller | undefined;
  readonly #unsubscribe: (() => void)[] = [];
  #header: Header | undefined;
  /** When GitHub last confirmed what the header shows, for "saved" while offline. */
  #savedAt: number | undefined;
  #problem: Problem | undefined;
  /** How the tab stands with GitHub while it acts as nobody, which no poller says. */
  #anonymousConnection: Connection = { kind: 'live' };
  /** The head on screen: GitHub's when the tab opened, until the newer push is loaded. */
  #shown: string | undefined;
  /** GitHub's newest head. */
  #latest: string | undefined;
  /** The base branch and its tip, as GitHub last said. */
  #base: { branch: string; sha: string } | undefined;
  #repository: RepoRef | undefined;
  #local: LocalCopy | undefined;
  #files: Files | undefined;
  /** Whether it has been shown, which starts reading it and its local copy. */
  #started = false;
  #active = false;
  #closed = false;
  /** The open under way: deciding the account, then reading the pull request. */
  #opening: Promise<void> | undefined;
  #readFailures = 0;
  #readTimer: ReturnType<typeof setTimeout> | undefined;
  /** What was last sent, so nothing is sent twice. */
  #saidPull: string | undefined;
  #saidFiles: string | undefined;
  #saidLocal: string | undefined;

  constructor(options: PullTabOptions) {
    this.#options = options;
    this.id = options.id;
    const { owner, repo, number } = options.link;
    this.pull = new PullRef(owner, repo, number);
    if (options.login !== undefined) this.#acting = { kind: 'account', login: options.login };
    if (options.repository !== undefined) this.#repository = RepoRef.parse(options.repository);
  }

  /**
   * Starts watching the pull request with the account the tab last acted as, so the strip gets its
   * title and state while the tab isn't shown. A tab that has no account yet waits to be shown.
   */
  async watch(): Promise<void> {
    const acting = this.#acting;
    if (acting?.kind !== 'account') return;
    try {
      await this.#attach(acting.login);
    } catch (error) {
      this.#options.log(`watching ${this.pull.toString()}: ${describe(error)}`);
    }
  }

  /** The tab is on screen: its poller polls it most often, and it opens if it hasn't. */
  show(): void {
    if (this.#closed) return;
    this.#active = true;
    if (!this.#started) {
      this.#started = true;
      void this.#open();
    } else if (this.#poller) {
      void this.#setOpen(this.#poller);
    }
    this.#publish();
  }

  /** Another tab is on screen. */
  hide(): void {
    this.#active = false;
    const poller = this.#poller;
    if (poller?.open?.equals(this.pull)) {
      poller.setOpen(undefined).catch((error: unknown) => this.#options.log(describe(error)));
    }
  }

  /** Tries again now: working out the account, reading the pull request, and its local copy. */
  retry(): void {
    if (this.#closed) return;
    this.#readFailures = 0;
    clearTimeout(this.#readTimer);
    this.#readTimer = undefined;
    this.#started = true;
    void this.#open();
    this.#local?.retry();
    // Asking the poller about it again polls it at once.
    const poller = this.#poller;
    if (poller && this.#active) {
      void poller
        .setOpen(undefined)
        .then(() => this.#setOpen(poller))
        .catch((error: unknown) => this.#options.log(describe(error)));
    }
  }

  /** Puts GitHub's newest head on screen, and the local copy at it. */
  reload(): void {
    const latest = this.#latest;
    if (this.#closed || latest === undefined || latest === this.#shown) return;
    this.#shown = latest;
    this.#local?.show(latest);
    this.#publish();
  }

  /**
   * Opens the tab as `login`, one of the accounts that can see its repository, and remembers it
   * for the repository's owner.
   */
  async choose(login: string): Promise<void> {
    if (this.#closed) return;
    await this.#options.github.rememberAccountForOwner(this.pull.repo.owner, login);
    this.#acting = { kind: 'account', login };
    this.#options.keep({ login });
    this.#problem = undefined;
    this.#started = true;
    await this.#open();
  }

  /** An account was removed: a tab acting as it works out its account again. */
  accountGone(login: string): void {
    const acting = this.#acting;
    if (acting?.kind !== 'account' || acting.login.toLowerCase() !== login.toLowerCase()) return;
    this.#detach();
    this.#acting = undefined;
    this.#options.keep({ login: null });
    this.#local?.close();
    this.#local = undefined;
    if (this.#started) void this.#open();
    this.#publish();
  }

  /** Git changed: Lo found it, or opened its cache. */
  gitChanged(): void {
    this.#local?.gitChanged();
    this.#publishLocal();
  }

  /** Stops everything the tab started, as it closes or Lo quits. */
  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#readTimer);
    this.#detach();
    this.#local?.close();
  }

  snapshot(): Snapshot {
    return {
      pull: this.#view(),
      files: this.#files,
      local: { id: this.id, state: this.#localState() },
    };
  }

  #open(): Promise<void> {
    this.#opening ??= this.#openNow().finally(() => {
      this.#opening = undefined;
      this.#publish();
    });
    return this.#opening;
  }

  async #openNow(): Promise<void> {
    this.#publish();
    if (this.#acting === undefined && !(await this.#decide())) return;
    const acting = this.#acting;
    if (this.#closed || acting === undefined) return;
    if (acting.kind === 'account') {
      try {
        const poller = await this.#attach(acting.login);
        if (this.#active) await this.#setOpen(poller);
      } catch (error) {
        // The account is gone: work it out again.
        this.#options.log(`opening ${this.pull.toString()} as ${acting.login}: ${describe(error)}`);
        this.#acting = undefined;
        this.#options.keep({ login: null });
        if (!(await this.#decide())) return;
      }
    }
    await this.#read();
  }

  /**
   * Works out which account the tab acts as, as opening a link does: the one that can see the
   * repository, else the one remembered for it, else nobody for a public repository, else asks.
   * Says why, and returns false, when it can't.
   */
  async #decide(): Promise<boolean> {
    const { github } = this.#options;
    try {
      const accounts = await github.accounts();
      const found = accounts.length === 0 ? undefined : await github.accountForRepo(this.pull.repo);
      if (this.#closed) return false;
      const decision = decideAccount(found);
      switch (decision.kind) {
        case 'open': {
          this.#acting = decision.acting;
          this.#problem = undefined;
          if (found) this.#learnRepository(found.repo);
          if (decision.acting.kind === 'account')
            this.#options.keep({ login: decision.acting.login });
          return true;
        }
        case 'ask':
          this.#problem = { kind: 'ask', logins: decision.logins };
          return false;
        case 'refuse': {
          const { refusal } = decision;
          const retryAt = refusal.waitable ? this.#scheduleRead() : undefined;
          this.#problem =
            refusal.links.length > 0
              ? { kind: 'blocked', message: refusal.message, links: refusal.links }
              : { kind: 'failed', message: refusal.message, retryAt: retryAt ?? null };
          return false;
        }
        default:
          decision satisfies never;
          throw new Error(`A decision Lo doesn't know: ${JSON.stringify(decision)}.`);
      }
    } catch (error) {
      // GitHub didn't answer, so which account can see the repository isn't known yet.
      const retryAt = this.#scheduleRead();
      this.#problem = {
        kind: 'failed',
        message: `Lo couldn't ask GitHub which account can open ${this.pull.toString()}: ${describe(error)}`,
        retryAt,
      };
      return false;
    } finally {
      this.#publish();
    }
  }

  /** Watches the pull request with `login`'s poller, from now on. */
  async #attach(login: string): Promise<Poller> {
    const current = this.#poller;
    if (current && current.login.toLowerCase() === login.toLowerCase()) return current;
    this.#detach();
    const poller = await this.#options.github.poller(login);
    if (this.#closed) throw new Error('the tab closed');
    this.#poller = poller;
    this.#unsubscribe.push(
      poller.onEvent((event) => this.#heard(event)),
      poller.onChange(() => this.#publish()),
    );
    await poller.watch(this.pull);
    const summary = poller.summary(this.pull);
    if (summary && this.#header === undefined) this.#takeSummary(summary);
    return poller;
  }

  #detach(): void {
    for (const unsubscribe of this.#unsubscribe.splice(0)) unsubscribe();
    const poller = this.#poller;
    this.#poller = undefined;
    if (poller) {
      if (poller.open?.equals(this.pull)) {
        poller.setOpen(undefined).catch((error: unknown) => this.#options.log(describe(error)));
      }
      poller.unwatch(this.pull);
    }
  }

  /** Makes the pull request `poller`'s open one, and takes what its cache has of it. */
  async #setOpen(poller: Poller): Promise<void> {
    const cached = await poller.setOpen(this.pull);
    if (this.#closed || poller !== this.#poller) return;
    if (cached && this.#savedAt === undefined) this.#takeDetails(cached.details, cached.fetchedAt);
    this.#publish();
  }

  /** Reads the pull request to open it: what its local copy is fetched by. */
  async #read(): Promise<void> {
    const acting = this.#acting;
    if (acting === undefined || this.#closed) return;
    const { github } = this.#options;
    try {
      let opened: Opened;
      if (acting.kind === 'account') {
        const client = await github.client(acting.login);
        const queue = this.#poller?.queue;
        opened = queue
          ? await queue.read(() => readPull(client, this.pull))
          : await readPull(client, this.pull);
      } else {
        opened = await readPull(github.anonymous, this.pull);
      }
      if (this.#closed) return;
      this.#readFailures = 0;
      this.#problem = undefined;
      this.#anonymousConnection = { kind: 'live' };
      this.#learnRepository(RepoRef.parse(opened.toOpen.base.repo.full_name));
      this.#header = headerFromOpened(opened);
      this.#savedAt = Date.now();
      this.#keepHeader();
      const { summary } = opened;
      this.#latest = summary.head.sha;
      this.#shown ??= summary.head.sha;
      this.#base = { branch: summary.base.ref, sha: summary.base.sha };
      this.#startLocal();
    } catch (error) {
      if (this.#closed) return;
      this.#readFailures += 1;
      const now = Date.now();
      const until = rateLimitedUntil(error, now);
      if (isUnreached(error)) {
        // Offline: what the poller kept shows, and the local copy reads what it fetched before.
        const retryAt = this.#scheduleRead();
        this.#problem = undefined;
        this.#anonymousConnection = {
          kind: 'offline',
          savedAt: null,
          retryAt,
          error: describe(error),
        };
        this.#startLocal();
      } else if (until !== undefined) {
        this.#scheduleRead(Math.max(0, until - now));
        this.#problem = undefined;
        this.#anonymousConnection = {
          kind: 'rateLimited',
          login: null,
          until: Math.round(until),
          secondary: false,
        };
        this.#startLocal();
      } else if (error instanceof GithubError && error.isUnauthorized()) {
        // The account is signed out, which its poller says.
        this.#problem = undefined;
      } else {
        const problem = problemOf(error, this.pull, this.#actingFor(acting), undefined);
        const retryAt = problem.kind === 'failed' ? this.#scheduleRead() : undefined;
        this.#problem =
          problem.kind === 'failed' ? { ...problem, retryAt: retryAt ?? null } : problem;
        this.#options.log(`reading ${this.pull.toString()}: ${describe(error)}`);
      }
    }
  }

  #actingFor(
    acting: Acting,
  ): { kind: 'account'; login: string } | { kind: 'anonymous'; canSignIn: boolean } {
    return acting.kind === 'account' ? acting : { kind: 'anonymous', canSignIn: true };
  }

  /** Reads the pull request again after a wait, 5 s doubling to 5 minutes. Returns when. */
  #scheduleRead(wait = retryWait(Math.max(1, this.#readFailures))): number {
    clearTimeout(this.#readTimer);
    this.#readTimer = setTimeout(() => {
      this.#readTimer = undefined;
      void this.#open();
    }, wait);
    return Math.round(Date.now() + wait);
  }

  #learnRepository(repo: RepoRef | undefined): void {
    if (!repo) return;
    if (this.#repository?.toString() !== repo.toString()) {
      this.#repository = repo;
      this.#options.keep({ repository: repo.toString() });
    }
  }

  #heard(event: PollEvent): void {
    if (this.#closed) return;
    switch (event.kind) {
      case 'summary':
        if (!event.pull.equals(this.pull)) return;
        this.#problem = undefined;
        this.#takeSummary(event.summary);
        break;
      case 'details':
        if (!event.pull.equals(this.pull)) return;
        this.#problem = undefined;
        this.#takeDetails(event.details, Date.now());
        break;
      case 'failed': {
        if (!(event.target instanceof PullRef) || !event.target.equals(this.pull)) return;
        const acting = this.#acting;
        if (acting === undefined) return;
        const problem = problemOf(
          new GithubError(event.error),
          this.pull,
          this.#actingFor(acting),
          undefined,
        );
        // Only what lasts: a pull request that's gone, or an organization that blocks the account.
        // Anything else the poller tries again at its next interval, and what's shown stays, since
        // no event says when a poll that changed nothing went well.
        if (problem.kind === 'failed') {
          this.#options.log(`polling ${this.pull.toString()}: ${problem.message}`);
          return;
        }
        this.#problem = problem;
        break;
      }
      case 'check':
      case 'openPullRequests':
      case 'trunkRules':
      case 'read':
      case 'confirmed':
      case 'readFailed':
        return;
      default:
        event satisfies never;
        return;
    }
    this.#publish();
  }

  #takeSummary(summary: PullSummary): void {
    this.#header = withSummary(this.#header, summary);
    this.#keepHeader();
    this.#latest = summary.head.sha;
    this.#base = { branch: summary.base.ref, sha: summary.base.sha };
    // Only once the tab is shown is the head on screen chosen, and the local copy fetched.
    if (this.#started) {
      this.#shown ??= summary.head.sha;
      this.#startLocal();
    }
  }

  #takeDetails(details: PullRequest, fetchedAt: number): void {
    this.#header = headerFromDetails(details);
    this.#savedAt = fetchedAt;
    this.#keepHeader();
    this.#latest = details.headRefOid;
    this.#shown ??= details.headRefOid;
    this.#base = { branch: details.baseRefName, sha: details.baseRefOid };
    const files = filesFromDetails(this.id, details);
    if (files) {
      this.#files = files;
      const said = JSON.stringify(files);
      if (said !== this.#saidFiles) {
        this.#saidFiles = said;
        this.#options.publish.files(files);
      }
    }
    this.#startLocal();
  }

  #keepHeader(): void {
    const header = this.#header;
    if (header) this.#options.keep({ title: header.title, state: header.state });
  }

  /**
   * Fetches the local copy at GitHub's newest head, keeping the head on screen, once the tab has
   * been shown and knows its repository, head and base.
   */
  #startLocal(): void {
    const repository = this.#repository;
    const base = this.#base;
    const latest = this.#latest;
    const shown = this.#shown;
    const acting = this.#acting;
    if (!this.#started || this.#closed) return;
    if (!repository || !base || latest === undefined || shown === undefined || !acting) return;
    let refs: PullRequestRefs;
    try {
      refs = {
        number: this.pull.number,
        head: parseOid(latest),
        baseBranch: base.branch,
        base: parseOid(base.sha),
      };
    } catch (error) {
      this.#options.log(`GitHub named a commit Lo can't use: ${describe(error)}`);
      return;
    }
    if (!this.#local) {
      const { github, git, log } = this.#options;
      const login = acting.kind === 'account' ? acting.login : undefined;
      this.#local = new LocalCopy({
        git,
        repository: { owner: repository.owner, name: repository.name },
        number: this.pull.number,
        // Read as each fetch starts, so a renewed token is the one git signs in with.
        token:
          login === undefined
            ? undefined
            : async () => (await github.client(login)).token?.expose(),
        changed: () => this.#publishLocal(),
        log,
      });
    }
    this.#local.want(refs);
    this.#local.show(shown);
  }

  #localState(): LocalState {
    if (this.#local) return this.#local.state;
    const { status } = this.#options.git;
    if (status !== undefined && status.status !== 'found') {
      return { kind: 'noGit', message: status.message, install: status.install };
    }
    return { kind: 'waiting' };
  }

  #connection(): Connection {
    const acting = this.#acting;
    const poller = this.#poller;
    if (acting?.kind === 'account' && poller) {
      return connectionOf(acting.login, poller.status(), this.#savedAt);
    }
    return this.#anonymousConnection;
  }

  #view(): PullView {
    const latest = this.#latest;
    const shown = this.#shown;
    return {
      id: this.id,
      loading:
        this.#opening !== undefined && this.#header === undefined && this.#problem === undefined,
      acting: this.#acting ?? null,
      header: this.#header ?? null,
      connection: this.#connection(),
      problem: this.#problem ?? null,
      shown: shown ?? null,
      newer: latest !== undefined && shown !== undefined && latest !== shown ? latest : null,
    };
  }

  #publish(): void {
    if (this.#closed) return;
    const view = this.#view();
    const said = JSON.stringify(view);
    if (said !== this.#saidPull) {
      this.#saidPull = said;
      this.#options.publish.pull(view);
    }
    this.#publishLocal();
  }

  #publishLocal(): void {
    if (this.#closed) return;
    const local = { id: this.id, state: this.#localState() };
    const said = JSON.stringify(local);
    if (said === this.#saidLocal) return;
    this.#saidLocal = said;
    this.#options.publish.local(local);
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
