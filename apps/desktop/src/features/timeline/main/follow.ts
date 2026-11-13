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
  type PullRequestSidebar,
  type PullRequestTimeline,
} from '@lo/github';

import type { PullTabInfo } from '../../tab/service.ts';
import type { SidebarView, TimelineView } from '../contract.ts';

/** What the timeline uses of an account's poller: its two reads, and its events. */
export interface TimelinePoller extends Pick<
  Poller,
  'timeline' | 'pullRequestSidebar' | 'onEvent'
> {
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
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  #problem: string | undefined;
  #closed = false;

  constructor(options: TimelineTabOptions) {
    this.id = options.id;
    this.#options = options;
  }

  /** The timeline as main has it now, as the window gets it. */
  timeline(): TimelineView {
    return {
      id: this.id,
      status: this.#status(),
      timeline: this.#timeline ?? null,
      problem: this.#timeline === undefined ? (this.#problem ?? null) : null,
    };
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

  #status(): TimelineView['status'] {
    const info = this.#info;
    if (info?.run) return 'run';
    if (info?.acting?.kind === 'anonymous') return 'signIn';
    if (this.#timeline) return 'ready';
    return this.#problem === undefined ? 'loading' : 'failed';
  }

  #reset(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = undefined;
    this.#poller = undefined;
    this.#timeline = undefined;
    this.#sidebar = undefined;
    this.#problem = undefined;
  }

  async #watch(pull: PullRef, login: string): Promise<void> {
    let poller: TimelinePoller;
    try {
      poller = await this.#options.github.poller(login);
    } catch (error) {
      if (!this.#current(pull, login)) return;
      this.#fail(`Lo can’t read the timeline as ${login}: ${describe(error)}`);
      return;
    }
    if (!this.#current(pull, login) || this.#poller) return;
    this.#poller = poller;
    this.#unsubscribe = poller.onEvent((event) => this.#heard(poller, pull, event));
    const reads = await Promise.allSettled([
      poller.timeline(pull),
      poller.pullRequestSidebar(pull),
    ]);
    if (this.#poller !== poller) return;
    const [timeline, sidebar] = reads;
    if (timeline.status === 'rejected') {
      if (!this.#timeline)
        this.#fail(`Lo couldn’t read the timeline: ${describe(timeline.reason)}`);
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
          if (!cached || (cached.value === this.#timeline && this.#problem === undefined)) return;
          this.#timeline = cached.value;
          this.#problem = undefined;
          this.#publishTimeline();
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
          const message = `Lo couldn’t read the timeline: ${new GithubError(event.error).message}`;
          this.#options.log(message);
          if (!this.#timeline) this.#fail(message);
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

  /** Reading the timeline failed, with nothing read before. */
  #fail(problem: string): void {
    this.#problem = problem;
    this.#publishTimeline();
  }

  #publish(): void {
    this.#publishTimeline();
    this.#publishSidebar();
  }

  #publishTimeline(): void {
    this.#options.publish.timeline(this.timeline());
  }

  #publishSidebar(): void {
    this.#options.publish.sidebar(this.sidebar());
  }
}
