// Review threads in a code view, each drawn by the caller in an element the view makes for it and
// keeps for as long as it has the thread: the view places the element under the thread's line,
// moves it into whichever editor draws the line, and hears from a resize observer how tall the
// caller's content is. A thread's element lives on while its line is off screen and its block is
// gone, so what the caller drew stays drawn, and is measured, between one block and the next.
//
// Once measured, an element keeps the height the view last let it take, whatever the caller draws
// in it, until the view hears of the change and says what becomes of it: the editor measuring
// first, as it does after anything changes in its document's elements, would see a change the view
// hasn't placed. One on screen that no input asked for, such as an image loading, the view can hold
// there, clipping what grew in it, so it moves no line on screen.

import type { RenderThread, ThreadContent, ThreadView } from './api.ts';

/** About how tall a thread is before it's been measured: open, or collapsed to one line. */
const GUESS = { open: 120, closed: 36 } as const;

/** One thread's element, and what the caller drew in it. */
export class ThreadHost {
  readonly id: string;
  /** The view's element, which holds its height while the view holds it. */
  readonly dom: HTMLElement;
  /** The caller's element, inside it. */
  readonly host: HTMLElement;
  /** The thread as the caller last gave it. */
  #given: ThreadView;
  /** Whether it's open: as the caller last said, or as `setOpen` left it since. */
  #open: boolean;
  /** Whether `]t` landed on it. */
  #focused = false;
  #content: ThreadContent | undefined;
  /** How tall and wide the caller's content was when last measured drawn, and if open then. */
  height: number | undefined;
  width: number | undefined;
  #heightOpen = false;
  /** The height its element is kept at, once measured, while it's drawn. */
  pinned: number | undefined;
  /** Whether it was drawn when it was last measured. */
  drawn = false;
  /**
   * Drawn, with nothing measured in it yet: what the caller first draws in it, even a moment after
   * it's asked, is how the thread comes, not a change to it.
   */
  fresh = true;
  /** Whether the view holds it as it was on screen, a change of size since cut off. */
  held = false;
  /**
   * Whether the view changed it at the reader's asking, as `openThread` does, or as what comes
   * under a comment box's line does: its next change of size is theirs.
   */
  #asked = false;
  /**
   * Whether a pointer or key of the reader's landed in it since the last frame: a change of size
   * laid out in the next frame is what the caller drew for it.
   */
  #touched = false;
  /** Which touch the last was, so only the frame after it ends it. */
  #touches = 0;

  constructor(thread: ThreadView) {
    this.id = thread.id;
    this.#given = thread;
    this.#open = thread.open;
    this.dom = document.createElement('div');
    this.dom.className = 'lo-diffthread__thread';
    this.dom.dataset.threadId = thread.id;
    this.host = document.createElement('div');
    this.host.className = 'lo-diffthread__host';
    this.dom.append(this.host);
  }

  /**
   * The thread as the caller draws it: as given, open or not as it is now, and whether `]t` landed
   * on it.
   */
  get thread(): ThreadView {
    return { ...this.#given, open: this.#open, focused: this.#focused };
  }

  /**
   * Says whether `]t` landed on it, the cursor still on its line: the caller draws it again. It
   * changes no size.
   */
  setFocused(focused: boolean): void {
    if (focused === this.#focused) return;
    this.#focused = focused;
    this.#content?.update(this.thread);
  }

  get open(): boolean {
    return this.#open;
  }

  /**
   * Takes what the caller says of the thread now. Whether it's open changes only when the caller
   * says something other than it said last, so the reader's `openThread` stands until then. What's
   * drawn is drawn again if anything changed, and then the next change of size is the reader's
   * doing only if `asked`. Says whether it was drawn again.
   */
  give(thread: ThreadView, asked = false): boolean {
    const before = this.thread;
    if (thread.open !== this.#given.open) this.#open = thread.open;
    this.#given = thread;
    if (!this.#content || sameThread(before, this.thread)) return false;
    this.#asked = asked;
    this.#content.update(this.thread);
    return true;
  }

  /** Opens or collapses it, as the reader asked: its next change of size is theirs. */
  setOpen(open: boolean): void {
    if (open === this.#open) return;
    this.#open = open;
    this.#asked = true;
    this.#content?.update(this.thread);
  }

  /**
   * The reader's pointer or key landed in it: a change of size laid out in the next frame, which
   * is what the caller drew for that, is theirs.
   */
  touched(): void {
    this.#touched = true;
    const touch = ++this.#touches;
    // The second frame from now begins after the next has laid out and measured what changed.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        if (touch === this.#touches) this.#touched = false;
      }),
    );
  }

  /** Whether this change of size is the reader's doing; asking uses it up. */
  takeInput(): boolean {
    const input = this.#asked || this.#touched;
    this.#asked = false;
    this.#touched = false;
    return input;
  }

  /** Has the caller draw it, the first time it's drawn. */
  draw(render: RenderThread | undefined): void {
    if (this.#content || !render) return;
    this.#content = render(this.host, this.thread);
  }

  /** Notes how big its content is, drawn. */
  measured(height: number, width: number): void {
    this.height = height;
    this.width = width;
    this.#heightOpen = this.#open;
  }

  /**
   * How tall it is before it's drawn: the height it's kept at, or as tall as it was, open or
   * collapsed as it is now, if known.
   */
  get estimate(): number {
    if (this.pinned !== undefined) return this.pinned;
    if (this.height !== undefined && this.#heightOpen === this.#open) return this.height;
    return this.#open ? GUESS.open : GUESS.closed;
  }

  /** Keeps its element at `height`, whatever its content's height. */
  pin(height: number): void {
    this.pinned = height;
    this.dom.style.height = `${height}px`;
  }

  /** Lets its element take its content's height, as it isn't drawn: it's measured when it is. */
  unpin(): void {
    this.pinned = undefined;
    this.dom.style.height = '';
  }

  /** Holds it as it was on screen: what changed in it since is cut off. */
  hold(): void {
    this.held = true;
    this.dom.classList.add('is-held');
  }

  /** Lets it take the height its content was last measured at. */
  letGo(): void {
    this.held = false;
    this.dom.classList.remove('is-held');
    if (this.pinned !== undefined && this.height !== undefined) this.pin(this.height);
  }

  destroy(): void {
    const content = this.#content;
    this.#content = undefined;
    this.dom.remove();
    content?.destroy();
  }
}

/** A thread's content changed size while drawn, its element kept at the height it had. */
export interface Resized {
  host: ThreadHost;
  /** Whether it was the first content drawn in it, which is how it comes rather than a change. */
  fresh: boolean;
  /** Whether it's as wide as it was not, as when the window is: its text wrapped again. */
  reflowed: boolean;
}

/**
 * A code view's threads: an element for each, made as the caller gives the thread and kept until
 * it's gone, and a resize observer on what the caller draws in them.
 */
export class Threads {
  readonly #hosts = new Map<string, ThreadHost>();
  readonly #byHost = new WeakMap<Element, ThreadHost>();
  readonly #resized: (entries: readonly ResizeObserverEntry[]) => void;
  /** Made once there's something to watch, so a view with no threads has none. */
  #observer: ResizeObserver | undefined;
  /** What draws a thread: the caller's, from its latest `setThreads`. */
  render: RenderThread | undefined;

  /** `resized` hears of every change of size the observer sees. */
  constructor(resized: (entries: readonly ResizeObserverEntry[]) => void) {
    this.#resized = resized;
  }

  get(id: string): ThreadHost | undefined {
    return this.#hosts.get(id);
  }

  values(): IterableIterator<ThreadHost> {
    return this.#hosts.values();
  }

  /** The thread whose element `element` is in, if it's one of these. */
  around(element: Element): ThreadHost | undefined {
    const found = element.closest<HTMLElement>('.lo-diffthread__thread');
    const host =
      found?.dataset.threadId === undefined ? undefined : this.get(found.dataset.threadId);
    return host?.dom === found ? host : undefined;
  }

  /**
   * The element for `thread`, made if it's new, given what the caller says of it now: at the
   * reader's asking, if `asked`. Says whether a thread drawn already is drawn again.
   */
  take(thread: ThreadView, asked = false): boolean {
    const host = this.#hosts.get(thread.id);
    if (host) return host.give(thread, asked);
    const made = new ThreadHost(thread);
    this.#hosts.set(thread.id, made);
    this.#byHost.set(made.host, made);
    this.#watcher().observe(made.host);
    return false;
  }

  /** Takes down the threads `gone` says are gone. */
  drop(gone: (host: ThreadHost) => boolean): void {
    for (const host of this.#hosts.values()) {
      if (!gone(host)) continue;
      this.#hosts.delete(host.id);
      this.#observer?.unobserve(host.host);
      host.destroy();
    }
  }

  /** Has the caller draw `host`, the first time it's drawn. */
  draw(host: ThreadHost): void {
    host.draw(this.render);
  }

  /**
   * The threads whose content changed size while drawn, in `entries`, each kept at the height it
   * had until it's let go. A thread's content that's
   * just been drawn, after its line was off screen or in the other layout, isn't a change: its
   * editor measures it as it draws it, and from then on it's kept at that height. One held stays
   * as it is, and takes its content's height when it's let go.
   */
  resized(entries: readonly ResizeObserverEntry[]): Resized[] {
    const threads: Resized[] = [];
    for (const entry of entries) {
      const host = this.#byHost.get(entry.target);
      if (!host) continue;
      if (!host.host.isConnected || host.host.getClientRects().length === 0) {
        host.drawn = false;
        host.unpin();
        continue;
      }
      const size = entry.borderBoxSize[0];
      const rect = size ? undefined : host.host.getBoundingClientRect();
      const height = size?.blockSize ?? rect!.height;
      const width = size?.inlineSize ?? rect!.width;
      const { pinned, fresh } = host;
      const reflowed = host.width !== undefined && Math.abs(width - host.width) >= 0.5;
      if (height > 0) host.fresh = false;
      host.measured(height, width);
      if (!host.drawn || pinned === undefined) {
        host.drawn = true;
        host.pin(height);
        continue;
      }
      if (Math.abs(height - pinned) < 0.5 || host.held) continue;
      threads.push({ host, fresh, reflowed });
    }
    return threads;
  }

  #watcher(): ResizeObserver {
    this.#observer ??= new ResizeObserver((entries) => this.#resized(entries));
    return this.#observer;
  }

  destroy(): void {
    this.#observer?.disconnect();
    for (const host of this.#hosts.values()) host.destroy();
    this.#hosts.clear();
  }
}

/** Whether a thread draws the same: its version, whether it's open, and its line or file. */
function sameThread(a: ThreadView, b: ThreadView): boolean {
  const [at, other] = [a.at, b.at];
  const sameLine =
    'line' in at
      ? 'line' in other && at.side === other.side && at.line === other.line
      : !('line' in other);
  return a.version === b.version && a.open === b.open && at.file === other.file && sameLine;
}
