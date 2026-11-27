// A post's text: a comment's, a review's, a review comment's or a pull request's description, drawn
// from GitHub's rendering of it, as GitHub's page shows it, and from its Markdown until that's
// there, so it's never blank. Where the tree of its Markdown shows raw HTML, a tag that only
// GitHub's rendering draws, it doesn't show that tree: three skeleton lines hold its place until
// its rendering is in, which takes theirs in one Swap. Markdown that may hold a tag waits so too
// until its tree says. It shows its Markdown all the same when the window sent or saved its text,
// or when no rendering is coming. Its HTML is asked for as it comes near the screen, and again,
// while its images are on screen, before their addresses lapse. The background process makes the
// tree, tried again when the process restarts, is busy or doesn't answer; its images load through
// main, as the view's account, and links open through main.

import { mayHoldHtml } from '@lo/markdown';
import { Skeleton, Swap } from '@lo/ui';
import { Markdown, secureLink, type Followed } from '@lo/ui/markdown';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

import { IpcError } from '../../../ipc/contract.ts';
import { postImage } from '../../../window/images.ts';
import { followLink } from '../../open/window/shared.ts';
import { HTML_LIMIT, MARKDOWN_LIMIT, type Rendered } from '../jobs.ts';
import { STALE_AFTER, type PostRef } from './bodies.ts';
import { commentsJobs } from './main.ts';
import { seen, watchNear } from './near.ts';
import { bodies, drawnOf, keepDrawn, wroteHere } from './store.ts';

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
  /**
   * The lines a suggested change in it replaces, as the diff shows them, for while it's drawn from
   * its Markdown: GitHub's HTML says so itself.
   */
  readonly replaced?: string | undefined;
}

/**
 * The HTML the window holds of `post` at `version`, its Markdown now, re-rendering as it changes:
 * none once the post is edited, until it's read again. And whether none is on its way for now:
 * GitHub gave none, or the read failed.
 */
function useHeld(view: string, post: PostRef, version: string) {
  const subscribe = useCallback(
    (listener: () => void) => bodies.subscribe(view, post, listener),
    [view, post],
  );
  const held = useSyncExternalStore(subscribe, () => bodies.held(view, post, version));
  const missing = useSyncExternalStore(subscribe, () => bodies.missing(view, post, version));
  return { held, missing };
}

/** One observer for the height of every post drawn from GitHub's rendering, and what each notes. */
let sizes: ResizeObserver | undefined;
const measured = new WeakMap<Element, (height: number) => void>();

/**
 * Calls `keep` with `element`'s height as it's laid out and each time it changes, until the
 * returned function is called.
 */
function watchHeight(element: Element, keep: (height: number) => void): () => void {
  if (typeof ResizeObserver === 'undefined') return () => {};
  sizes ??= new ResizeObserver((entries) => {
    for (const { target, borderBoxSize } of entries) {
      const height = borderBoxSize[0]?.blockSize;
      if (height !== undefined) measured.get(target)?.(height);
    }
  });
  const watching = sizes;
  measured.set(element, keep);
  watching.observe(element);
  return () => {
    watching.unobserve(element);
    measured.delete(element);
  };
}

/** How wide each line is that holds a post's place while its rendering comes. */
const LINES = ['w-full', 'w-full', 'w-3/5'] as const;

/** Where a post's text goes while GitHub's rendering of it comes: three lines, its line high. */
function Waiting() {
  return LINES.map((width, line) => (
    <div key={line} className="flex h-1lh items-center">
      <Skeleton className={width} />
    </div>
  ));
}

/** Opens a link followed in a post: an `https` page through main, a pull request in its tab. */
function follow(target: Followed): void {
  if (target.kind !== 'web') return;
  const url = secureLink(target.url);
  if (url !== undefined) void followLink(url);
}

/** How often a post whose images are on screen, but hidden, looks again to read its HTML. */
const HIDDEN_RECHECK = 30_000;

/**
 * How a tree's job can fail and still work when tried again: the background process restarted, was
 * busy, or didn't answer.
 */
const PASSING = new Set(['restarted', 'busy', 'unanswered']);

/** The wait before a tree is asked for again after a passing failure, which doubles each time. */
export const FIRST_RETRY = 1_000;

/** How many times a tree is asked for again after passing failures, before it's taken as failed. */
export const RETRIES = 4;

/**
 * The trees a post couldn't make: from its HTML, with the Markdown it was made with, when it's made
 * from its Markdown instead; and from its Markdown, which then shows as its text.
 */
interface Failed {
  readonly html?: { readonly html: string; readonly markdown: string };
  readonly markdown?: string;
}

export function Post({ view, post: given, markdown, pull, replaced }: PostProps) {
  const element = useRef<HTMLDivElement>(null);
  const key = given.kind === 'post' ? given.id : '#description';
  // A post is the same post however its object was made.
  const post = useMemo<PostRef>(
    () => (key === '#description' ? { kind: 'description' } : { kind: 'post', id: key }),
    [key],
  );
  const text = markdown.slice(0, MARKDOWN_LIMIT);
  const { held, missing } = useHeld(view, post, text);
  const html = held !== undefined && held.html.length <= HTML_LIMIT ? held.html : null;
  const { owner, repo, number } = pull;
  const [made, setMade] = useState(() => drawnOf(view, post));
  const [near, setNear] = useState(false);
  const image = useCallback((url: string) => postImage(view, url), [view]);
  // What it couldn't make a tree of: from its HTML, it's made from its Markdown instead.
  const [failed, setFailed] = useState<Failed>({});
  const htmlFailed = failed.html?.html === html && failed.html?.markdown === text;
  const from = htmlFailed ? null : html;
  const markdownFailed = from === null && failed.markdown === text;
  // After a passing failure, the tree is asked for again: how many times so far, of what, and each
  // time.
  const tries = useRef<{
    readonly from: string | null;
    readonly text: string;
    readonly count: number;
  }>(undefined);
  const [retry, setRetry] = useState(0);

  // Its tree, made anew from its HTML once that's there, or from its Markdown; the one before
  // stays until the new one is made, unless the post was edited since: then its new Markdown shows
  // at once, as text.
  useEffect(() => {
    const kept = drawnOf(view, post);
    if (kept && kept.html === from && kept.markdown === text) {
      setMade(kept);
      return undefined;
    }
    if (markdownFailed) return undefined;
    const stop = new AbortController();
    let again: ReturnType<typeof setTimeout> | undefined;
    const page = `https://github.com/${owner}/${repo}/pull/${number}`;
    commentsJobs()
      .render(
        { html: from, markdown: text, repo: { owner, name: repo }, page },
        { signal: stop.signal },
      )
      .then((rendered: Rendered) => {
        if (stop.signal.aborted) return;
        const next = { html: from, markdown: text, rendered };
        keepDrawn(view, post, next);
        setMade(next);
      })
      .catch((error: unknown) => {
        if (stop.signal.aborted) return;
        const last = tries.current;
        const count = last?.from === from && last.text === text ? last.count : 0;
        if (error instanceof IpcError && PASSING.has(error.code) && count < RETRIES) {
          tries.current = { from, text, count: count + 1 };
          again = setTimeout(() => setRetry((times) => times + 1), FIRST_RETRY * 2 ** count);
          return;
        }
        console.error("Lo couldn't draw a post:", error);
        setFailed((before) =>
          from === null
            ? { ...before, markdown: text }
            : { ...before, html: { html: from, markdown: text } },
        );
      });
    return () => {
      stop.abort();
      clearTimeout(again);
    };
  }, [view, post, from, text, markdownFailed, retry, owner, repo, number]);

  const shown = made?.markdown === text ? made : undefined;

  // Whether what it would show holds raw HTML that only GitHub's rendering draws: as the tree of
  // its Markdown says, and, until that's made, if its Markdown may hold any.
  const may = useMemo(() => mayHoldHtml(text), [text]);
  const raw = shown === undefined ? may : shown.html === null && shown.rendered.tree.raw === true;
  // That waits for its tree from GitHub's rendering, unless the window sent or saved its text,
  // which showed until its card came, or no tree from that is coming: GitHub gave none, the read
  // failed, it's longer than Lo reads, or its tree couldn't be made.
  const wrote = useMemo(() => wroteHere(view, text), [view, text]);
  const coming = !missing && !htmlFailed && (held === undefined || html !== null);
  // Nor does it wait once it showed this text on screen or near it, before its rendering could
  // come: that stays until the tree from it takes its place, as a post's text without a tag does.
  const showing = useRef<string | undefined>(undefined);
  const waits = raw && coming && !wrote && showing.current !== text;
  useLayoutEffect(() => {
    if (waits) showing.current = undefined;
    else if (near) showing.current = text;
  }, [waits, near, text]);
  // Where it was drawn here from GitHub's rendering, as before an edit, it holds that room: as tall
  // as it was in this place, at this width.
  const height = useRef<number | undefined>(undefined);
  const room = waits ? height.current : undefined;
  const rendered = !waits && shown !== undefined && shown.html !== null;
  useLayoutEffect(() => {
    const own = element.current;
    if (!rendered || !own) return undefined;
    return watchHeight(own, (drawn) => {
      if (drawn > 0) height.current = drawn;
    });
  }, [rendered]);

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
    <div
      ref={element}
      data-lo-post={key}
      aria-busy={waits ? true : undefined}
      style={room === undefined ? undefined : { minHeight: room }}
    >
      <Swap id={waits ? 'waiting' : 'text'}>
        {waits ? (
          <Waiting />
        ) : shown ? (
          <Markdown
            tree={shown.rendered.tree}
            onFollow={follow}
            images={image}
            replaced={replaced}
            className="lo-prose lo-prose--comment read-comment"
          />
        ) : (
          <p className="whitespace-pre-wrap">{text}</p>
        )}
      </Swap>
    </div>
  );
}
