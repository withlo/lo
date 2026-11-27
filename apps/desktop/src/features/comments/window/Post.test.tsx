// @vitest-environment jsdom
// A post's text: drawn from its Markdown until GitHub's rendering of it is in, unless its Markdown
// holds a tag, which only GitHub's rendering draws: then three skeleton lines hold its place, and
// its rendering takes theirs in one Swap.

import { githubTree, markdownTree } from '@lo/markdown';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, expect, onTestFinished, test, vi } from 'vitest';

import type { Bodies } from '../contract.ts';
import type { RenderInput, Rendered } from '../jobs.ts';
import { Post } from './Post.tsx';
import { keepOnly } from './store.ts';

/** What the test does with each ask for posts' HTML, and each tree asked of the background. */
const fake = vi.hoisted(() => ({
  ask: undefined as ((posts: string[]) => Promise<Bodies>) | undefined,
  renders: [] as RenderInput[],
}));

vi.mock('./main.ts', () => ({
  main: () => ({
    bodies: ({ posts }: { posts: string[] }) =>
      fake.ask?.(posts) ?? new Promise<Bodies>(() => undefined),
  }),
  commentsJobs: () => ({
    render: (input: RenderInput): Promise<Rendered> => {
      fake.renders.push(input);
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
});

afterEach(() => {
  // Each test starts with a window that holds no post.
  keepOnly(new Set());
});

const PULL = { owner: 'rozed-dev', repo: 'e2e', number: 94 };

/** A review's text with tags in it, as a bot writes one. */
const TAGGED = '<sup>Reviewed by **Bugbot** for commit 73ae3d3.</sup>';
const RENDERED = '<p><sup>Reviewed by <strong>Bugbot</strong> for commit 73ae3d3.</sup></p>';

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
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
  });
  return { element, draw };
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
  // Asked for, not answered yet: still the lines, and no tree of its Markdown made meanwhile.
  expect(answer).toBeDefined();
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  expect(fake.renders.filter((input) => input.html === null)).toEqual([]);

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

test('a post whose Markdown holds a tag shows its Markdown when its rendering can’t be read', async () => {
  fake.ask = () => Promise.reject(new Error('offline'));
  const { element } = drawn(TAGGED);
  const post = element.querySelector('[data-lo-post]');
  expect(post?.querySelectorAll('.skeleton')).toHaveLength(3);
  await settle();
  expect(post?.querySelector('.skeleton')).toBeNull();
  expect(post?.textContent).toContain('Bugbot');
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
