// A post's text: a comment's, a review's, a review comment's or a pull request's description, drawn
// from GitHub's rendering of it, as GitHub's page shows it, and from its Markdown until that's
// there, so it's never blank. Its HTML is asked for as it comes near the screen, and again, while
// its images are on screen, before their addresses lapse. The background process makes the tree;
// its images load through main, as the view's account, and links open through main.

import { Markdown, secureLink, type Followed } from '@lo/ui/markdown';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';

import { postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import { HTML_LIMIT, MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { STALE_AFTER, type PostRef } from './bodies.ts';
import { commentsJobs } from './main.ts';
import { seen, watchNear } from './near.ts';
import { bodies, drawnOf, keepDrawn } from './store.ts';

/** A pull request on github.com. */
export interface PostPull {
  readonly owner: string;
  readonly repo: string;
  readonly number: number;
}

export interface PostProps {
  /** The view of a pull request's tab the post is shown in, whose account reads its HTML. */
  readonly view: string;
  readonly post: PostRef;
  /** Its Markdown, as GitHub gave it with what was read about it. */
  readonly markdown: string;
  /** The pull request it's on, which its references and relative links are read against. */
  readonly pull: PostPull;
}

/**
 * The HTML the window holds of `post` at `version`, its Markdown now, re-rendering as it changes:
 * none once the post is edited, until it's read again.
 */
function useHeld(view: string, post: PostRef, version: string) {
  const subscribe = useCallback(
    (listener: () => void) => bodies.subscribe(view, post, listener),
    [view, post],
  );
  return useSyncExternalStore(subscribe, () => bodies.held(view, post, version));
}

/** Opens a link followed in a post: an `https` page through main, a pull request in its tab. */
function follow(target: Followed): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

/** How often a post whose images are on screen, but hidden, looks again to read its HTML. */
const HIDDEN_RECHECK = 30_000;

export function Post({ view, post: given, markdown, pull }: PostProps) {
  const element = useRef<HTMLDivElement>(null);
  const key = given.kind === 'post' ? given.id : '#description';
  // A post is the same post however its object was made.
  const post = useMemo<PostRef>(
    () => (key === '#description' ? { kind: 'description' } : { kind: 'post', id: key }),
    [key],
  );
  const text = markdown.slice(0, MARKDOWN_LIMIT);
  const held = useHeld(view, post, text);
  const html = held !== undefined && held.html.length <= HTML_LIMIT ? held.html : null;
  const { owner, repo, number } = pull;
  const [made, setMade] = useState(() => drawnOf(view, post));
  const [near, setNear] = useState(false);
  const image = useCallback((url: string) => postImage(view, url), [view]);

  // Its tree, made anew from its HTML once that's there, or from its Markdown; the one before
  // stays until the new one is made, unless the post was edited since: then its new Markdown shows
  // at once, as text.
  useEffect(() => {
    const kept = drawnOf(view, post);
    if (kept && kept.html === html && kept.markdown === text) {
      setMade(kept);
      return undefined;
    }
    const stop = new AbortController();
    const page = `https://github.com/${owner}/${repo}/pull/${number}`;
    commentsJobs()
      .render({ html, markdown: text, repo: { owner, name: repo }, page }, { signal: stop.signal })
      .then((rendered: Rendered) => {
        if (stop.signal.aborted) return;
        const next = { html, markdown: text, rendered };
        keepDrawn(view, post, next);
        setMade(next);
      })
      .catch((error: unknown) => {
        if (stop.signal.aborted) return;
        console.error("Lo couldn't draw a post:", error);
      });
    return () => stop.abort();
  }, [view, post, html, text, owner, repo, number]);

  const shown = made?.markdown === text ? made : undefined;

  // Whether it's on screen or near it, which asks for its HTML.
  useEffect(() => {
    const own = element.current;
    return own ? watchNear(own, setNear) : undefined;
  }, []);
  useEffect(() => {
    if (near) bodies.want(view, post, text);
  }, [near, view, post, text]);

  // While its images are on screen, its HTML is read again before their addresses lapse: once
  // it's seen again, if it's hidden then, as in a middle view another has replaced.
  const images = shown !== undefined && shown.html !== null && shown.rendered.images;
  const readAt = held?.at;
  useEffect(() => {
    if (!near || !images || readAt === undefined) return undefined;
    let timer: ReturnType<typeof setTimeout>;
    const check = () => {
      if (seen(element.current)) bodies.again(view, post, text);
      else timer = setTimeout(check, HIDDEN_RECHECK);
    };
    timer = setTimeout(check, Math.max(0, readAt + STALE_AFTER - Date.now()));
    return () => clearTimeout(timer);
  }, [near, images, readAt, view, post, text]);

  return (
    <div ref={element} data-lo-post={key}>
      {shown ? (
        <Markdown
          tree={shown.rendered.tree}
          onFollow={follow}
          images={image}
          className="lo-prose read-comment"
        />
      ) : (
        <p className="whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}
