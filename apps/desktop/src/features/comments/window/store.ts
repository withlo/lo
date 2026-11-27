// The window's posts: their HTML as main read it, their trees as the background process made them,
// and the text of the comments the window itself sent or saved, for each view of a pull request's
// tab, each forgotten as its tab closes.

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
const written = new Map<string, string[]>();

/** How many comments' text the window keeps of each view's that it sent or saved: the newest. */
const WRITTEN_KEPT = 50;

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

/** A comment's text to compare, as GitHub may give back what was sent: line ends alike, trimmed. */
function plain(text: string): string {
  return text.replaceAll(/\r\n?/g, '\n').trim();
}

/**
 * Notes that the window sent or saved a comment of `text` on view `view`, which then shows its text
 * from the moment it's sent until its card from GitHub is drawn: that card's text isn't held back
 * for GitHub's rendering, so it never leaves the screen.
 */
export function wroteText(view: string, text: string): void {
  const own = written.get(view) ?? [];
  const kept = plain(text);
  written.set(view, [...own.filter((each) => each !== kept), kept].slice(-WRITTEN_KEPT));
}

/** Whether the window sent or saved a comment of `text` on view `view`, of those it keeps. */
export function wroteHere(view: string, text: string): boolean {
  return written.get(view)?.includes(plain(text)) ?? false;
}

/** Forgets the posts of every view but those in `kept`, as their tabs close. */
export function keepOnly(kept: ReadonlySet<string>): void {
  bodies.keepOnly(kept);
  for (const view of drawn.keys()) if (!kept.has(view)) drawn.delete(view);
  for (const view of written.keys()) if (!kept.has(view)) written.delete(view);
}
