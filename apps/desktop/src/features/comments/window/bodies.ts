// Posts' HTML in the window, as main read it from GitHub for each view of a pull request's tab: in
// the window's memory only, never kept anywhere else, since its images' addresses are signed for a
// few minutes. Posts are asked for as they come on screen or near it, a hundred at most an ask, one
// ask at a time for each view, so posts that come on screen together go in one read. A post whose
// images are on screen is asked for again once its HTML is `STALE_AFTER` old, before their
// addresses lapse. An ask that fails is tried again after a wait that doubles each time, as long
// as the posts are still wanted.

import { POSTS_AN_ASK, type Bodies } from '../contract.ts';

/** A post: a comment's, a review's or a review comment's, by its node ID, or the description. */
export type PostRef =
  { readonly kind: 'description' } | { readonly kind: 'post'; readonly id: string };

/** A post's HTML as main read it, and when, in milliseconds since the Unix epoch. */
export interface Held {
  readonly html: string;
  readonly at: number;
}

/** How old a post's HTML is when its images on screen ask for it again: GitHub signs them for 5. */
export const STALE_AFTER = 4 * 60_000;

/** The first wait after an ask fails, which doubles each time, up to {@link LONGEST_WAIT}. */
export const FIRST_WAIT = 5_000;
export const LONGEST_WAIT = 2 * 60_000;

/** The key a post goes by: its node ID, or a key no node ID can be for the description. */
function keyOf(post: PostRef): string {
  return post.kind === 'description' ? '#description' : post.id;
}

/** Asks main for posts' HTML on view `view`. */
export type Ask = (view: string, posts: string[], description: boolean) => Promise<Bodies>;

export interface BodyStoreOptions {
  readonly ask: Ask;
  readonly now?: (() => number) | undefined;
  /** Runs `run` after `wait` milliseconds, and returns what cancels it. */
  readonly later?: ((run: () => void, wait: number) => () => void) | undefined;
  readonly log?: ((line: string) => void) | undefined;
}

/** What the window has of one view's posts. */
interface ViewBodies {
  readonly held: Map<string, Held>;
  /** Posts GitHub gave nothing for: deleted since, or not ones the account can see. */
  readonly gone: Set<string>;
  /** Posts to ask for at the next ask. */
  readonly wanted: Set<string>;
  readonly listeners: Map<string, Set<() => void>>;
  /** Whether an ask is under way. */
  asking: boolean;
  /** Cancels the next ask's wait, while one is waiting. */
  waiting: (() => void) | undefined;
  /** How many asks failed in a row. */
  failures: number;
}

export class BodyStore {
  readonly #views = new Map<string, ViewBodies>();
  readonly #ask: Ask;
  readonly #now: () => number;
  readonly #later: (run: () => void, wait: number) => () => void;
  readonly #log: (line: string) => void;

  constructor({ ask, now, later, log }: BodyStoreOptions) {
    this.#ask = ask;
    this.#now = now ?? Date.now;
    this.#later =
      later ??
      ((run, wait) => {
        const timer = setTimeout(run, wait);
        return () => clearTimeout(timer);
      });
    this.#log = log ?? ((line) => console.error(line));
  }

  /** The HTML the window holds of `post` on view `view`, if any. */
  held(view: string, post: PostRef): Held | undefined {
    return this.#views.get(view)?.held.get(keyOf(post));
  }

  /** Whether GitHub gave nothing for `post`, so it shows from its Markdown. */
  gone(view: string, post: PostRef): boolean {
    return this.#views.get(view)?.gone.has(keyOf(post)) ?? false;
  }

  /** Asks for `post`'s HTML soon, unless the window holds it or GitHub gave none for it. */
  want(view: string, post: PostRef): void {
    const bodies = this.#viewOf(view);
    const key = keyOf(post);
    if (bodies.held.has(key) || bodies.gone.has(key)) return;
    this.#queue(view, bodies, key);
  }

  /** Asks for `post`'s HTML again soon, though the window holds it, for new image addresses. */
  again(view: string, post: PostRef): void {
    this.#queue(view, this.#viewOf(view), keyOf(post));
  }

  /** Calls `listener` each time what the window has of `post` changes, until the returned function. */
  subscribe(view: string, post: PostRef, listener: () => void): () => void {
    const { listeners } = this.#viewOf(view);
    const key = keyOf(post);
    const own = listeners.get(key) ?? new Set();
    listeners.set(key, own);
    own.add(listener);
    return () => {
      own.delete(listener);
      if (own.size === 0 && listeners.get(key) === own) listeners.delete(key);
    };
  }

  /** Forgets every view but those in `kept`, as their tabs close. */
  keepOnly(kept: ReadonlySet<string>): void {
    for (const [view, bodies] of this.#views) {
      if (kept.has(view)) continue;
      bodies.waiting?.();
      this.#views.delete(view);
    }
  }

  #viewOf(view: string): ViewBodies {
    let bodies = this.#views.get(view);
    if (!bodies) {
      bodies = {
        held: new Map(),
        gone: new Set(),
        wanted: new Set(),
        listeners: new Map(),
        asking: false,
        waiting: undefined,
        failures: 0,
      };
      this.#views.set(view, bodies);
    }
    return bodies;
  }

  /** Wants `key` at the next ask, which waits a moment so posts shown together go together. */
  #queue(view: string, bodies: ViewBodies, key: string): void {
    if (bodies.wanted.has(key)) return;
    bodies.wanted.add(key);
    if (bodies.asking || bodies.waiting) return;
    bodies.waiting = this.#later(() => {
      bodies.waiting = undefined;
      this.#send(view, bodies);
    }, 0);
  }

  /** Asks for what's wanted, a hundred posts at most, and then for the rest. */
  #send(view: string, bodies: ViewBodies): void {
    if (bodies.asking || this.#views.get(view) !== bodies) return;
    const description = bodies.wanted.delete('#description');
    const posts = [...bodies.wanted].slice(0, POSTS_AN_ASK);
    if (posts.length === 0 && !description) return;
    for (const post of posts) bodies.wanted.delete(post);
    bodies.asking = true;
    const asked = description ? [...posts, '#description'] : posts;
    this.#ask(view, posts, description).then(
      (answer) => {
        bodies.asking = false;
        bodies.failures = 0;
        this.#took(bodies, asked, answer);
        if (this.#views.get(view) === bodies && bodies.wanted.size > 0) this.#send(view, bodies);
      },
      (error: unknown) => {
        bodies.asking = false;
        bodies.failures += 1;
        // What was asked is wanted still, unless the window has since had it.
        for (const key of asked) bodies.wanted.add(key);
        const wait = Math.min(LONGEST_WAIT, FIRST_WAIT * 2 ** (bodies.failures - 1));
        this.#log(
          `Lo couldn't read posts' HTML, and tries again in ${wait / 1000} s: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (this.#views.get(view) !== bodies) return;
        bodies.waiting = this.#later(() => {
          bodies.waiting = undefined;
          this.#send(view, bodies);
        }, wait);
      },
    );
  }

  /** Takes main's answer to an ask for `asked`. */
  #took(bodies: ViewBodies, asked: readonly string[], answer: Bodies): void {
    const at = this.#now();
    const changed = new Set<string>();
    if (asked.includes('#description')) {
      if (answer.description === null) bodies.gone.add('#description');
      else bodies.held.set('#description', { html: answer.description, at });
      changed.add('#description');
    }
    const askedPosts = new Set(asked);
    for (const { id, html } of answer.posts) {
      if (!askedPosts.has(id)) continue;
      bodies.held.set(id, { html, at });
      bodies.gone.delete(id);
      changed.add(id);
    }
    for (const id of answer.gone) {
      if (!askedPosts.has(id)) continue;
      bodies.held.delete(id);
      bodies.gone.add(id);
      changed.add(id);
    }
    for (const key of changed) {
      for (const listener of bodies.listeners.get(key) ?? []) {
        try {
          listener();
        } catch (error) {
          this.#log(`A post's listener failed: ${String(error)}`);
        }
      }
    }
  }
}
