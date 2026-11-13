// The window's posts: their HTML as main read it, and their trees as the background process made
// them, for each view of a pull request's tab, each forgotten as its tab closes.

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

function keyOf(post: PostRef): string {
  return post.kind === 'description' ? '#description' : post.id;
}

/** The tree last made for `post` on view `view`, so a post drawn again needn't wait for one. */
export function drawnOf(view: string, post: PostRef): Drawn | undefined {
  return drawn.get(view)?.get(keyOf(post));
}

/** Keeps the tree made for `post` on view `view`. */
export function keepDrawn(view: string, post: PostRef, made: Drawn): void {
  let own = drawn.get(view);
  if (!own) {
    own = new Map();
    drawn.set(view, own);
  }
  own.set(keyOf(post), made);
}

/** Forgets the posts of every view but those in `kept`, as their tabs close. */
export function keepOnly(kept: ReadonlySet<string>): void {
  bodies.keepOnly(kept);
  for (const view of drawn.keys()) if (!kept.has(view)) drawn.delete(view);
}
