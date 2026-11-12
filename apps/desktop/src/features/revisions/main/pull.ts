// A pull request's tab's revisions in main: built from GitHub's push history, as the account's
// poller keeps it, and the heads Lo's pollers saw; each head fetched into the local copy, so a
// revision GitHub no longer has, and Lo never fetched, shows as no longer available; and what the
// tab compares. When it opens, that's the more recent of two markers (the account's last review,
// and the newest revision on screen when it last left the pull request here) against the head on
// screen, or the whole pull request; then whatever the reader picks. A comparison of revisions is
// made in the local copy, across a rebase, once it has both. Once anything is drawn, what's
// compared changes only when the reader asks: a comparison the markers ask for that comes too late
// to be drawn first is offered instead. Nothing here calls Electron.

import { GitError, type Oid, parseOid, type Repo } from '@lo/git';
import {
  activityEntries,
  type Cached,
  GithubError,
  lastReview,
  PullRef,
  PUSH_HISTORY,
  type Poller,
  type PollEvent,
  type PushHistory,
  unavailableHeads,
} from '@lo/github';
import {
  baseHistory,
  baseTipAt,
  type BaseTip,
  buildRevisions,
  defaultComparison,
  type PushRecord,
  pushRecords,
  type Revision,
  Revisions,
} from '@lo/review';

import { IpcError } from '../../../ipc/contract.ts';
import type { PullTabInfo } from '../../tab/service.ts';
import type { Compared, ComparisonView, Replay, RevisionRow } from '../contract.ts';
import type { Comparing, OnScreen, Side } from '../service.ts';
import type { Marks } from './marks.ts';

/**
 * How long the diff waits, as a tab opens, for the comparison "last seen here" asks for, in
 * milliseconds: about as long as a large pull request's diff takes to load and draw anyway. Past
 * it, the whole pull request is drawn, and the comparison is offered, never put in its place.
 */
export const HOLD_LIMIT = 1_000;

/** What the revisions read of an account's poller: the push history it keeps, and its events. */
export interface HistoryPoller extends Pick<Poller, 'pushHistory' | 'onEvent'> {
  cachedRead(pull: PullRef, kind: typeof PUSH_HISTORY): Cached<PushHistory> | undefined;
}

export interface RevisionsTabOptions {
  readonly id: string;
  /** The poller of each account, as the accounts feature provides it. */
  readonly github: { poller(login: string): Promise<HistoryPoller> };
  /** The tab's local copy's clone, once it's opened. */
  readonly clone: () => Promise<Repo> | undefined;
  readonly marks: Marks;
  /** Sends the revisions to the window, each time they change. */
  readonly publish: (view: ComparisonView) => void;
  /** Says what the tab compares may have changed. */
  readonly changed: () => void;
  readonly log: (line: string) => void;
  readonly now?: (() => number) | undefined;
  /** How long the diff waits for the comparison "last seen here" asks for: {@link HOLD_LIMIT}. */
  readonly holdLimit?: number | undefined;
}

/** A comparison that's ready to show: what was asked, and its sides in the local copy. */
interface Ready {
  readonly chosen: Compared;
  readonly comparing: Comparing;
}

/** What's known of each revision's base, by head. */
interface BaseOf {
  readonly base: Oid;
  /** Whether the tip it was worked out from may be wrong. */
  readonly uncertain: boolean;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function same(a: Compared | undefined, b: Compared | undefined): boolean {
  return a?.from === b?.from && a?.to === b?.to;
}

export class RevisionsTab {
  readonly id: string;
  readonly #options: RevisionsTabOptions;
  #info: PullTabInfo | undefined;
  #pull: PullRef | undefined;
  #login: string | undefined;
  #poller: HistoryPoller | undefined;
  #unsubscribe: (() => void) | undefined;
  /** The push history the revisions are built from: one whose head is GitHub's newest. */
  #history: PushHistory | undefined;
  /** The newest push history read, kept until GitHub's newest head is its head. */
  #candidate: PushHistory | undefined;
  #status: ComparisonView['status'] = 'loading';
  #revisions: Revisions | undefined;
  /** Counts builds, so a build that finishes after a newer one started is dropped. */
  #build = 0;
  /** Whether the revisions were built with the pull request's commits from the local copy. */
  #withCommits = false;
  /** Heads GitHub no longer has, which the local copy lacks. */
  readonly #lost = new Set<string>();
  /** Heads the local copy has, as the last fetch of the revisions found. */
  readonly #present = new Set<string>();
  /** The revisions' heads, and their bases' tips, fetched into the local copy, by the heads. */
  #fetched: string | undefined;
  #fetching: Promise<void> | undefined;
  /** Each revision's base tip, and base, by head, once worked out. */
  readonly #tips = new Map<string, BaseTip>();
  readonly #bases = new Map<string, BaseOf>();
  /** "Last seen here", as it was when the tab first showed. */
  #lastSeen: string | undefined;
  /** The newest head the reader has seen in the tab, written as "last seen here" on leaving. */
  #seenNewest: string | undefined;
  /** The head on screen when the tab was last updated. */
  #shownBefore: string | undefined;
  #started = false;
  /** What to compare, when it isn't the whole pull request at the head on screen. */
  #chosen: Compared | undefined;
  /** Whether the reader has picked what to compare, which the default never replaces. */
  #picked = false;
  /** Whether the default comparison has been decided. */
  #defaulted = false;
  /**
   * Whether nothing should be drawn until the default comparison is ready. Only while it holds is
   * the default put on screen by itself: once anything may be drawn, it's offered instead.
   */
  #holding = false;
  /** A comparison the markers ask for, offered once it came too late to be drawn first. */
  #offered: Compared | undefined;
  #holdTimer: ReturnType<typeof setTimeout> | undefined;
  #ready: Ready | undefined;
  /** The comparison being made ready. */
  #preparing: Compared | undefined;
  #nothingNewSince: string | undefined;
  #replay: Replay | undefined;
  #conflicted = 0;
  #uncertain = false;
  #problem: string | undefined;
  #closed = false;
  #said: string | undefined;

  constructor(options: RevisionsTabOptions) {
    this.#options = options;
    this.id = options.id;
  }

  /** What the tab compares now, for the diff and the tree. */
  onScreen(): OnScreen {
    if (this.#ready) return { kind: 'revisions', comparing: this.#ready.comparing };
    if (this.#holding) {
      return { kind: 'waiting', why: this.#waitingWhy() };
    }
    return { kind: 'head' };
  }

  /** The revisions and what's compared, as the window gets them. */
  view(): ComparisonView {
    const info = this.#info;
    const shown = info?.shown;
    const history = this.#history;
    const revisions = this.#revisions;
    const local = info?.local;
    const onScreen =
      this.#ready?.chosen ??
      (this.#holding || shown === undefined ? undefined : { from: null, to: shown });
    const wanted = this.#chosen ?? (shown === undefined ? undefined : { from: null, to: shown });
    const review = history ? lastReview(history) : undefined;
    return {
      id: this.id,
      status: this.#status,
      revisions: revisions ? this.#rows(revisions, history) : [],
      base: history
        ? { branch: history.baseBranch, tip: local?.kind === 'ready' ? local.base : null }
        : null,
      markers: {
        review: review !== undefined && revisions?.find(review) ? review : null,
        lastSeen:
          this.#lastSeen !== undefined && revisions?.find(this.#lastSeen) ? this.#lastSeen : null,
      },
      shown: shown ?? null,
      comparison: onScreen ?? null,
      pending: wanted !== undefined && !same(wanted, onScreen) ? wanted : null,
      offered: this.#offered && !same(this.#offered, onScreen) ? this.#offered : null,
      waitingFor: local?.kind === 'noGit' ? 'git' : local?.kind === 'ready' ? null : 'local',
      nothingNewSince: this.#nothingNewSince ?? null,
      replay: this.#ready ? (this.#replay ?? null) : null,
      conflicted: this.#ready ? this.#conflicted : 0,
      uncertain: this.#ready ? this.#uncertain : false,
      problem: this.#problem ?? null,
    };
  }

  /** Follows the tab as it is now. */
  update(info: PullTabInfo): void {
    if (this.#closed) return;
    this.#info = info;
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    const login = info.acting?.kind === 'account' ? info.acting.login : undefined;
    if (this.#pull?.key !== pull.key || this.#login?.toLowerCase() !== login?.toLowerCase()) {
      this.#reset();
      this.#pull = pull;
      this.#login = login;
    }
    if (info.acting?.kind === 'anonymous') this.#status = 'signIn';
    if (login === undefined || info.shown === undefined) {
      this.#publish();
      return;
    }
    if (!this.#started) this.#start(pull, login, info.shown);
    const before = this.#shownBefore;
    if (before !== undefined && before !== info.shown) this.#shownMoved(before, info.shown);
    this.#shownBefore = info.shown;
    // A history kept until GitHub's newest head was its own may be the one now.
    if (this.#candidate && this.#candidate !== this.#history) this.#takeHistory(this.#candidate);
    if (info.local.kind === 'ready' && this.#revisions && !this.#withCommits) {
      void this.#rebuild();
    }
    this.#advance();
    this.#publish();
  }

  /** Heads a poller saw on the pull request: those no revision has yet make them again. */
  heard(pull: PullRef, heads: readonly string[]): void {
    if (this.#closed || this.#pull?.key !== pull.key || !this.#history) return;
    if (heads.some((head) => this.#revisions?.get(head) === undefined)) void this.#rebuild();
  }

  /**
   * Compares revision `from`, or the base, with revision `to`, as the reader asked: at once if the
   * local copy has both, or once it has.
   */
  compare(from: string | null, to: string): void {
    if (this.#closed) return;
    const revisions = this.#revisions;
    if (this.#login === undefined) {
      throw new IpcError('refused', 'Revisions show only for a signed-in account.');
    }
    if (!revisions) throw new IpcError('unavailable', 'Lo hasn’t read the revisions yet.');
    if (this.#info?.local.kind === 'noGit') {
      throw new IpcError('unavailable', 'Comparing revisions needs git, which Lo can’t find.');
    }
    const end = revisions.position(to);
    if (end === undefined) throw new IpcError('invalid', `${to} isn’t one of the revisions.`);
    if (from !== null) {
      const start = revisions.position(from);
      if (start === undefined) throw new IpcError('invalid', `${from} isn’t one of the revisions.`);
      if (start >= end) {
        throw new IpcError('invalid', 'A comparison goes from an older revision to a newer one.');
      }
    }
    for (const head of from === null ? [to] : [from, to]) {
      if (!revisions.get(head)?.available) {
        throw new IpcError('unavailable', `${this.#label(head)} is no longer available.`);
      }
    }
    this.#picked = true;
    this.#release();
    this.#offered = undefined;
    this.#chosen = from === null && to === this.#info?.shown ? undefined : { from, to };
    this.#nothingNewSince = undefined;
    this.#problem = undefined;
    this.#advance();
    this.#publish();
  }

  /** The diff was drawn with `head` as its newer side: the reader has seen it. */
  drawn(head: string): void {
    if (this.#closed) return;
    const seen = this.#seenNewest;
    const revisions = this.#revisions;
    if (seen === undefined || !revisions) {
      this.#seenNewest = head;
      return;
    }
    const was = revisions.position(seen);
    const now = revisions.position(head);
    if (was === undefined || (now !== undefined && now > was)) this.#seenNewest = head;
  }

  /** The reader left the pull request: the newest revision they saw here is "last seen here". */
  left(): void {
    const login = this.#login;
    const pull = this.#pull;
    const seen = this.#seenNewest;
    if (login === undefined || pull === undefined || seen === undefined) return;
    try {
      this.#options.marks.setLastSeen(login, pull, seen, this.#now());
    } catch (error) {
      this.#options.log(`noting where the reader left off: ${describe(error)}`);
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    clearTimeout(this.#holdTimer);
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
  }

  #now(): number {
    return (this.#options.now ?? Date.now)();
  }

  /** Forgets everything, for another pull request or account. */
  #reset(): void {
    const hadComparison = this.#ready !== undefined || this.#holding;
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#poller = undefined;
    this.#history = undefined;
    this.#candidate = undefined;
    this.#status = 'loading';
    this.#revisions = undefined;
    this.#build++;
    this.#withCommits = false;
    this.#lost.clear();
    this.#present.clear();
    this.#fetched = undefined;
    this.#fetching = undefined;
    this.#tips.clear();
    this.#bases.clear();
    this.#lastSeen = undefined;
    this.#seenNewest = undefined;
    this.#shownBefore = undefined;
    this.#started = false;
    this.#chosen = undefined;
    this.#picked = false;
    this.#defaulted = false;
    this.#holding = false;
    this.#offered = undefined;
    clearTimeout(this.#holdTimer);
    this.#ready = undefined;
    this.#preparing = undefined;
    this.#nothingNewSince = undefined;
    this.#problem = undefined;
    if (hadComparison) this.#options.changed();
  }

  /**
   * The tab is shown for the first time as `login`: "last seen here" is read, and if it's on an
   * older head than the one on screen, the diff waits for the comparison from there rather than
   * showing the whole pull request and then moving. The push history is read.
   */
  #start(pull: PullRef, login: string, shown: string): void {
    this.#started = true;
    try {
      this.#lastSeen = this.#options.marks.lastSeen(login, pull);
    } catch (error) {
      this.#options.log(`reading where the reader left off: ${describe(error)}`);
    }
    if (
      this.#lastSeen !== undefined &&
      this.#lastSeen !== shown &&
      this.#info?.local.kind !== 'noGit'
    ) {
      this.#holding = true;
      this.#holdTimer = setTimeout(
        () => this.#holdExpired(),
        this.#options.holdLimit ?? HOLD_LIMIT,
      );
      this.#options.changed();
    }
    void this.#watch(pull, login);
  }

  /**
   * The comparison "last seen here" asks for isn't ready in time: the whole pull request is drawn,
   * and the comparison, once the markers say which, is offered rather than put in its place.
   */
  #holdExpired(): void {
    if (!this.#holding) return;
    const chosen = this.#chosen;
    if (chosen && !this.#picked && !this.#ready) {
      this.#offered = chosen;
      this.#chosen = undefined;
      this.#preparing = undefined;
    }
    this.#release();
    this.#publish();
  }

  /** Stops holding the diff back: what's on screen shows. */
  #release(): void {
    clearTimeout(this.#holdTimer);
    if (!this.#holding) return;
    this.#holding = false;
    this.#options.changed();
  }

  async #watch(pull: PullRef, login: string): Promise<void> {
    let poller: HistoryPoller;
    try {
      poller = await this.#options.github.poller(login);
    } catch (error) {
      if (this.#login !== login || this.#closed) return;
      this.#fail(`Lo can’t read the revisions as ${login}: ${describe(error)}`);
      return;
    }
    if (this.#login !== login || this.#pull?.key !== pull.key || this.#closed) return;
    this.#poller = poller;
    const stop = poller.onEvent((event) => this.#heardPoll(poller, pull, event));
    this.#unsubscribe = stop;
    try {
      const cached = await poller.pushHistory(pull);
      if (this.#poller !== poller || this.#closed) return;
      if (cached) this.#takeHistory(cached.value);
    } catch (error) {
      if (this.#poller !== poller || this.#closed) return;
      this.#fail(`Lo couldn’t read the revisions: ${describe(error)}`);
    }
  }

  #heardPoll(poller: HistoryPoller, pull: PullRef, event: PollEvent): void {
    if (this.#poller !== poller || this.#closed) return;
    switch (event.kind) {
      case 'read':
      case 'confirmed': {
        if (event.name !== PUSH_HISTORY.name || !event.pull.equals(pull)) return;
        const cached = poller.cachedRead(pull, PUSH_HISTORY);
        if (cached) this.#takeHistory(cached.value);
        return;
      }
      case 'readFailed':
        if (event.name !== PUSH_HISTORY.name || !event.pull.equals(pull)) return;
        if (!this.#history)
          this.#fail(`Lo couldn’t read the revisions: ${new GithubError(event.error).message}`);
        return;
      case 'summary':
      case 'check':
      case 'details':
      case 'openPullRequests':
      case 'trunkRules':
      case 'failed':
        return;
      default:
        event satisfies never;
    }
  }

  /** Reading the revisions failed, with nothing read before: the whole pull request shows. */
  #fail(problem: string): void {
    this.#status = 'failed';
    this.#problem = problem;
    this.#options.log(problem);
    this.#release();
    this.#publish();
  }

  /**
   * Takes a push history, once its head is GitHub's newest as the tab knows it: one from before a
   * push, or from after one the tab hasn't heard of, waits for the tab to catch up.
   */
  #takeHistory(history: PushHistory): void {
    this.#candidate = history;
    const latest = this.#info?.latest;
    if (latest === undefined || history.head !== latest) return;
    if (this.#history === history) return;
    this.#history = history;
    const pull = this.#pull;
    if (pull) {
      try {
        this.#options.marks.noteClosed(
          pull,
          history.closedAt === undefined ? undefined : Date.parse(history.closedAt),
        );
      } catch (error) {
        this.#options.log(`noting whether the pull request is closed: ${describe(error)}`);
      }
    }
    void this.#rebuild();
  }

  /**
   * Builds the revisions from the push history, the heads Lo's pollers saw and the head on screen,
   * with the pull request's commits once the local copy has them.
   */
  async #rebuild(): Promise<void> {
    const history = this.#history;
    const pull = this.#pull;
    const info = this.#info;
    if (!history || !pull || !info) return;
    const build = ++this.#build;
    let seen: ReturnType<Marks['seen']> = [];
    try {
      seen = this.#options.marks.seen(pull);
    } catch (error) {
      this.#options.log(`reading the heads Lo saw: ${describe(error)}`);
    }
    const records: PushRecord[] = pushRecords(history, seen);
    // The head on screen is a revision, though no source has said so yet.
    const shown = info.shown;
    if (shown !== undefined && !seen.some((each) => each.head === shown)) {
      records.push({ kind: 'polled', head: shown, at: this.#now() });
    }
    const local = info.local;
    let commits: Oid[] = [];
    const withCommits = local.kind === 'ready';
    if (withCommits) {
      try {
        const repo = await this.#options.clone();
        const head = parseOid(history.head);
        const tip = parseOid(local.base);
        if (repo && (await repo.hasCommit(head)) && (await repo.hasCommit(tip))) {
          commits = await repo.pullCommits(tip, head);
        }
      } catch (error) {
        this.#options.log(`listing the pull request's commits: ${describe(error)}`);
      }
    }
    if (build !== this.#build || this.#closed) return;
    const revisions = this.#available(
      buildRevisions(records, commits, history.head, Date.parse(history.openedAt)),
      history,
    );
    this.#revisions = revisions;
    this.#withCommits = withCommits;
    this.#status = 'ready';
    if (this.#problem?.startsWith('Lo couldn’t read the revisions')) this.#problem = undefined;
    // What was fetched was for other revisions.
    if (this.#fetched !== this.#headsKey(revisions)) this.#fetched = undefined;
    if (!this.#defaulted) this.#decideDefault(revisions, history);
    this.#advance();
    this.#publish();
  }

  /**
   * `revisions`, each flagged no longer available when GitHub no longer has its head and the local
   * copy lacks it: one a fetch found GitHub lacked, or one GitHub's timeline names as lost, until a
   * fetch finds the local copy has it.
   */
  #available(revisions: Revisions, history: PushHistory): Revisions {
    const lost = new Set([
      ...this.#lost,
      ...unavailableHeads(history).filter((head) => !this.#present.has(head)),
    ]);
    return new Revisions(
      revisions.list().map((revision) => ({ ...revision, available: !lost.has(revision.head) })),
    );
  }

  /**
   * What the tab opens on, decided once: the more recent marker's revision against the head on
   * screen, or the whole pull request, with "Nothing new since" when a marker is on the head.
   */
  #decideDefault(revisions: Revisions, history: PushHistory): void {
    this.#defaulted = true;
    const shown = this.#info?.shown;
    const at = shown === undefined ? undefined : revisions.position(shown);
    // Only revisions up to the head on screen: a newer push waits for the reader to load it.
    const upTo = at === undefined ? revisions : new Revisions(revisions.list().slice(0, at + 1));
    const chosen = defaultComparison(upTo, lastReview(history), this.#lastSeen);
    if (chosen.kind === 'full') {
      this.#nothingNewSince = chosen.nothingNewSince;
      this.#release();
      return;
    }
    if (this.#picked) {
      this.#release();
      return;
    }
    const between = { from: chosen.from, to: chosen.to };
    // Put on screen only while nothing has been drawn: a comparison the tab didn't hold the diff
    // for, as one due from the reader's last review, which only the push history says, is offered.
    if (this.#holding && this.#info?.local.kind !== 'noGit') {
      this.#chosen = between;
    } else {
      this.#offered = between;
      this.#release();
    }
  }

  /** The head on screen moved, to a newer push the reader loaded: a comparison up to it follows. */
  #shownMoved(before: string, after: string): void {
    this.#nothingNewSince = undefined;
    const offered = this.#offered;
    if (offered?.to === before) {
      this.#offered = offered.from === after ? undefined : { from: offered.from, to: after };
    }
    const chosen = this.#chosen;
    if (!chosen || chosen.to !== before) return;
    this.#chosen =
      chosen.from === null || chosen.from === after ? undefined : { from: chosen.from, to: after };
  }

  /** Makes what's to be compared ready, if it isn't, once the local copy is. */
  #advance(): void {
    if (this.#closed) return;
    const info = this.#info;
    const chosen = this.#chosen;
    const revisions = this.#revisions;
    if (!info || !revisions) return;
    const local = info.local;
    // Every revision's head fetched, whatever's compared.
    if (local.kind === 'ready') void this.#fetchRevisions();
    if (!chosen) {
      if (this.#ready) {
        this.#ready = undefined;
        this.#replay = undefined;
        this.#options.changed();
      }
      this.#release();
      return;
    }
    if (same(this.#ready?.chosen, chosen) || same(this.#preparing, chosen)) return;
    // A newer push the reader loaded is a revision once its push history is read.
    const known = (head: string | null) => head === null || revisions.get(head) !== undefined;
    if (!known(chosen.from) || !known(chosen.to)) return;
    if (local.kind === 'noGit') {
      this.#release();
      return;
    }
    if (local.kind !== 'ready') return;
    this.#preparing = chosen;
    void this.#prepare(chosen);
  }

  /** The revisions' heads, sorted, to tell when they change. */
  #headsKey(revisions: Revisions): string {
    return revisions
      .list()
      .map((revision) => revision.head)
      .toSorted()
      .join(',');
  }

  /**
   * Fetches every revision's head into the local copy, and the tips of the base branch they were
   * pushed on, and works out where each branched. A head GitHub no longer has is no longer
   * available. Once for each set of revisions.
   */
  #fetchRevisions(): Promise<void> {
    const revisions = this.#revisions;
    const history = this.#history;
    const pull = this.#pull;
    if (!revisions || !history || !pull) return Promise.resolve();
    const key = this.#headsKey(revisions);
    if (this.#fetched === key && this.#fetching) return this.#fetching;
    const opening = this.#options.clone();
    // Once the clone is open: a fetch can't start before.
    if (!opening) return Promise.resolve();
    this.#fetched = key;
    const heads = revisions.list().map((revision) => parseOid(revision.head));
    const fetching = this.#fetchNow(opening, heads, pull.number).catch((error: unknown) => {
      this.#options.log(`fetching the revisions: ${describe(error)}`);
      // Tried again the next time something asks.
      if (this.#fetched === key) this.#fetched = undefined;
    });
    this.#fetching = fetching;
    return fetching;
  }

  /**
   * Fetches `heads` into the clone, notes which GitHub no longer has, then works out each available
   * revision's base. What it finds is kept by head, so revisions built again meanwhile take it too.
   */
  async #fetchNow(opening: Promise<Repo>, heads: readonly Oid[], number: number): Promise<void> {
    const repo = await opening;
    let lost: Oid[] = [];
    if (repo.offline) {
      lost = await repo.unavailableRevisions(number);
    } else {
      try {
        lost = await repo.fetchCommits(number, heads);
      } catch (error) {
        // A failure that isn't GitHub lacking a head leaves every revision as it was.
        this.#options.log(`fetching the revisions' heads: ${describe(error)}`);
      }
    }
    for (const head of heads) {
      if (await repo.hasCommit(head)) {
        this.#present.add(head);
        this.#lost.delete(head);
      } else if (lost.includes(head)) {
        this.#lost.add(head);
      }
    }
    if (this.#closed) return;
    const history = this.#history;
    const current = this.#revisions;
    if (!history || !current) return;
    const revisions = this.#available(current, history);
    this.#revisions = revisions;
    // Where each revision's base branch was when it was pushed.
    const info = this.#info;
    const tip = info?.local.kind === 'ready' ? info.local.base : undefined;
    const bases = baseHistory(history, tip);
    const tips = new Map<string, BaseTip>();
    for (const revision of revisions) {
      if (!revision.available) continue;
      const found = baseTipAt(bases, revision.pushedAt, revision.head, () => false);
      if (found) tips.set(revision.head, found);
    }
    const wanted = [...new Set([...tips.values()].map((each) => parseOid(each.commit)))];
    if (!repo.offline && wanted.length > 0) {
      try {
        await repo.fetchRevisionBases(number, wanted);
      } catch (error) {
        this.#options.log(`fetching the revisions' bases: ${describe(error)}`);
      }
    }
    for (const [head, found] of tips) {
      this.#tips.set(head, found);
      await this.#baseOf(repo, head).catch((error: unknown) => {
        this.#options.log(`finding where ${this.#label(head)} branched off: ${describe(error)}`);
      });
    }
    if (this.#closed) return;
    this.#publish();
    // A comparison that waited for the revisions' heads may go now.
    this.#advance();
  }

  /** Where `head`'s revision branched off its base branch, worked out once. */
  async #baseOf(repo: Repo, head: string): Promise<BaseOf> {
    const known = this.#bases.get(head);
    if (known) return known;
    const label = this.#label(head);
    const oid = parseOid(head);
    const tip = this.#tips.get(head);
    if (!(await repo.hasCommit(oid))) {
      throw new Error(`the local copy doesn’t have ${label}`);
    }
    if (!tip) throw new Error(`Lo doesn’t know where ${label}’s base branch was`);
    const tipOid = parseOid(tip.commit);
    if (!(await repo.hasCommit(tipOid))) {
      throw new Error(`the local copy doesn’t have the base ${label} was pushed on`);
    }
    // A tip that holds the revision is no base for it.
    const holds = await repo.isAncestor(oid, tipOid);
    const base = await repo.mergeBase(oid, tipOid);
    if (base === undefined) throw new Error(`${label} shares no history with its base branch`);
    const found = { base, uncertain: holds || tip.source === 'uncertain' };
    this.#bases.set(head, found);
    return found;
  }

  /** Makes `chosen` ready to show: both sides fetched, their bases found. */
  async #prepare(chosen: Compared): Promise<void> {
    const current = () => !this.#closed && same(this.#preparing, chosen);
    try {
      const opening = this.#options.clone();
      if (!opening) throw new Error('the local copy isn’t open');
      const repo = await opening;
      await this.#fetchRevisions();
      if (!current()) return;
      const unavailable = [chosen.from, chosen.to].find(
        (head) => head !== null && !this.#revisions?.get(head)?.available,
      );
      if (unavailable) throw new Error(`${this.#label(unavailable)} is no longer available`);
      const newer = await this.#baseOf(repo, chosen.to);
      const older: BaseOf | undefined =
        chosen.from === null ? undefined : await this.#baseOf(repo, chosen.from);
      if (!current()) return;
      const sides = {
        old: {
          head: older ? parseOid(chosen.from ?? '') : newer.base,
          base: older?.base ?? newer.base,
        },
        new: { head: parseOid(chosen.to), base: newer.base },
      };
      const comparing = comparingOf(repo, sides.old, sides.new);
      this.#preparing = undefined;
      this.#ready = { chosen, comparing };
      this.#replay = undefined;
      this.#conflicted = 0;
      this.#uncertain = newer.uncertain || (older?.uncertain ?? false);
      this.#problem = undefined;
      this.#release();
      this.#options.changed();
      this.#publish();
      await this.#describe(chosen, comparing);
    } catch (error) {
      if (!current()) return;
      this.#preparing = undefined;
      this.#couldnt(chosen, error);
    }
  }

  /** Says how a comparison went, once it's made: across a rebase or not, and what conflicted. */
  async #describe(chosen: Compared, comparing: Comparing): Promise<void> {
    try {
      const compared = await comparing.compared();
      if (this.#ready?.comparing !== comparing) return;
      if ('refused' in compared) {
        this.#couldnt(
          chosen,
          new Error(`it would read more than ${Math.round(compared.limit / 2 ** 20)} MB of files`),
        );
        return;
      }
      this.#replay = compared.replay.kind;
      this.#conflicted = compared.files.filter((file) => file.resolution !== undefined).length;
      this.#publish();
    } catch (error) {
      if (this.#ready?.comparing !== comparing) return;
      this.#couldnt(chosen, error);
    }
  }

  /** `chosen` can't be compared: it says why, and the whole pull request shows. */
  #couldnt(chosen: Compared, error: unknown): void {
    const why =
      error instanceof GitError && error.detail.kind === 'unavailable'
        ? 'GitHub no longer has one of them'
        : describe(error);
    const from = chosen.from === null ? 'the base' : this.#label(chosen.from);
    this.#problem = `Lo couldn’t compare ${from} with ${this.#label(chosen.to)}: ${why}.`;
    this.#options.log(this.#problem);
    if (same(this.#chosen, chosen)) this.#chosen = undefined;
    const hadReady = this.#ready !== undefined;
    this.#ready = undefined;
    this.#replay = undefined;
    this.#release();
    if (hadReady) this.#options.changed();
    this.#advance();
    this.#publish();
  }

  /** What the diff says while it waits for the comparison the markers ask for. */
  #waitingWhy(): string {
    const chosen = this.#chosen;
    if (!chosen || !this.#revisions) return 'Reading the revisions…';
    const from = chosen.from === null ? 'the base' : this.#label(chosen.from);
    return `Comparing ${from} with ${this.#label(chosen.to)} once the local copy has both…`;
  }

  /** A revision's label, `r3`, or its head cut short when it has none. */
  #label(head: string): string {
    return this.#revisions?.label(head) ?? head.slice(0, 7);
  }

  /** The revisions as the picker lists them. */
  #rows(revisions: Revisions, history: PushHistory | undefined): RevisionRow[] {
    const pushers = new Map<string, string>();
    if (history) {
      for (const entry of activityEntries(history.headActivity)) {
        if (entry.actor) pushers.set(entry.after, entry.actor.login);
      }
    }
    let before: Revision | undefined;
    return revisions.list().map((revision) => {
      const base = this.#bases.get(revision.head)?.base;
      const previous = before === undefined ? undefined : this.#bases.get(before.head)?.base;
      before = revision;
      const { pushedAt } = revision;
      return {
        head: revision.head,
        number: revisions.number(revision.head) ?? null,
        pushedAt:
          pushedAt.kind === 'unknown'
            ? { kind: 'unknown' }
            : { kind: pushedAt.kind, at: Math.max(0, Math.round(pushedAt.at)) },
        forced: revision.forced ?? null,
        pusher: pushers.get(revision.head) ?? null,
        rebased: base !== undefined && previous !== undefined && base !== previous,
        available: revision.available,
      };
    });
  }

  #publish(): void {
    if (this.#closed) return;
    const view = this.view();
    const said = JSON.stringify(view);
    if (said === this.#said) return;
    this.#said = said;
    this.#options.publish(view);
  }
}

/** A comparison of `old` with `now` in `repo`, made once, whoever asks. */
function comparingOf(repo: Repo, old: Side, now: Side): Comparing {
  let made: ReturnType<Comparing['compared']> | undefined;
  return {
    key: `${old.base}:${old.head}..${now.base}:${now.head}`,
    old,
    new: now,
    compared: () => (made ??= repo.compareRevisions(old, now)),
  };
}
