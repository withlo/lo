// @vitest-environment jsdom
// A post's text: drawn from its Markdown until GitHub's rendering of it is in, unless the tree of
// its Markdown shows a tag, which only GitHub's rendering draws: then three skeleton lines hold its
// place, and its rendering takes theirs in one Swap.

import { githubTree, markdownTree } from '@lo/markdown';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, onTestFinished, test, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Bodies } from '../contract.ts';
import { HTML_LIMIT, type RenderInput, type Rendered } from '../jobs.ts';
import { FIRST_WAIT } from './bodies.ts';
import { FIRST_RETRY, Post, RETRIES } from './Post.tsx';
import { keepOnly, wroteText } from './store.ts';

/**
 * What the test does with each ask for posts' HTML, each tree asked of the background, and what a
 * tree's job fails with, if it does.
 */
const fake = vi.hoisted(() => ({
  ask: undefined as ((posts: string[]) => Promise<Bodies>) | undefined,
  renders: [] as RenderInput[],
  failing: undefined as ((input: RenderInput) => Error | undefined) | undefined,
}));

vi.mock('./main.ts', () => ({
  main: () => ({
    bodies: ({ posts }: { posts: string[] }) =>
      fake.ask?.(posts) ?? new Promise<Bodies>(() => undefined),
  }),
  commentsJobs: () => ({
    render: (input: RenderInput): Promise<Rendered> => {
      fake.renders.push(input);
      const error = fake.failing?.(input);
      if (error) return Promise.reject(error);
      const options = { repo: { owner: 'rozed-dev', name: 'e2e' }, page: input.page };
      const tree =
        input.html === null
          ? markdownTree(input.markdown, options)
          : githubTree({ html: input.html, markdown: input.markdown }, options);
      return Promise.resolve({ tree, images: false });
    },
  }),
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(() => {
  fake.ask = undefined;
  fake.renders = [];
  fake.failing = undefined;
});

afterEach(() => {
  // Each test starts with a window that holds no post.
  keepOnly(new Set());
});

const PULL = { owner: 'rozed-dev', repo: 'e2e', number: 94 };

/** A review's text with tags in it, as a bot writes one. */
const TAGGED = '<sup>Reviewed by **Bugbot** for commit 73ae3d3.</sup>';
const RENDERED = '<p><sup>Reviewed by <strong>Bugbot</strong> for commit 73ae3d3.</sup></p>';
/** Its words as Lo's reading of its Markdown draws them: its tags as written. */
const AS_WRITTEN = '<sup>Reviewed by Bugbot for commit 73ae3d3.</sup>';

/** Lets what's waiting run: the store's ask, its answer, and the tree from the background. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** Draws post `id` on view `v1` with `markdown`, and what draws it again with other Markdown. */
function drawn(markdown: string, id = 'P1') {
  const element = document.createElement('div');
  document.body.append(element);
  const root: Root = createRoot(element);
  const draw = (text: string) =>
    act(() =>
      root.render(<Post view="v1" post={{ kind: 'post', id }} markdown={text} pull={PULL} />),
    );
  draw(markdown);
  let gone = false;
  const unmount = () => {
    if (gone) return;
    gone = true;
    act(() => root.unmount());
    element.remove();
  };
  onTestFinished(unmount);
  return { element, post: element.querySelector('[data-lo-post]'), draw, unmount };
}

/** How many skeleton lines `post` has drawn from now on, those it shows now included. */
function linesFrom(post: Element | null): () => number {
  let lines = post?.querySelectorAll('.skeleton').length ?? 0;
  const watching = new MutationObserver((changes) => {
    for (const { addedNodes } of changes) {
      for (const node of addedNodes) {
        if (node instanceof Element) lines += node.querySelectorAll('.skeleton').length;
      }
    }
  });
  if (post) watching.observe(post, { childList: true, subtree: true });
  onTestFinished(() => watching.disconnect());
  return () => lines;
}

/** Lets what's waiting run, with the clock faked, `ms` on. */
async function pass(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** What each tree asked of the background was made from, in order. */
function sources(): ('markdown' | 'html')[] {
  return fake.renders.map((input) => (input.html === null ? 'markdown' : 'html'));
}

/** Every text `post` has shown from now on, as each change to it left it. */
function textsFrom(post: Element | null): () => string[] {
  const texts = [post?.textContent ?? ''];
  const watching = new MutationObserver(() => texts.push(post?.textContent ?? ''));
  if (post) watching.observe(post, { childList: true, subtree: true, characterData: true });
  onTestFinished(() => watching.disconnect());
  return () => texts;
}

/** Puts in an observer that has posts near the screen only once `near` says, and returns `near`. */
function stubNear(): (post: Element | null, near: boolean) => void {
  const watched = new Map<Element, { callback: IntersectionObserverCallback; by: Watcher }>();
  class Watcher implements IntersectionObserver {
    readonly root = null;
    readonly rootMargin = '';
    readonly scrollMargin = '';
    readonly thresholds = [];
    readonly #callback: IntersectionObserverCallback;
    constructor(callback: IntersectionObserverCallback) {
      this.#callback = callback;
    }
    observe(target: Element) {
      watched.set(target, { callback: this.#callback, by: this });
    }
    unobserve(target: Element) {
      watched.delete(target);
    }
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  vi.stubGlobal('IntersectionObserver', Watcher);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  return (post, near) => {
    const found = post ? watched.get(post) : undefined;
    if (!post || !found) throw new Error('That post isn’t watched.');
    const rect = new DOMRectReadOnly();
    const entry: IntersectionObserverEntry = {
      target: post,
      isIntersecting: near,
      intersectionRatio: near ? 1 : 0,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
      time: 0,
    };
    act(() => found.callback([entry], found.by));
  };
}

/** Answers each ask with `html` for every post asked for. */
function answering(html: string): (posts: string[]) => Promise<Bodies> {
  return (posts) =>
    Promise.resolve({ description: null, posts: posts.map((id) => ({ id, html })), gone: [] });
}

test('a post whose Markdown holds a tag holds three skeleton lines, then its rendering in one Swap', async () => {
  let answer: (() => void) | undefined;
  fake.ask = (posts) =>
    new Promise((resolve) => {
      answer = () => void answering(RENDERED)(posts).then(resolve);
    });
  const { element } = drawn(TAGGED);
  const post = element.querySelector('[data-lo-post]');
  // Never its source: three lines at its line height, the last shorter, while it's busy.
  expect(post?.textContent).toBe('');
  expect(post?.getAttribute('aria-busy')).toBe('true');
  const lines = [...(post?.querySelectorAll('.skeleton') ?? [])];
  expect(lines.map((line) => line.className)).toEqual([
    'skeleton w-full',
    'skeleton w-full',
    'skeleton w-3/5',
  ]);
  expect(lines.every((line) => line.parentElement?.classList.contains('h-1lh'))).toBe(true);
  await settle();
  // Asked for, not answered yet: still the lines, though the tree of its Markdown is made, which
  // says it shows a tag.
  expect(answer).toBeDefined();
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  expect(sources()).toEqual(['markdown']);

  answer?.();
  await settle();
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.hasAttribute('aria-busy')).toBe(false);
  expect(post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(post?.querySelector('sup strong')?.textContent).toBe('Bugbot');
  // Its rendering fades in over where the lines were.
  expect(post?.firstElementChild?.classList.contains('move-swap')).toBe(true);
});

test('a post with no tag shows its Markdown at once, and its rendering in its place, with no Swap', async () => {
  fake.ask = answering('<p>Plain <strong>words</strong>, rendered.</p>');
  const { element } = drawn('Plain **words**.');
  const post = element.querySelector('[data-lo-post]');
  expect(post?.textContent).toBe('Plain **words**.');
  expect(post?.querySelector('.skeleton')).toBeNull();
  await settle();
  expect(post?.textContent).toBe('Plain words, rendered.');
  expect(post?.querySelector('.move-swap')).toBeNull();
  expect(post?.hasAttribute('aria-busy')).toBe(false);
});

test('a post with a tag only in code holds its lines only until the tree of its Markdown says so', async () => {
  fake.ask = () => new Promise<Bodies>(() => undefined);
  const { post } = drawn('Use `<div>` here.');
  // Until its tree is made, it may hold a tag.
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  await settle();
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toBe('Use <div> here.');
  expect(post?.querySelector('code')?.textContent).toBe('<div>');
  expect(post?.firstElementChild?.classList.contains('move-swap')).toBe(true);
});

test('a post whose Markdown holds a tag shows its Markdown when its rendering can’t be read', async () => {
  fake.ask = () => Promise.reject(new Error('offline'));
  const { element } = drawn(TAGGED);
  const post = element.querySelector('[data-lo-post]');
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  await settle();
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toContain('Bugbot');
});

test('a comment with a tag that this window sent shows its text from the first frame, and never skeleton lines', async () => {
  wroteText('v1', `${TAGGED}\n`);
  let answer: (() => void) | undefined;
  fake.ask = (posts) =>
    new Promise((resolve) => {
      answer = () => void answering(RENDERED)(posts).then(resolve);
    });
  const { post } = drawn(TAGGED);
  const lines = linesFrom(post);
  // As the box showed it as it was sent, then from its Markdown, then GitHub's rendering.
  expect(post?.textContent).toBe(TAGGED);
  await settle();
  expect(post?.textContent).toBe(AS_WRITTEN);
  answer?.();
  await settle();
  expect(post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(lines()).toBe(0);
  expect(post?.querySelector('.move-swap')).toBeNull();
});

test('a post with a tag whose tree can’t be made from its rendering shows its Markdown', async () => {
  fake.ask = answering(RENDERED);
  fake.failing = (input) => (input.html === null ? undefined : new Error('It threw.'));
  const { post } = drawn(TAGGED);
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  await settle();
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toBe(AS_WRITTEN);
  expect(sources()).toEqual(['markdown', 'html']);
});

test('a post whose trees can’t be made from either shows its text, and asks for neither again', async () => {
  fake.ask = answering(RENDERED);
  fake.failing = () => new Error('It threw.');
  const { post } = drawn(TAGGED);
  await settle();
  expect(sources()).toEqual(['markdown', 'html']);
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toBe(TAGGED);
  await settle();
  expect(sources()).toEqual(['markdown', 'html']);
});

test('a tree lost to a restart is asked for again after a wait, while the post holds its lines', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  fake.ask = answering(RENDERED);
  let lost = 1;
  fake.failing = (input) =>
    input.html !== null && lost-- > 0
      ? new IpcError('restarted', 'The background process stopped during comments.render.')
      : undefined;
  const { post } = drawn(TAGGED);
  const texts = textsFrom(post);
  await pass(0);
  expect(sources()).toEqual(['markdown', 'html']);
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  await pass(FIRST_RETRY);
  expect(sources()).toEqual(['markdown', 'html', 'html']);
  expect(post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(texts().filter((text) => text.includes('<sup>'))).toEqual([]);
});

test('a tree whose job stays busy is asked for a few times, each after a longer wait, and then no more', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  fake.ask = () => new Promise<Bodies>(() => undefined);
  fake.failing = () => new IpcError('busy', 'Too many jobs were waiting.');
  const { post } = drawn(TAGGED);
  await pass(0);
  for (let tried = 0; tried < RETRIES; tried += 1) {
    expect(sources()).toHaveLength(1 + tried);
    await pass(FIRST_RETRY * 2 ** tried - 1);
    expect(sources()).toHaveLength(1 + tried);
    await pass(1);
  }
  await pass(10 * 60_000);
  expect(sources()).toEqual(Array.from({ length: 1 + RETRIES }, () => 'markdown'));
  // Its rendering may come yet: its lines hold its place until then.
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
});

test('a post with a tag whose read failed keeps its Markdown, with no skeleton lines, until a read again brings its rendering', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  fake.ask = () => Promise.reject(new Error('offline'));
  const { post } = drawn(TAGGED);
  await pass(0);
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toBe(AS_WRITTEN);
  const lines = linesFrom(post);
  fake.ask = answering(RENDERED);
  await pass(FIRST_WAIT);
  expect(post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(lines()).toBe(0);
});

test('after a read failed, a post with a tag off screen holds its lines until its rendering, and never shows its Markdown', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const near = stubNear();
  fake.ask = () => Promise.reject(new Error('offline'));
  const seen = drawn(TAGGED, 'SEEN').post;
  const off = drawn(TAGGED, 'OFF').post;
  const texts = textsFrom(off);
  near(seen, true);
  await pass(0);
  // The read of the one on screen failed: it shows its Markdown, the other its lines still.
  expect(seen?.textContent).toBe(AS_WRITTEN);
  expect(off?.querySelectorAll('.skeleton')).toHaveLength(3);
  fake.ask = answering(RENDERED);
  await pass(FIRST_WAIT);
  expect(seen?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(off?.querySelectorAll('.skeleton')).toHaveLength(3);
  near(off, true);
  await pass(0);
  expect(off?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(off?.firstElementChild?.classList.contains('move-swap')).toBe(true);
  expect(texts().filter((text) => text.includes('<sup>'))).toEqual([]);
});

test('a post with a tag GitHub gave nothing for, or whose rendering is longer than Lo reads, shows its Markdown', async () => {
  const long = `<p>${'x'.repeat(HTML_LIMIT)}</p>`;
  fake.ask = (posts) =>
    Promise.resolve({
      description: null,
      posts: posts.filter((id) => id === 'LONG').map((id) => ({ id, html: long })),
      gone: posts.filter((id) => id === 'GONE'),
    });
  const gone = drawn(TAGGED, 'GONE').post;
  const longer = drawn(TAGGED, 'LONG').post;
  await settle();
  for (const post of [gone, longer]) {
    expect(post?.querySelector('.skeleton')).toBeNull();
    expect(post?.textContent).toBe(AS_WRITTEN);
  }
});

test('a post with a tag drawn again shows the tree it was drawn with from its first frame', async () => {
  fake.ask = answering(RENDERED);
  const first = drawn(TAGGED, 'AGAIN');
  await settle();
  expect(first.post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  first.unmount();
  const { post } = drawn(TAGGED, 'AGAIN');
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toBe('Reviewed by Bugbot for commit 73ae3d3.');
  expect(post?.querySelector('.move-swap')).toBeNull();
});

test('an edited post with a tag holds the room its rendering took while its new one comes', async () => {
  const observed: Element[] = [];
  // Every post measures 240 px as it's observed.
  class Observer implements ResizeObserver {
    readonly #callback: ResizeObserverCallback;
    constructor(callback: ResizeObserverCallback) {
      this.#callback = callback;
    }
    observe(target: Element) {
      observed.push(target);
      const size = { blockSize: 240, inlineSize: 600 };
      const rect = {
        x: 0,
        y: 0,
        width: 600,
        height: 240,
        top: 0,
        left: 0,
        right: 600,
        bottom: 240,
      };
      const box = { ...rect, toJSON: () => rect };
      const sizes = [size];
      const entry: ResizeObserverEntry = {
        target,
        borderBoxSize: sizes,
        contentBoxSize: sizes,
        devicePixelContentBoxSize: sizes,
        contentRect: box,
      };
      this.#callback([entry], this);
    }
    unobserve() {}
    disconnect() {}
  }
  vi.stubGlobal('ResizeObserver', Observer);
  onTestFinished(() => {
    vi.unstubAllGlobals();
  });
  fake.ask = answering(RENDERED);
  const { element, draw } = drawn(TAGGED, 'P2');
  await settle();
  const post = element.querySelector<HTMLElement>('[data-lo-post]');
  expect(post?.textContent).toContain('Reviewed by Bugbot');
  expect(observed).toEqual([post]);

  fake.ask = () => new Promise<Bodies>(() => undefined);
  draw(`${TAGGED} Edited.`);
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  expect(post?.style.minHeight).toBe('240px');
});
