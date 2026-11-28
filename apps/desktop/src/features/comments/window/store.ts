// The window's posts: their HTML as main read it, their trees as the background process made them,
// and the text of the comments the window itself sent or saved, for each view of a pull request's
// tab, each forgotten as its tab closes.

import { MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { BodyStore, type PostRef } from './bodies.ts';
import { commentsJobs, main } from './main.ts';

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

/** The trees made of the comments the window sent or saved on each view, by their text. */
const writtenTrees = new Map<string, Map<string, Rendered>>();

/**
 * Keeps the tree made of a comment of `text` the window sent or saved on view `view`, as its sent
 * card drew it, so its card from GitHub draws the same from its first frame.
 */
export function keepWrittenTree(view: string, text: string, rendered: Rendered): void {
  const own = writtenTrees.get(view) ?? new Map<string, Rendered>();
  const kept = plain(text);
  own.delete(kept);
  own.set(kept, rendered);
  for (const key of own.keys()) {
    if (own.size <= WRITTEN_KEPT) break;
    own.delete(key);
  }
  writtenTrees.set(view, own);
}

/**
 * The tree its sent card drew of a comment of `text` the window sent or saved on view `view`, as a
 * tree of `text` made from no HTML, if it keeps one.
 */
export function writtenDrawn(view: string, text: string): Drawn | undefined {
  const rendered = wroteHere(view, text) ? writtenTrees.get(view)?.get(plain(text)) : undefined;
  return rendered && { html: null, markdown: text, rendered };
}

/** The pull request a comment is on, which its references and relative links are read against. */
interface OnPullRequest {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

/** Makes the tree of `text`, a post's Markdown on pull request `pull`, as one with no HTML. */
export function treeOf(text: string, pull: OnPullRequest, signal?: AbortSignal): Promise<Rendered> {
  const { owner, repo, number } = pull;
  return commentsJobs().render(
    {
      html: null,
      markdown: text.slice(0, MARKDOWN_LIMIT),
      repo: { owner, name: repo },
      page: `https://github.com/${owner}/${repo}/pull/${number}`,
    },
    { signal },
  );
}

/**
 * Notes that the window sends or saves a comment of `text` on view `view`, on pull request `pull`,
 * and makes its tree, unless it has it: what's sent then draws formatted from its first frame, and
 * its card from GitHub after it. Settles once the tree is kept, or couldn't be made, which draws
 * the text as it's written until its card makes its own.
 */
export async function drawWritten(view: string, text: string, pull: OnPullRequest): Promise<void> {
  wroteText(view, text);
  if (writtenDrawn(view, text)) return;
  try {
    keepWrittenTree(view, text, await treeOf(text, pull));
  } catch (error) {
    console.error("Lo couldn't draw a comment sent:", error);
  }
}

/** Forgets the posts of every view but those in `kept`, as their tabs close. */
export function keepOnly(kept: ReadonlySet<string>): void {
  bodies.keepOnly(kept);
  for (const view of drawn.keys()) if (!kept.has(view)) drawn.delete(view);
  for (const view of written.keys()) if (!kept.has(view)) written.delete(view);
  for (const view of writtenTrees.keys()) if (!kept.has(view)) writtenTrees.delete(view);
}
