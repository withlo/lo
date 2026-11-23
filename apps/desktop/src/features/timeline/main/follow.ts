// A view's timeline in main: read through the account's poller the first time the window shows it,
// with what goes beside its description, and kept current from then on, as the poller reads them
// again after the pull request changes. A tab that acts as nobody, or a run of a stack's layers,
// reads neither. Nothing here calls Electron.

import {
  GithubError,
  PULL_REQUEST_SIDEBAR,
  PullRef,
  TIMELINE,
  type Cached,
  type Poller,
  type PollEvent,
  type PollStatus,
  type PullRequestSidebar,
  type PullRequestTimeline,
} from '@lo/github';

import type { PullTabInfo } from '../../tab/service.ts';
import type { SidebarView, TimelineCause, TimelineView } from '../contract.ts';

/**
 * What the timeline uses of an account's poller: its two reads, its events, reading again and when,
 * and how polling is going.
 */
export interface TimelinePoller extends Pick<
  Poller,
  'timeline' | 'pullRequestSidebar' | 'onEvent' | 'onChange' | 'status'
> {
  readAfresh(pull: PullRef, kind: typeof TIMELINE): unknown;
  readRetryAt(pull: PullRef, kind: typeof TIMELINE): number | undefined;
  cachedRead(pull: PullRef, kind: typeof TIMELINE): Cached<PullRequestTimeline> | undefined;
  cachedRead(
    pull: PullRef,
    kind: typeof PULL_REQUEST_SIDEBAR,
  ): Cached<PullRequestSidebar> | undefined;
}

export interface TimelineTabOptions {
  readonly id: string;
  /** The poller of each account, as the accounts feature provides it. */
  readonly github: { poller(login: string): Promise<TimelinePoller> };
  /** Sends the timeline and what goes beside it to the window, each time they change. */
  readonly publish: {
    timeline(view: TimelineView): void;
    sidebar(view: SidebarView): void;
  };
  readonly log: (line: string) => void;
  /** How long Try again waits for the read it asked for to answer, in ms: 20 s by default. */
  readonly readWait?: number | undefined;
}

/** How long Try again waits for its read, by default: as long as a merge waits for its facts. */
const READ_WAIT = 20_000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Why reading the timeline failed, in the causes every error is worded by: GitHub couldn't be
 * reached, or answered with an error, as anything else is.
 */
function causeOf(error: unknown): TimelineCause {
  return error instanceof GithubError && error.isUnreachable() ? 'offline' : 'failed';
}

/**
 * Whether the poller reads nothing now: GitHub can't be reached, the rate limit holds every read,
 * or the account is signed out. A read asked for then gets no answer until that's over.
 */
function stalled(status: PollStatus): boolean {
  return status.signedOut || status.offline !== undefined || status.rateLimit.kind === 'paused';
}

/** Why a timeline that was never read can't be, and when the poller tries again, if it says. */
interface Failure {
  readonly cause: TimelineCause;
  readonly words: string;
  readonly retryAt: number | undefined;
  /** Whether the poller reads nothing now, so nothing here can try again. */
  readonly stalled: boolean;
}

export class TimelineTab {
  readonly id: string;
  readonly #options: TimelineTabOptions;
  #info: PullTabInfo | undefined;
  #pull: PullRef | undefined;
  #login: string | undefined;
  /** Whether the window has shown the timeline, which reads it. */
  #shown = false;
  #poller: TimelinePoller | undefined;
  #unsubscribe: (() => void) | undefined;
  #timeline: PullRequestTimeline | undefined;
  #sidebar: PullRequestSidebar | undefined;
  #problem: { readonly cause: TimelineCause; readonly words: string } | undefined;
  /** What waits for the timeline's next read to answer, as Try again does. */
  #waiting: (() => void)[] = [];
  /** What the window was last told of a failure, so a change in polling says only what's new. */
  #told = '';
  /** Whether the first read has answered, from the cache or GitHub: a failure counts after it. */
  #landed = false;
  #closed = false;

  constructor(options: TimelineTabOptions) {
    this.id = options.id;
    this.#options = options;
  }

  /** The timeline as main has it now, as the window gets it. */
  timeline(): TimelineView {
    const failure = this.#failure();
    return {
      id: this.id,
      status: this.#status(failure),
      timeline: this.#timeline ?? null,
      cause: failure?.cause ?? null,
      problem: failure?.words ?? null,
      retryAt: failure?.retryAt ?? null,
      stalled: failure?.stalled ?? false,
    };
  }

  /**
   * Why the timeline can't be read, while nothing has been: GitHub can't be reached now, as the
   * poller says, or the read failed; with when the poller tries again, where it says. While the
   * poller is stalled, the tab's banner says the wait and has its own Try again, so this says
   * neither: it's `stalled`, with no time.
   */
  #failure(): Failure | undefined {
    if (this.#timeline || this.#info?.run || this.#info?.acting?.kind === 'anonymous') {
      return undefined;
    }
    const poller = this.#poller;
    const status = poller?.status();
    const pull = this.#pull;
    const stall = status !== undefined && stalled(status);
    // A tab that opens offline shows what it saved, once it's read that: nothing fails before.
    if (status?.offline && this.#landed) {
      return {
        cause: 'offline',
        words: `Lo couldn’t read the timeline: ${status.offline.error}`,
        retryAt: undefined,
        stalled: true,
      };
    }
    if (!this.#problem) return undefined;
    const at = stall || !pull ? undefined : poller?.readRetryAt(pull, TIMELINE);
    return { ...this.#problem, retryAt: at, stalled: stall };
  }

  /** What goes beside the description, as main has it now. */
  sidebar(): SidebarView {
    return { id: this.id, sidebar: this.#sidebar ?? null };
  }

  /** Follows the tab as it is now: another pull request or account reads anew, once shown. */
  update(info: PullTabInfo): void {
    if (this.#closed) return;
    const before = this.#info;
    this.#info = info;
    const pull = new PullRef(info.repository.owner, info.repository.name, info.number);
    const login = info.acting?.kind === 'account' && !info.run ? info.acting.login : undefined;
    const moved =
      this.#pull?.key !== pull.key || this.#login?.toLowerCase() !== login?.toLowerCase();
    if (moved) {
      this.#reset();
      this.#pull = pull;
      this.#login = login;
      if (this.#shown && login !== undefined) void this.#watch(pull, login);
    }
    if (moved || before?.acting?.kind !== info.acting?.kind || before?.run !== info.run) {
      this.#publish();
    }
  }

  /**
   * The window shows the timeline: it's read, the first time, and what main has now is the
   * answer.
   */
  show(): { timeline: TimelineView; sidebar: SidebarView } {
    if (!this.#closed && !this.#shown) {
      this.#shown = true;
      const pull = this.#pull;
      const login = this.#login;
      if (pull && login !== undefined) void this.#watch(pull, login);
    }
    return { timeline: this.timeline(), sidebar: this.sidebar() };
  }

  close(): void {
    this.#closed = true;
    this.#reset();
  }

  /**
   * Reads the timeline again at once, after it failed, whatever wait its failures set, and settles
   * once that read has answered, however it went. A failure of the network, the token or the rate
   * limit sends no answer, and nothing is read while the poller is stalled, so it also settles once
   * the poller stalls, and after `readWait` at most: what the view says of the failure then stays.
   */
  async retry(): Promise<void> {
    const pull = this.#pull;
    const login = this.#login;
    if (this.#closed || !this.#shown || !pull || login === undefined) return;
    const poller = this.#poller;
    // The account's poller couldn't be had: it's asked for again.
    if (!poller) {
      await this.#watch(pull, login);
      return;
    }
    if (stalled(poller.status())) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stop();
        this.#waiting = this.#waiting.filter((each) => each !== settle);
        resolve();
      };
      const timer = setTimeout(settle, this.#options.readWait ?? READ_WAIT);
      const stop = poller.onChange(() => {
        if (stalled(poller.status())) settle();
      });
      this.#waiting.push(settle);
      if (poller.readAfresh(pull, TIMELINE) === undefined) settle();
    });
  }

  /** The timeline's read has answered: what waited on it hears. */
  #answered(): void {
    for (const settle of this.#waiting.splice(0)) settle();
  }

  /**
   * Tells the window of a change in how polling goes, such as GitHub becoming unreachable, or the
   * time a failed read is tried again, while nothing has been read: nothing when its failure says
   * the same.
   */
  #restate(): void {
    if (this.#closed || this.#timeline) return;
    const view = this.timeline();
    const told = JSON.stringify([
      view.status,
      view.cause,
      view.problem,
      view.retryAt,
      view.stalled,
    ]);
    if (told === this.#told) return;
    this.#publishTimeline();
  }

  #status(failure: Failure | undefined): TimelineView['status'] {
    const info = this.#info;
    if (info?.run) return 'run';
    if (info?.acting?.kind === 'anonymous') return 'signIn';
    if (this.#timeline) return 'ready';
    return failure === undefined ? 'loading' : 'failed';
  }

  #reset(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#poller = undefined;
    this.#timeline = undefined;
    this.#sidebar = undefined;
    this.#problem = undefined;
    this.#landed = false;
    this.#answered();
  }

  async #watch(pull: PullRef, login: string): Promise<void> {
    let poller: TimelinePoller;
    try {
      poller = await this.#options.github.poller(login);
    } catch (error) {
      if (!this.#current(pull, login)) return;
      this.#fail(causeOf(error), `Lo can’t read the timeline as ${login}: ${describe(error)}`);
      return;
    }
    if (!this.#current(pull, login) || this.#poller) return;
    this.#poller = poller;
    const events = poller.onEvent((event) => this.#heard(poller, pull, event));
    const changes = poller.onChange(() => this.#restate());
    this.#unsubscribe = () => {
      events();
      changes();
    };
    this.#restate();
    const reads = await Promise.allSettled([
      poller.timeline(pull),
      poller.pullRequestSidebar(pull),
    ]);
    if (this.#poller !== poller) return;
    this.#landed = true;
    const [timeline, sidebar] = reads;
    if (timeline.status === 'rejected') {
      if (!this.#timeline) {
        this.#fail(
          causeOf(timeline.reason),
          `Lo couldn’t read the timeline: ${describe(timeline.reason)}`,
        );
      }
    } else if (timeline.value && !this.#timeline) {
      this.#timeline = timeline.value.value;
      this.#publishTimeline();
    }
    if (sidebar.status === 'rejected') {
      this.#options.log(`reading what goes beside the description: ${describe(sidebar.reason)}`);
    } else if (sidebar.value && !this.#sidebar) {
      this.#sidebar = sidebar.value.value;
      this.#publishSidebar();
    }
    // With nothing saved to show, what polling says now counts.
    this.#restate();
  }

  /** Whether the tab still shows `pull` as `login`. */
  #current(pull: PullRef, login: string): boolean {
    return !this.#closed && this.#pull?.key === pull.key && this.#login === login;
  }

  #heard(poller: TimelinePoller, pull: PullRef, event: PollEvent): void {
    if (this.#poller !== poller || this.#closed) return;
    switch (event.kind) {
      case 'read':
      case 'confirmed':
        if (!event.pull.equals(pull)) return;
        if (event.name === TIMELINE.name) {
          const cached = poller.cachedRead(pull, TIMELINE);
          // GitHub giving the same timeline again changes nothing, unless a failure showed.
          if (cached && (cached.value !== this.#timeline || this.#problem !== undefined)) {
            this.#timeline = cached.value;
            this.#problem = undefined;
            this.#publishTimeline();
          }
          this.#answered();
        } else if (event.name === PULL_REQUEST_SIDEBAR.name) {
          const cached = poller.cachedRead(pull, PULL_REQUEST_SIDEBAR);
          if (!cached || cached.value === this.#sidebar) return;
          this.#sidebar = cached.value;
          this.#publishSidebar();
        }
        return;
      case 'readFailed':
        if (!event.pull.equals(pull)) return;
        if (event.name === TIMELINE.name) {
          const error = new GithubError(event.error);
          const message = `Lo couldn’t read the timeline: ${error.message}`;
          this.#options.log(message);
          if (!this.#timeline) this.#fail(causeOf(error), message);
          this.#answered();
        } else if (event.name === PULL_REQUEST_SIDEBAR.name) {
          this.#options.log(
            `reading what goes beside the description: ${new GithubError(event.error).message}`,
          );
        }
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

  /** Reading the timeline failed, with nothing read before, for `cause`, as `words` say. */
  #fail(cause: TimelineCause, words: string): void {
    this.#problem = { cause, words };
    this.#publishTimeline();
  }

  #publish(): void {
    this.#publishTimeline();
    this.#publishSidebar();
  }

  #publishTimeline(): void {
    const view = this.timeline();
    this.#told = JSON.stringify([
      view.status,
      view.cause,
      view.problem,
      view.retryAt,
      view.stalled,
    ]);
    this.#options.publish.timeline(view);
  }

  #publishSidebar(): void {
    this.#options.publish.sidebar(this.sidebar());
  }
}
