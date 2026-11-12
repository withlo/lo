// @vitest-environment jsdom
// An overview's code blocks and walkthrough steps, with main answered by a stand-in bridge: a
// block asks for its file once it knows where it is, draws its code once it's all in, as the pull
// request's diff of it when it changed it, near the screen; far from it, it draws once, in turn,
// for its height, and lets its code go, keeping its room. Blocks on one file read and diff it once.
// Near the screen as the overview is first laid out, a block draws before it's seen. One that
// couldn't be read says why; one that doesn't resolve offers, in its head, to find a file of the
// name it gave; and a walkthrough's step shows its file whole, its lines marked.

import type { CodeRange, CodeState, Excerpt } from '@lo/artifact';
import { parseArtifact } from '@lo/artifact';
import { diffText } from '@lo/diff';
import { OverviewDocument } from '@lo/ui/overview';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { BlockText } from '../contract.ts';
import type { CodeRead } from './checking.ts';
import { ExcerptBlock, WalkthroughBlock, type CodeContext } from './Code.tsx';
import { drawing, FirstDrawContext } from './drawing.ts';

const findFile = vi.hoisted(() => vi.fn<(name: string) => void>());

vi.mock(import('../../tree/window/shared.ts'), async (original) => ({
  ...(await original()),
  findFile,
}));
/** How many times files were diffed. */
const diffs = vi.hoisted(() => ({ count: 0 }));

vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  // Diffed here, as the diff's background jobs diff.
  diffTexts: (files) => {
    diffs.count += files.length;
    return Promise.resolve(
      files.map((file) => ({
        ok: true as const,
        diff: diffText(file.old ?? undefined, file.new ?? undefined),
        tokens: {},
        changes: { deleted: [], added: [] },
      })),
    );
  },
}));

/** What main answers for each file, by its path. */
const texts = new Map<string, BlockText>();

const bridge = installBridge({
  'app.info': () => ({ nonce: 'n' }),
  'overview.texts': (input) => {
    const path: unknown = Reflect.get(Object(input), 'path');
    const found = typeof path === 'string' ? texts.get(path) : undefined;
    if (!found) throw new Error(`No text for ${String(path)}.`);
    return found;
  },
});

/** An intersection observer the test tells what's near, by the margin it watches. */
class Observer implements IntersectionObserver {
  static all: Observer[] = [];
  readonly root = null;
  readonly rootMargin: string;
  readonly scrollMargin = '0px';
  readonly thresholds = [0];
  readonly targets: Element[] = [];
  readonly #callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.#callback = callback;
    this.rootMargin = options.rootMargin ?? '0px';
    Observer.all.push(this);
  }

  observe(target: Element): void {
    this.targets.push(target);
  }

  unobserve(target: Element): void {
    this.targets.splice(this.targets.indexOf(target), 1);
  }

  disconnect(): void {
    Observer.all = Observer.all.filter((observer) => observer !== this);
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  tell(isIntersecting: boolean): void {
    const rect = new DOMRect();
    const entries = this.targets.map((target) => ({
      target,
      isIntersecting,
      intersectionRatio: isIntersecting ? 1 : 0,
      boundingClientRect: rect,
      intersectionRect: rect,
      rootBounds: null,
      time: 0,
    }));
    this.#callback(entries, this);
  }
}

/** Says each block is within a screen of the screen, or not, and within three, or not. */
function place(near: boolean, far = near): void {
  act(() => {
    for (const observer of Observer.all.slice()) {
      if (observer.rootMargin === '100% 0px') observer.tell(near);
      else if (observer.rootMargin === '300% 0px') observer.tell(far);
    }
  });
}

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry([], 'mac');
  // jsdom has no fonts or layout: the editor needs only that they exist.
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', {
      value: () => Object.assign([], { item: () => null }),
    });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
});

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', Observer);
  texts.clear();
  bridge.calls.length = 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  Observer.all = [];
  findFile.mockClear();
});

const COMMIT = 'c'.repeat(40);

/** Each test's own tab, so none reads a file another kept. */
let tab = 't0';
let tabs = 0;
beforeEach(() => {
  tabs += 1;
  tab = `t${tabs}`;
  diffs.count = 0;
});

/** The blocks' context: the files the check read, and each block's state. */
function contextOf(state: CodeState, read: CodeRead = { kind: 'read', commit: COMMIT, files: [] }) {
  return {
    tab,
    commit: COMMIT,
    read,
    target: () => ({ code: state, answer: undefined }),
  } satisfies CodeContext;
}

const RESOLVED: CodeState = { state: 'resolved' };

/** Draws `node` on the page, until the test ends. */
function draw(node: ReactNode): HTMLElement & { again: (node: ReactNode) => void } {
  const host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return Object.assign(host, { again: (next: ReactNode) => act(() => root.render(next)) });
}

/** Lets what's waiting on main settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

function excerpt(path: string, start: number, end: number): Excerpt {
  const target: CodeRange = { kind: 'code', path, lines: { start, end } };
  return { kind: 'excerpt', target };
}

/** What the blocks asked main for. */
const asked = () => bridge.calls.filter(([channel]) => channel === 'overview.texts');

/** The lines a block has drawn, of `kind`. */
const drawnLines = (page: HTMLElement, kind = '') =>
  [...page.querySelectorAll(`[data-lo-code] .cm-line${kind}`)].map((line) => line.textContent);

describe('a code block', () => {
  it('reads its file once it’s near the screen, and draws it once, as the pull request changed it', async () => {
    texts.set('src/a.ts', {
      kind: 'text',
      text: 'one\nTWO\nthree\n',
      base: { kind: 'changed', path: 'src/a.ts', text: 'one\ntwo\nthree\n' },
    });
    const page = draw(
      <ExcerptBlock node={excerpt('src/a.ts', 1, 3)} context={contextOf(RESOLVED)} />,
    );
    const body = page.querySelector('[data-lo-code]')!;
    expect(body.getAttribute('data-lo-code')).toBe('waiting');
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    // Until it knows where it is, it reads nothing.
    expect(asked()).toEqual([]);

    place(true);
    await until(() => body.getAttribute('data-lo-code') === 'drawn');
    expect(asked()).toEqual([
      ['overview.texts', { id: tab, commit: COMMIT, path: 'src/a.ts', base: true }],
    ]);
    expect(drawnLines(page, '.lo-line-del')).toEqual(['two']);
    expect(drawnLines(page, '.lo-line-add')).toEqual(['TWO']);

    // Checked again, it's drawn as it was, and asks for nothing.
    const view = page.querySelector('[data-lo-code] .cm-editor');
    page.again(<ExcerptBlock node={excerpt('src/a.ts', 1, 3)} context={contextOf(RESOLVED)} />);
    expect(page.querySelector('[data-lo-code] .cm-editor')).toBe(view);
    expect(asked()).toHaveLength(1);

    // A screen away, it's still drawn; three, and its code goes, its room kept.
    place(false, true);
    expect(body.getAttribute('data-lo-code')).toBe('drawn');
    place(false);
    await until(() => body.getAttribute('data-lo-code') === 'measured');
    expect(page.querySelector('[data-lo-code] .cm-editor')).toBeNull();
    expect(body instanceof HTMLElement && body.style.minHeight).not.toBe('');

    // Near again, it draws again from what was kept, asking main nothing.
    place(true);
    await until(() => body.getAttribute('data-lo-code') === 'drawn');
    expect(asked()).toHaveLength(1);
    expect(diffs.count).toBe(1);
  });

  it('draws once far from the screen, in turn, for its height, then lets its code go', async () => {
    texts.set('src/a.ts', { kind: 'text', text: 'a\nb\n', base: { kind: 'same' } });
    texts.set('src/b.ts', { kind: 'text', text: 'c\nd\n', base: { kind: 'same' } });
    const page = draw(
      <>
        <ExcerptBlock node={excerpt('src/a.ts', 1, 2)} context={contextOf(RESOLVED)} />
        <ExcerptBlock node={excerpt('src/b.ts', 1, 2)} context={contextOf(RESOLVED)} />
      </>,
    );
    place(false);
    const bodies = [...page.querySelectorAll('[data-lo-code]')];
    await until(() => bodies.every((body) => body.getAttribute('data-lo-code') === 'measured'));
    expect(asked()).toHaveLength(2);
    expect(page.querySelector('[data-lo-code] .cm-editor')).toBeNull();
    for (const body of bodies) {
      expect(body instanceof HTMLElement && body.style.minHeight).not.toBe('');
    }
    // Measured once, it reads nothing more while it's far.
    place(false);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(asked()).toHaveLength(2);
  });

  it('reads and diffs a file once for every block on it', async () => {
    texts.set('src/a.ts', {
      kind: 'text',
      text: 'one\nTWO\nthree\nfour\n',
      base: { kind: 'changed', path: 'src/a.ts', text: 'one\ntwo\nthree\nfour\n' },
    });
    const page = draw(
      <>
        <ExcerptBlock node={excerpt('src/a.ts', 1, 2)} context={contextOf(RESOLVED)} />
        <ExcerptBlock node={excerpt('src/a.ts', 3, 4)} context={contextOf(RESOLVED)} />
      </>,
    );
    place(true);
    await until(() => page.querySelectorAll('[data-lo-code="drawn"]').length === 2);
    expect(asked()).toHaveLength(1);
    expect(diffs.count).toBe(1);
    expect(drawnLines(page)).toEqual(['one', 'two', 'TWO', 'three', 'four']);
  });

  it('draws before the overview is first seen when it’s near the screen then', async () => {
    texts.set('src/a.ts', { kind: 'text', text: 'a\n', base: { kind: 'same' } });
    texts.set('src/b.ts', { kind: 'text', text: 'b\n', base: { kind: 'same' } });
    const opened = vi.fn<() => void>();
    const first = drawing(opened);
    const page = draw(
      <FirstDrawContext value={first}>
        <ExcerptBlock node={excerpt('src/a.ts', 1, 1)} context={contextOf(RESOLVED)} />
      </FirstDrawContext>,
    );
    first.settle();
    expect(opened).not.toHaveBeenCalled();
    place(true);
    await until(() => opened.mock.calls.length === 1);
    expect(page.querySelector('[data-lo-code="drawn"]')).not.toBeNull();

    // One far from the screen doesn't keep the overview from being seen.
    const later = vi.fn<() => void>();
    const second = drawing(later);
    draw(
      <FirstDrawContext value={second}>
        <ExcerptBlock node={excerpt('src/b.ts', 1, 1)} context={contextOf(RESOLVED)} />
      </FirstDrawContext>,
    );
    second.settle();
    expect(later).not.toHaveBeenCalled();
    place(false);
    expect(later).toHaveBeenCalledTimes(1);
  });

  it('shows a file the pull request doesn’t change as plain lines', async () => {
    texts.set('README.md', { kind: 'text', text: '# Read me\n\nMore.\n', base: { kind: 'same' } });
    const page = draw(
      <ExcerptBlock node={excerpt('README.md', 1, 3)} context={contextOf(RESOLVED)} />,
    );
    place(true);
    await until(() => page.querySelector('[data-lo-code="drawn"]') !== null);
    expect(drawnLines(page)).toEqual(['# Read me', '', 'More.']);
    expect(
      page.querySelector('[data-lo-code] .lo-line-add, [data-lo-code] .lo-line-del'),
    ).toBeNull();
  });

  it('says why it couldn’t read its file', async () => {
    texts.set('src/a.ts', { kind: 'unread', why: 'It isn’t text.' });
    const page = draw(
      <ExcerptBlock node={excerpt('src/a.ts', 1, 3)} context={contextOf(RESOLVED)} />,
    );
    place(true);
    await until(() => page.querySelector('.lo-codeblock__msg') !== null);
    expect(page.querySelector('.lo-codeblock__msg')?.textContent).toBe(
      'Lo couldn’t read this code. It isn’t text.',
    );
    // The code read again, it asks again.
    texts.set('src/a.ts', { kind: 'text', text: 'a\nb\nc\n', base: { kind: 'same' } });
    page.again(<ExcerptBlock node={excerpt('src/a.ts', 1, 3)} context={contextOf(RESOLVED)} />);
    place(true);
    await until(() => page.querySelector('[data-lo-code="drawn"]') !== null);
    expect(asked()).toHaveLength(2);
  });

  it('offers, in its head, to find a file of the name it gave when it doesn’t resolve, reading nothing', () => {
    const page = draw(
      <ExcerptBlock
        node={excerpt('src/cache.ts', 1, 4)}
        context={contextOf({ state: 'broken', why: 'missing' })}
      />,
    );
    place(true);
    expect(page.querySelector('.lo-codeblock--unresolved')).not.toBeNull();
    const button = [...page.querySelectorAll<HTMLElement>('.lo-codeblock__head button')].find(
      (each) => each.textContent?.startsWith('Find a file named cache.ts'),
    );
    expect(page.querySelector('.lo-codeblock__msg button')).toBeNull();
    act(() => {
      button?.click();
    });
    expect(findFile).toHaveBeenCalledWith('cache.ts');
    expect(asked()).toEqual([]);
  });

  it('says it waits for the local copy, as tall as its lines', () => {
    const page = draw(
      <ExcerptBlock
        node={excerpt('src/a.ts', 3, 9)}
        context={contextOf({ state: 'unread', why: 'failed' }, { kind: 'waiting' })}
      />,
    );
    expect(page.querySelector('.lo-codeblock__msg strong')?.textContent).toBe(
      'Waiting for the local copy.',
    );
    expect(page.querySelectorAll('.lo-codeblock__space .cm-line')).toHaveLength(7);
  });
});

describe('a walkthrough', () => {
  const { tree } = parseArtifact(
    [
      `---\nformat: 1\npr: 1\ncommit: ${COMMIT}\n---\n`,
      '## tl;dr\n\nA.\n',
      ':::walkthrough Through it',
      ':::step src/a.ts#L2-L3',
      'First.',
      ':::',
      ':::step src/b.ts#L1',
      'Second.',
      ':::',
      ':::',
      '',
    ].join('\n'),
  );

  it('shows each step’s file whole, its lines marked', async () => {
    texts.set('src/a.ts', {
      kind: 'text',
      text: 'one\ntwo\nthree\nfour\n',
      base: { kind: 'same' },
    });
    texts.set('src/b.ts', { kind: 'text', text: 'bee\n', base: { kind: 'added' } });
    // Its steps' words are Markdown, which the document draws.
    const context = contextOf(RESOLVED);
    const page = draw(
      <OverviewDocument
        tree={tree}
        views={{ walkthrough: (node) => <WalkthroughBlock node={node} context={context} /> }}
      />,
    );
    place(true);
    const marked = () =>
      [...page.querySelectorAll('.cm-line.lo-line-marked')].map((line) => line.textContent);
    await until(() => marked().length > 0);
    expect(marked()).toEqual(['two', 'three']);
    expect(asked()).toEqual([
      ['overview.texts', { id: tab, commit: COMMIT, path: 'src/a.ts', base: true }],
    ]);
    const next = [...page.querySelectorAll('button')].find((each) => each.textContent === 'Next');
    act(() => next?.click());
    await until(() => marked()[0] === 'bee');
    expect(page.querySelector('.lo-walk__codehead')?.textContent).toBe('src/b.tsL1');
  });
});
