// The window's posts: their HTML as main read it, their trees as the background process made them,
// and how tall each was last drawn from GitHub's rendering, for each view of a pull request's tab,
// each forgotten as its tab closes.

import type { Rendered } from '../jobs.ts';
import { BodyStore, type PostRef } from './bodies.ts';
import { main } from './main.ts';

/** Posts' HTML, in the window's memory only. */
export const bodies = new BodyStore({
  ask: (view, posts, description) => main().bodies({ id: view, posts, description }),
  log: (line) => console.error(line),
});

/** A post's tree, and what it was made from. */
export interface Drawn {
  readonly html: string | null;
  readonly markdown: string;
  readonly rendered: Rendered;
}

const drawn = new Map<string, Map<string, Drawn>>();
const heights = new Map<string, Map<string, number>>();

function keyOf(post: PostRef): string {
  return post.kind === 'description' ? '#description' : post.id;
}

/** The tree last made for `post` on view `view`, so a post drawn again needn't wait for one. */
export function drawnOf(view: string, post: PostRef): Drawn | undefined {
  return drawn.get(view)?.get(keyOf(post));
}

/** `view`'s own map in `all`, made as it's first needed. */
function ownOf<T>(all: Map<string, Map<string, T>>, view: string): Map<string, T> {
  let own = all.get(view);
  if (!own) {
    own = new Map();
    all.set(view, own);
  }
  return own;
}

/** Keeps the tree made for `post` on view `view`. */
export function keepDrawn(view: string, post: PostRef, made: Drawn): void {
  ownOf(drawn, view).set(keyOf(post), made);
}

/**
 * How tall `post` on view `view` was last drawn from GitHub's rendering, in pixels, so it can hold
 * that room while its rendering of an edit comes.
 */
export function heightOf(view: string, post: PostRef): number | undefined {
  return heights.get(view)?.get(keyOf(post));
}

/** Keeps how tall `post` on view `view` is, drawn from GitHub's rendering. */
export function keepHeight(view: string, post: PostRef, height: number): void {
  ownOf(heights, view).set(keyOf(post), height);
}

/** Forgets the posts of every view but those in `kept`, as their tabs close. */
export function keepOnly(kept: ReadonlySet<string>): void {
  bodies.keepOnly(kept);
  for (const view of drawn.keys()) if (!kept.has(view)) drawn.delete(view);
  for (const view of heights.keys()) if (!kept.has(view)) heights.delete(view);
}
