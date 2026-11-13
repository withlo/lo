// Posts' HTML in the window, as main read it from GitHub for each view of a pull request's tab: in
// the window's memory only, never kept anywhere else, since its images' addresses are signed for a
// few minutes. Posts are asked for as they come on screen or near it, a hundred at most an ask, one
// ask at a time for each view, so posts that come on screen together go in one read. HTML is held
// for the version of the post it was asked for, its Markdown as the window has it: once the post is
// edited, its HTML is no longer the post's, so it shows from its new Markdown, and is asked for
// again. A post whose images are on screen is asked for again once its HTML is `STALE_AFTER` old,
// before their addresses lapse. An ask that fails is tried again after a wait that doubles each
// time, as long as the posts are still wanted.

import { POSTS_AN_ASK, type Bodies } from '../contract.ts';

/** A post: a comment's, a review's or a review comment's, by its node ID, or the description. */
export type PostRef =
  { readonly kind: 'description' } | { readonly kind: 'post'; readonly id: string };

/**
 * A post's HTML as main read it, when, in milliseconds since the Unix epoch, and the version of the
 * post it was asked for: its Markdown, as the window had it then.
 */
export interface Held {
  readonly html: string;
  readonly at: number;
  readonly version: string;
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
  /**
   * Posts GitHub gave nothing for, deleted since or not ones the account can see, with the version
   * each was asked for.
   */
  readonly gone: Map<string, string>;
  /** Posts to ask for at the next ask, with the version of each. */
  readonly wanted: Map<string, string>;
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

  /**
   * The HTML the window holds of `post` on view `view` at `version`, its Markdown as the window has
   * it now, if any: HTML read for another version is of a post since edited, and isn't its own.
   */
  held(view: string, post: PostRef, version: string): Held | undefined {
    const held = this.#views.get(view)?.held.get(keyOf(post));
    return held?.version === version ? held : undefined;
  }

  /** Whether GitHub gave nothing for `post` at `version`, so it shows from its Markdown. */
  gone(view: string, post: PostRef, version: string): boolean {
    return this.#views.get(view)?.gone.get(keyOf(post)) === version;
  }

  /**
   * Asks for `post`'s HTML at `version` soon, unless the window holds it for that version, or GitHub
   * gave none for it.
   */
  want(view: string, post: PostRef, version: string): void {
    const bodies = this.#viewOf(view);
    const key = keyOf(post);
    if (bodies.held.get(key)?.version === version || bodies.gone.get(key) === version) return;
    this.#queue(view, bodies, key, version);
  }

  /** Asks for `post`'s HTML again soon, though the window holds it, for new image addresses. */
  again(view: string, post: PostRef, version: string): void {
    this.#queue(view, this.#viewOf(view), keyOf(post), version);
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
        gone: new Map(),
        wanted: new Map(),
        listeners: new Map(),
        asking: false,
        waiting: undefined,
        failures: 0,
      };
      this.#views.set(view, bodies);
    }
    return bodies;
  }

  /**
   * Wants `key` at `version` at the next ask, which waits a moment so posts shown together go
   * together.
   */
  #queue(view: string, bodies: ViewBodies, key: string, version: string): void {
    const queued = bodies.wanted.has(key);
    bodies.wanted.set(key, version);
    if (queued || bodies.asking || bodies.waiting) return;
    bodies.waiting = this.#later(() => {
      bodies.waiting = undefined;
      this.#send(view, bodies);
    }, 0);
  }

  /** Asks for what's wanted, a hundred posts at most, and then for the rest. */
  #send(view: string, bodies: ViewBodies): void {
    if (bodies.asking || this.#views.get(view) !== bodies) return;
    const asked = new Map<string, string>();
    let posts = 0;
    for (const [key, version] of bodies.wanted) {
      if (key !== '#description') {
        if (posts >= POSTS_AN_ASK) continue;
        posts += 1;
      }
      asked.set(key, version);
    }
    if (asked.size === 0) return;
    for (const key of asked.keys()) bodies.wanted.delete(key);
    const description = asked.has('#description');
    bodies.asking = true;
    this.#ask(
      view,
      [...asked.keys()].filter((key) => key !== '#description'),
      description,
    ).then(
      (answer) => {
        bodies.asking = false;
        bodies.failures = 0;
        this.#took(bodies, asked, answer);
        if (this.#views.get(view) === bodies && bodies.wanted.size > 0) this.#send(view, bodies);
      },
      (error: unknown) => {
        bodies.asking = false;
        bodies.failures += 1;
        // What was asked is wanted still, unless a newer version of it is wanted since.
        for (const [key, version] of asked) {
          if (!bodies.wanted.has(key)) bodies.wanted.set(key, version);
        }
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

  /** Takes main's answer to an ask for `asked`, each post at the version it was asked for. */
  #took(bodies: ViewBodies, asked: ReadonlyMap<string, string>, answer: Bodies): void {
    const at = this.#now();
    const changed = new Set<string>();
    const hold = (key: string, html: string | null) => {
      const version = asked.get(key);
      if (version === undefined) return;
      if (html === null) {
        bodies.held.delete(key);
        bodies.gone.set(key, version);
      } else {
        bodies.held.set(key, { html, at, version });
        bodies.gone.delete(key);
      }
      changed.add(key);
    };
    if (asked.has('#description')) hold('#description', answer.description);
    for (const { id, html } of answer.posts) if (id !== '#description') hold(id, html);
    for (const id of answer.gone) if (id !== '#description') hold(id, null);
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
