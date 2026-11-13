// @vitest-environment jsdom
// The stack tree's rows and what they say, which layer is on screen and which the keyboard is on
// (two things, kept apart), a run's band, branches, merged and closed layers, the notes and the
// offer, and that a pull request's text is only ever drawn as text.

import type { MouseEvent } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { cleanUp, click, render, rerender } from '../test/dom.ts';
import { StackTree, type StackTreeLayer, type StackTreeProps } from './StackTree.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  cleanUp();
  vi.restoreAllMocks();
});

const LAYERS: StackTreeLayer[] = [
  {
    key: 'a',
    number: 4818,
    title: 'Move the token bucket into packages/ratelimit',
    state: 'open',
    author: 'ravi-k',
    review: 'approved',
    checks: 'passing',
    overview: 'current',
    viewed: { viewed: 12, total: 12 },
  },
  {
    key: 'b',
    number: 4819,
    title: 'Load per-plan limits from config/limits.yaml',
    state: 'open',
    author: 'ravi-k',
    review: 'approved',
    checks: 'passing',
    overview: 'current',
    viewed: { viewed: 31, total: 31 },
  },
  {
    key: 'c',
    number: 4821,
    title: 'Rate limit GraphQL queries by cost',
    state: 'open',
    author: 'ravi-k',
    review: 'required',
    checks: 'running',
    overview: 'stale',
    viewed: { viewed: 41, total: 214, partial: true },
  },
  {
    key: 'd',
    number: 4824,
    title: 'Return RateLimit headers to clients',
    state: 'draft',
    author: 'ravi-k',
    review: 'approved',
    overview: 'none',
    viewed: { viewed: 0, total: 18 },
    needsRebase: true,
  },
  {
    key: 'e',
    number: 4830,
    title: 'Per-key overrides for internal tools',
    state: 'open',
    author: 'mira-chen',
    review: 'changes',
    checks: 'failing',
    overview: 'error',
    viewed: { viewed: 3, total: 9 },
    sitsOn: 4819,
  },
];

function props(over: Partial<StackTreeProps> = {}): StackTreeProps {
  return { layers: LAYERS, root: 'main', found: 'base', ...over };
}

/** The tree's rows, in order, by key. */
function rows(host: HTMLElement): Map<string, HTMLElement> {
  return new Map(
    [...host.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((each) => [
      each.dataset['key'] ?? '',
      each,
    ]),
  );
}

function row(host: HTMLElement, key: string): HTMLElement {
  const found = rows(host).get(key);
  if (!found) throw new Error(`No row for ${key}.`);
  return found;
}

function tree(host: HTMLElement): HTMLElement {
  const found = host.querySelector<HTMLElement>('[role="tree"]');
  if (!found) throw new Error('No tree.');
  return found;
}

/** What a row says, without the words only a screen reader gets. */
function said(element: Element): string {
  const copy = element.cloneNode(true);
  if (copy instanceof Element) {
    for (const each of copy.querySelectorAll('.sr-only')) each.remove();
    return copy.textContent ?? '';
  }
  return '';
}

/** A layer with the fields a row needs, and the rest of `LAYERS`' first as it has them. */
function sample(key: string, over: Partial<StackTreeLayer> = {}): StackTreeLayer {
  const [first] = LAYERS;
  if (!first) throw new Error('No layers.');
  return { ...first, key, number: key.codePointAt(0) ?? 0, ...over };
}

/** What each row's rail does: its ball's row has the elbow, the trunk and the rail's end. */
function shape(host: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    [...rows(host)].map(([key, each]) => [
      key,
      [
        each.classList.contains('stack-sprout') ? 'elbow' : undefined,
        each.classList.contains('stack-trunk') ? 'trunk' : undefined,
        each.querySelector('.stack-rail-last') ? 'ends' : undefined,
      ]
        .filter(Boolean)
        .join(' '),
    ]),
  );
}

describe('StackTree', () => {
  it('is a labelled panel holding one tree, with a treeitem for each layer', () => {
    const host = render(<StackTree {...props()} data-lo-scope="stack" />);
    const panel = host.querySelector('section');
    expect(panel?.getAttribute('aria-label')).toBe('Stack');
    expect(panel?.querySelector('h2')?.textContent).toBe('Stack');
    const trees = host.querySelectorAll('[role="tree"]');
    expect(trees).toHaveLength(1);
    // One tab stop for the whole tree, which the caller's attributes reach. The panel and its tree
    // have names of their own.
    expect(tree(host).getAttribute('aria-label')).toBe('Layers');
    expect(tree(host).tabIndex).toBe(0);
    expect(tree(host).getAttribute('data-lo-scope')).toBe('stack');
    expect([...rows(host).keys()]).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(host.querySelectorAll('[role="tree"] > [role="treeitem"]')).toHaveLength(5);
    // The root isn't a row. What it stands for is the tree's description, which a screen reader
    // reaches from the tree.
    expect(host.querySelectorAll('[role="treeitem"]')).toHaveLength(LAYERS.length);
    const described = document.getElementById(tree(host).getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Base branch main');
    expect(tree(host).contains(described)).toBe(false);
    expect(panel?.contains(described)).toBe(true);
  });

  it('hands out the tree element, and answers a click and a right-click with the layer', () => {
    const element = { current: null as HTMLDivElement | null };
    const onShow = vi.fn<(key: string) => void>();
    const onMenu = vi.fn<(key: string, event: MouseEvent<HTMLElement>) => void>();
    const host = render(<StackTree {...props({ onShow, onMenu, treeRef: element })} />);
    expect(element.current).toBe(tree(host));
    click(row(host, 'c'));
    expect(onShow).toHaveBeenCalledExactlyOnceWith('c');
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    row(host, 'b').dispatchEvent(event);
    expect(onMenu).toHaveBeenCalledOnce();
    expect(onMenu.mock.calls[0]?.[0]).toBe('b');
    // A row with no one listening is only a row.
    const alone = render(<StackTree {...props()} />);
    click(row(alone, 'a'));
  });

  it('says how many layers and how Lo found them', () => {
    const heads = (found: StackTreeProps['found'], layers: StackTreeLayer[] = LAYERS) =>
      render(<StackTree {...props({ found, layers })} />)
        .querySelector('section > div')
        ?.textContent?.replace('Stack', '');
    expect(heads('base')).toBe('5 layers · by base branch');
    expect(heads('commits')).toBe('5 layers · by shared commits');
    expect(heads('both')).toBe('5 layers · by base branch and shared commits');
    expect(heads('github', LAYERS.slice(0, 4))).toBe('GitHub stack · 4 layers');
    expect(heads('github', LAYERS.slice(0, 1))).toBe('GitHub stack · 1 layer');
    // A layer alone, such as one that needs a rebase, was found by nothing.
    expect(heads(undefined, LAYERS.slice(0, 1))).toBe('1 layer');
  });

  it('says V-LINE in its head, in place of how many layers, while a run is chosen', () => {
    const host = render(<StackTree {...props({ choosing: true })} />);
    expect(host.querySelector('section > div')?.textContent).toBe('StackV-LINE');
    rerender(host, <StackTree {...props({ choosing: false })} />);
    expect(host.querySelector('section > div')?.textContent).toContain('5 layers');
  });

  describe('a row', () => {
    it('shows the title and number, then who opened it with their initials', () => {
      const host = render(<StackTree {...props()} />);
      const first = row(host, 'a');
      expect(
        first.querySelector('[title="Move the token bucket into packages/ratelimit"]'),
      ).toBeTruthy();
      expect(said(first)).toContain('#4818');
      expect(said(first)).toContain('ravi-k');
      // The picture is only initials, which the login beside it explains.
      const avatar = [...first.querySelectorAll('[aria-hidden="true"]')].find(
        (each) => each.textContent === 'RK',
      );
      expect(avatar).toBeTruthy();
      expect(said(row(host, 'e'))).toContain('MC');
    });

    it('leaves out who opened it for a deleted account', () => {
      const [first] = LAYERS;
      if (!first) throw new Error('No layers.');
      const host = render(<StackTree {...props({ layers: [{ ...first, author: undefined }] })} />);
      expect(said(row(host, 'a'))).not.toContain('RK');
    });

    it('says the review in a word, and the checks as an icon with its state for a name', () => {
      const host = render(<StackTree {...props()} />);
      expect(said(row(host, 'a'))).toContain('Approved');
      expect(said(row(host, 'c'))).toContain('Review required');
      expect(said(row(host, 'e'))).toContain('Changes requested');
      // The checks are an icon alone, so a row keeps to two lines; its name says what it shows.
      const checks = (key: string) => row(host, key).querySelector('[data-checks]');
      expect(checks('a')?.getAttribute('aria-label')).toBe('Checks passing');
      expect(checks('a')?.getAttribute('title')).toBe('Checks passing');
      expect(checks('c')?.getAttribute('aria-label')).toBe('Checks running');
      expect(checks('e')?.getAttribute('aria-label')).toBe('Checks failing');
      expect(checks('a')?.getAttribute('role')).toBe('img');
      expect(checks('a')?.querySelector('svg')).toBeTruthy();
      expect(checks('a')?.textContent).toBe('');
      expect(said(row(host, 'a'))).not.toMatch(/passing|running|failing/i);
      // A layer with none says nothing about them.
      expect(row(host, 'd').querySelector('[data-checks]')).toBeNull();
      // No counts anywhere.
      expect(tree(host).textContent).not.toMatch(/\d+ (running|passing|failing)/i);
    });

    it('keeps a long login to its row, cut with an ellipsis', () => {
      const [first] = LAYERS;
      if (!first) throw new Error('No layers.');
      const login = 'a'.repeat(39);
      const host = render(<StackTree {...props({ layers: [{ ...first, author: login }] })} />);
      const name = [...row(host, 'a').querySelectorAll('span')].find(
        (each) => each.textContent === login,
      );
      expect(name?.classList.contains('truncate')).toBe(true);
      expect(name?.classList.contains('min-w-0')).toBe(true);
      // The item that holds it can shrink, and is never wider than the row.
      expect(name?.parentElement?.classList.contains('min-w-0')).toBe(true);
      expect(name?.parentElement?.classList.contains('max-w-full')).toBe(true);
    });

    it('says Draft in place of the review', () => {
      const host = render(<StackTree {...props()} />);
      const draft = row(host, 'd');
      expect(draft.getAttribute('data-state')).toBe('draft');
      expect(said(draft)).toContain('Draft');
      expect(said(draft)).not.toContain('Approved');
    });

    it('says its place in the merge queue in words, and when a layer needs a rebase', () => {
      const [first] = LAYERS;
      if (!first) throw new Error('No layers.');
      const positions = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111];
      const host = render(
        <StackTree
          {...props({
            layers: positions.map((queue) => ({ ...first, key: `q${queue}`, queue })),
          })}
        />,
      );
      expect(
        positions.map((queue) => said(row(host, `q${queue}`)).match(/Queued, \d+[a-z]{2}/)?.[0]),
      ).toEqual([
        'Queued, 1st',
        'Queued, 2nd',
        'Queued, 3rd',
        'Queued, 4th',
        'Queued, 11th',
        'Queued, 12th',
        'Queued, 13th',
        'Queued, 21st',
        'Queued, 22nd',
        'Queued, 23rd',
        'Queued, 101st',
        'Queued, 111th',
      ]);
      const other = render(<StackTree {...props()} />);
      expect(said(row(other, 'd'))).toContain('Needs rebase');
      expect(said(row(other, 'a'))).not.toContain('Needs rebase');
    });

    it('marks whether it has an overview: current, out of date, none or one that cannot be shown', () => {
      const host = render(<StackTree {...props()} />);
      const marks = (key: string) => row(host, key).querySelector('[data-overview]');
      expect(marks('a')?.getAttribute('aria-label')).toBe('Overview');
      expect(marks('c')?.getAttribute('aria-label')).toBe('Overview, out of date');
      expect(marks('c')?.classList.contains('lo-ovmark--stale')).toBe(true);
      expect(marks('d')?.getAttribute('aria-label')).toBe('No overview yet');
      expect(marks('d')?.classList.contains('lo-ovmark--none')).toBe(true);
      expect(marks('e')?.getAttribute('aria-label')).toBe("Overview, can't be shown");
      expect(marks('e')?.classList.contains('lo-ovmark--error')).toBe(true);
      // A layer that can't have one shows no mark at all.
      const [first] = LAYERS;
      if (!first) throw new Error('No layers.');
      const fork = render(
        <StackTree {...props({ layers: [{ ...first, overview: undefined }] })} />,
      );
      expect(fork.querySelector('.lo-ovmark')).toBeNull();
    });

    it('counts the files viewed, with a plus when only some were counted', () => {
      const host = render(<StackTree {...props()} />);
      expect(said(row(host, 'c'))).toContain('41+/214');
      expect(
        row(host, 'c').querySelector('[title="At least 41 of 214 files viewed"]'),
      ).toBeTruthy();
      expect(said(row(host, 'a'))).toContain('12/12');
      expect(said(row(host, 'a'))).not.toContain('12+');
      expect(row(host, 'a').querySelector('[title="12 of 12 files viewed"]')).toBeTruthy();
    });
  });

  describe('the layer on screen and the keyboard', () => {
    it('keeps them apart: one is aria-current, the other the tree’s active descendant', () => {
      const host = render(<StackTree {...props({ current: 'c', focused: 'd' })} />);
      const current = rows(host).get('c');
      const focused = rows(host).get('d');
      expect(current?.getAttribute('aria-current')).toBe('true');
      expect(focused?.hasAttribute('aria-current')).toBe(false);
      expect(tree(host).getAttribute('aria-activedescendant')).toBe(focused?.id);
      expect(focused?.id).not.toBe(current?.id);
      expect(host.querySelectorAll('[aria-current]')).toHaveLength(1);
      // The ring draws on the focused row only, and the ground of what's on screen on the current.
      expect(focused?.hasAttribute('data-focused')).toBe(true);
      expect(current?.hasAttribute('data-focused')).toBe(false);
      expect(focused?.className).toContain('group-focus-visible/tree:shadow-ring-inset');
      expect(current?.className).not.toContain('shadow-ring-inset');
      expect(current?.className).toContain('bg-on-screen');
      expect(focused?.className).not.toContain('bg-on-screen');
      // The ball on screen is Powder with its halo; a focused layer's is as any other.
      expect(current?.querySelector('.stack-ball-current')).toBeTruthy();
      expect(focused?.querySelector('.stack-ball-current')).toBeNull();
    });

    it('can be one layer, and either can be nowhere', () => {
      const host = render(<StackTree {...props({ current: 'b', focused: 'b' })} />);
      const both = row(host, 'b');
      expect(both.getAttribute('aria-current')).toBe('true');
      expect(both.hasAttribute('data-focused')).toBe(true);
      expect(tree(host).getAttribute('aria-activedescendant')).toBe(both.id);

      rerender(host, <StackTree {...props({ current: 'b' })} />);
      expect(tree(host).hasAttribute('aria-activedescendant')).toBe(false);
      expect(host.querySelector('[data-focused]')).toBeNull();
      expect(host.querySelectorAll('[aria-current]')).toHaveLength(1);

      rerender(host, <StackTree {...props({ focused: 'e' })} />);
      expect(host.querySelector('[aria-current]')).toBeNull();
      expect(tree(host).getAttribute('aria-activedescendant')).toBe(row(host, 'e').id);
      // A key that isn't a layer moves nothing.
      rerender(host, <StackTree {...props({ focused: 'nowhere' })} />);
      expect(tree(host).hasAttribute('aria-activedescendant')).toBe(false);
    });

    it('brings the layer the keyboard moved to, and the one on screen, into view', () => {
      // jsdom has no layout: each row is 40 tall, and the tree shows 100.
      const host = render(<StackTree {...props()} />);
      const scroller = tree(host);
      Object.defineProperty(scroller, 'clientHeight', { value: 100 });
      Object.defineProperty(scroller, 'scrollTop', { value: 0, writable: true });
      for (const [key, element] of rows(host)) {
        Object.defineProperty(element, 'offsetTop', {
          // The root is 24 above the first row.
          value: 24 + LAYERS.findIndex((each) => each.key === key) * 40,
        });
        Object.defineProperty(element, 'offsetHeight', { value: 40 });
      }
      // Past the bottom: the row's bottom meets the tree's.
      rerender(host, <StackTree {...props({ focused: 'e' })} />);
      expect(scroller.scrollTop).toBe(24 + 4 * 40 + 40 - 100);
      // Already in view: nothing moves.
      rerender(host, <StackTree {...props({ focused: 'd' })} />);
      expect(scroller.scrollTop).toBe(24 + 4 * 40 + 40 - 100);
      // Above the top: the row's top meets the tree's.
      rerender(host, <StackTree {...props({ focused: 'c' })} />);
      expect(scroller.scrollTop).toBe(24 + 2 * 40);
      // The first layer brings the root above it into view as well.
      rerender(host, <StackTree {...props({ focused: 'a' })} />);
      expect(scroller.scrollTop).toBe(0);
      rerender(host, <StackTree {...props({ focused: 'a', current: 'e' })} />);
      expect(scroller.scrollTop).toBe(24 + 4 * 40 + 40 - 100);
    });
  });

  describe('a run of layers', () => {
    const run: StackTreeLayer[] = LAYERS.map((layer) =>
      layer.key === 'b'
        ? { ...layer, run: 'start' as const }
        : layer.key === 'c'
          ? { ...layer, run: 'middle' as const }
          : layer.key === 'd'
            ? { ...layer, run: 'end' as const }
            : layer,
    );

    it('has no run, so it selects nothing and dims nothing', () => {
      const host = render(<StackTree {...props({ current: 'c' })} />);
      expect(tree(host).hasAttribute('aria-multiselectable')).toBe(false);
      expect(host.querySelector('[aria-selected]')).toBeNull();
      expect(host.querySelector('[data-dim]')).toBeNull();
      expect(host.querySelector('[data-run]')).toBeNull();
    });

    it('selects the layers in it, shares a band across them and rounds its two ends', () => {
      const host = render(<StackTree {...props({ layers: run, current: 'c' })} />);
      expect(tree(host).getAttribute('aria-multiselectable')).toBe('true');
      expect([...rows(host).values()].map((each) => each.getAttribute('aria-selected'))).toEqual([
        'false',
        'true',
        'true',
        'true',
        'false',
      ]);
      expect([...rows(host).values()].map((each) => each.dataset['run'])).toEqual([
        undefined,
        'start',
        'middle',
        'end',
        undefined,
      ]);
      const [start, middle, end] = ['b', 'c', 'd'].map((key) => row(host, key).classList);
      for (const classes of [start, middle, end])
        expect(classes?.contains('bg-accent-soft')).toBe(true);
      expect(start?.contains('rounded-t-sm')).toBe(true);
      expect(start?.contains('rounded-b-sm')).toBe(false);
      expect(middle?.contains('rounded-sm')).toBe(false);
      expect(middle?.contains('rounded-t-sm') || middle?.contains('rounded-b-sm')).toBe(false);
      expect(end?.contains('rounded-b-sm')).toBe(true);
      expect(end?.contains('rounded-t-sm')).toBe(false);
      // A run of one layer is rounded all round.
      const [only] = LAYERS;
      if (!only) throw new Error('No layers.');
      const single = render(<StackTree {...props({ layers: [{ ...only, run: 'only' }] })} />);
      expect(row(single, 'a').classList.contains('rounded-sm')).toBe(true);
      expect(row(single, 'a').dataset['run']).toBe('only');
    });

    it('steps back the layers outside it, and fills the balls inside', () => {
      const host = render(<StackTree {...props({ layers: run, current: 'c' })} />);
      expect([...rows(host).values()].map((each) => each.hasAttribute('data-dim'))).toEqual([
        true,
        false,
        false,
        false,
        true,
      ]);
      // The titles outside lose their weight and color; those inside keep theirs.
      const titleOf = (key: string) => row(host, key).querySelector('[title]');
      expect(titleOf('a')?.className).toContain('text-fg-muted');
      expect(titleOf('e')?.className).toContain('text-fg-muted');
      expect(titleOf('b')?.className).not.toContain('text-fg-muted');
      expect(titleOf('b')?.className).toContain('text-ui-medium');
      // The balls of a run are Powder, with no halo, even for the layer on screen; no row in it has
      // the ground of what's on screen.
      for (const key of ['b', 'c', 'd']) {
        expect(row(host, key).querySelector('.stack-ball-run')).toBeTruthy();
        expect(row(host, key).querySelector('.stack-ball-current')).toBeNull();
        expect(row(host, key).className).not.toContain('bg-on-screen');
      }
      expect(row(host, 'a').querySelector('[class*="stack-ball-"]')).toBeNull();
    });
  });

  describe('a branch', () => {
    it('is one step in, at level two, its rail bending off the trunk and naming the layer it sits on', () => {
      const host = render(<StackTree {...props()} />);
      const branch = row(host, 'e');
      expect(branch.getAttribute('aria-level')).toBe('2');
      expect(branch.classList.contains('stack-branch')).toBe(true);
      expect(branch.classList.contains('stack-sprout')).toBe(true);
      expect(branch.querySelector('.stack-rail-sprout')).toBeTruthy();
      expect(said(branch)).toContain('on #4819');
      // The trunk is level one, and has no elbow.
      for (const key of ['a', 'b', 'c', 'd']) {
        expect(row(host, key).getAttribute('aria-level')).toBe('1');
        expect(row(host, key).classList.contains('stack-branch')).toBe(false);
        expect(row(host, key).classList.contains('stack-sprout')).toBe(false);
        expect(said(row(host, key))).not.toContain(' on #');
      }
    });

    it('lets the layers above a branch stay on its rail without bending off the trunk again', () => {
      const [, , , , e] = LAYERS;
      if (!e) throw new Error('No layers.');
      const host = render(
        <StackTree
          {...props({
            layers: [
              { ...e, key: 'x', sitsOn: undefined },
              { ...e, key: 'y', branch: true, sitsOn: undefined },
              { ...e, key: 'z', sitsOn: 4819 },
            ],
          })}
        />,
      );
      expect(row(host, 'x').getAttribute('aria-level')).toBe('1');
      expect(row(host, 'y').getAttribute('aria-level')).toBe('2');
      expect(row(host, 'y').classList.contains('stack-branch')).toBe(true);
      expect(row(host, 'y').classList.contains('stack-sprout')).toBe(false);
      expect(row(host, 'y').querySelector('.stack-rail-sprout')).toBeNull();
      expect(row(host, 'z').classList.contains('stack-sprout')).toBe(true);
    });

    it('ends the rail at the last layer’s ball, and nowhere else', () => {
      const host = render(<StackTree {...props()} />);
      const last = [...rows(host).values()].map((each) => each.querySelector('.stack-rail-last'));
      expect(last.map((each) => each !== null)).toEqual([false, false, false, false, true]);
      // With no branch, the trunk is nowhere but in the rail.
      expect(host.querySelector('.stack-trunk')).toBeNull();
    });

    it('draws the trunk down to each later child’s elbow, and ends each branch at its last ball', () => {
      // A layer with three children: the first continues the trunk, the other two branch off it.
      const host = render(
        <StackTree
          {...props({
            layers: [
              sample('a'),
              sample('b'),
              sample('c'),
              sample('s1', { sitsOn: 4819 }),
              sample('s2', { sitsOn: 4819 }),
              sample('s3', { sitsOn: 4819 }),
            ],
          })}
        />,
      );
      expect(shape(host)).toEqual({
        // The trunk's own rail goes on to whatever is below it.
        a: '',
        b: '',
        c: '',
        // Each branch has one layer, so its rail ends at its ball; the trunk runs on past the
        // first two to the last one's elbow, and stops there.
        s1: 'elbow trunk ends',
        s2: 'elbow trunk ends',
        s3: 'elbow ends',
      });
    });

    it('carries a branch’s own layers on its rail, and the trunk past them to the next elbow', () => {
      const host = render(
        <StackTree
          {...props({
            layers: [
              sample('a'),
              sample('b'),
              sample('s1', { sitsOn: 4819 }),
              sample('s1a', { branch: true }),
              sample('s1b', { branch: true }),
              sample('s2', { sitsOn: 4819 }),
              sample('s2a', { branch: true }),
            ],
          })}
        />,
      );
      expect(shape(host)).toEqual({
        a: '',
        b: '',
        // The first branch's rail runs through its layers and ends at the last one's ball, while
        // the trunk goes on beside it to the second branch's elbow.
        s1: 'elbow trunk',
        s1a: 'trunk',
        s1b: 'trunk ends',
        // Nothing branches below the second, so no trunk runs beside it.
        s2: 'elbow',
        s2a: 'ends',
      });
      expect(row(host, 's1a').getAttribute('aria-level')).toBe('2');
      expect(row(host, 's1a').classList.contains('stack-branch')).toBe(true);
    });
  });

  describe('a layer that merged or closed', () => {
    const merged: StackTreeLayer = {
      key: 'm',
      number: 2260,
      title: 'Split settings routes by section',
      state: 'merged',
      when: '40 min ago',
    };
    const closed: StackTreeLayer = {
      key: 'x',
      number: 2267,
      title: 'Drop the old form',
      state: 'closed',
      review: 'approved',
    };
    const finished: StackTreeLayer[] = [
      merged,
      {
        key: 'n',
        number: 2266,
        title: 'Shared form primitives',
        state: 'open',
        author: 'dee-adeyemi',
      },
      closed,
    ];

    it('has a purple ball, its state in words and its title set back', () => {
      const host = render(<StackTree {...props({ layers: finished })} />);
      const done = row(host, 'm');
      expect(done.getAttribute('data-state')).toBe('merged');
      expect(done.querySelector('.stack-ball-merged')).toBeTruthy();
      expect(said(done)).toContain('Merged 40 min ago');
      expect(done.querySelector('[title="Split settings routes by section"]')?.className).toContain(
        'text-fg-muted',
      );
      // An open layer beside it has the plain ball.
      expect(row(host, 'n').querySelector('[class*="stack-ball-"]')).toBeNull();
    });

    it('says merged without a time when it has none, and draws closed apart from merged', () => {
      const host = render(
        <StackTree {...props({ layers: [{ ...merged, when: undefined }, closed] })} />,
      );
      expect(said(row(host, 'm'))).toMatch(/#2260Merged$/);
      const done = row(host, 'x');
      expect(done.querySelector('.stack-ball-closed')).toBeTruthy();
      expect(done.querySelector('.stack-ball-merged')).toBeNull();
      expect(said(done)).toContain('Closed');
      // It says its state in place of a review.
      expect(said(done)).not.toContain('Approved');
      // Each carries its state's own icon beside the word.
      expect(row(host, 'm').querySelectorAll('svg').length).toBeGreaterThanOrEqual(1);
    });

    it('is still the layer on screen when it is the one that merged', () => {
      const host = render(<StackTree {...props({ layers: finished, current: 'm' })} />);
      const done = row(host, 'm');
      expect(done.getAttribute('aria-current')).toBe('true');
      expect(done.className).toContain('bg-on-screen');
      // The ball stays purple, with no halo.
      expect(done.querySelector('.stack-ball-merged')).toBeTruthy();
      expect(done.querySelector('.stack-ball-current')).toBeNull();
    });
  });

  describe('around the rows', () => {
    it('draws each note under the rows, in order, with the layers it names set apart', () => {
      const host = render(
        <StackTree
          {...props({
            notes: [
              {
                key: 'rebase',
                text: (
                  <>
                    <strong>#4824 needs a rebase.</strong> #2260 was squash-merged.
                  </>
                ),
              },
              { key: 'busy', text: 'atlas-api has 1,342 open PRs.' },
            ],
          })}
        />,
      );
      const notes = [...host.querySelectorAll('[role="note"]')];
      expect(notes.map((each) => each.textContent)).toEqual([
        '#4824 needs a rebase. #2260 was squash-merged.',
        'atlas-api has 1,342 open PRs.',
      ]);
      expect(notes[0]?.querySelector('strong')?.textContent).toBe('#4824 needs a rebase.');
      // Under the tree, not inside it.
      for (const each of notes) {
        expect(tree(host).contains(each)).toBe(false);
        expect(
          tree(host).compareDocumentPosition(each) & Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
      }
    });

    it('has no note, and no callout, unless it is given one', () => {
      const host = render(<StackTree {...props()} />);
      expect(host.querySelector('[role="note"]')).toBeNull();
      // The head and the tree, and the tree's description, which draws nothing.
      expect(host.querySelectorAll('section > *')).toHaveLength(3);
    });

    it('puts what it is given as a callout between the head and the rows', () => {
      const host = render(
        <StackTree
          {...props({ callout: <button type="button">Make this a GitHub stack…</button> })}
        />,
      );
      const offer = [...host.querySelectorAll('button')].find((each) =>
        each.textContent?.startsWith('Make this a GitHub stack'),
      );
      expect(offer).toBeTruthy();
      const head = host.querySelector('h2');
      expect(
        head && offer && head.compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        offer && tree(host).compareDocumentPosition(offer) & Node.DOCUMENT_POSITION_PRECEDING,
      ).toBeTruthy();
    });
  });

  describe('text from pull requests', () => {
    const hostile = '<img src="x" onerror="alert(1)"><b>bold</b>';

    it('is drawn as text, whatever it holds', () => {
      const [first] = LAYERS;
      if (!first) throw new Error('No layers.');
      const benign = render(<StackTree {...props({ layers: [first] })} />);
      const host = render(
        <StackTree
          {...props({
            layers: [{ ...first, title: hostile, author: '<script>x</script>' }],
            root: hostile,
          })}
        />,
      );
      expect(host.querySelector('img, b, script')).toBeNull();
      // Nothing it made is an element the same page without them wouldn't have.
      expect(host.querySelectorAll('*')).toHaveLength(benign.querySelectorAll('*').length);
      expect(row(host, 'a').textContent).toContain(hostile);
      expect(row(host, 'a').textContent).toContain('<script>x</script>');
      expect(host.innerHTML).toContain('&lt;img');
    });

    it('cuts a long branch name in the middle, keeping its whole name for the hover and for a screen reader', () => {
      const name = `ravi/${'a'.repeat(60)}/rate-limit-headers-v2`;
      const host = render(<StackTree {...props({ root: name })} />);
      const shown = host.querySelector<HTMLElement>('[role="presentation"] [title]');
      expect(shown?.getAttribute('title')).toBe(name);
      const text = shown?.textContent ?? '';
      expect(text).toContain('…');
      expect(text.length).toBeLessThan(name.length);
      expect(text.startsWith('ravi/')).toBe(true);
      expect(text.endsWith('headers-v2')).toBe(true);
      expect(host.querySelector('.sr-only')?.textContent).toBe(`Base branch ${name}`);
      // A name that fits is left whole.
      const short = render(<StackTree {...props({ root: 'release/2026.11' })} />);
      expect(short.querySelector('[role="presentation"] [title]')?.textContent).toBe(
        'release/2026.11',
      );
    });

    it('never cuts a character in two', () => {
      const name = '😀'.repeat(50);
      const host = render(<StackTree {...props({ root: name })} />);
      const text = host.querySelector('[role="presentation"] [title]')?.textContent ?? '';
      expect(text).toContain('…');
      expect(text.isWellFormed()).toBe(true);
      expect(text.replace('…', '').replaceAll('😀', '')).toBe('');
    });
  });

  it('only uses utilities that Lo’s stylesheet has, so nothing is silently dropped', async () => {
    const everything: StackTreeLayer[] = [
      ...LAYERS.map((layer, at) =>
        at === 1
          ? { ...layer, run: 'start' as const, queue: 2 }
          : at === 2
            ? { ...layer, run: 'middle' as const }
            : at === 3
              ? { ...layer, run: 'end' as const }
              : layer,
      ),
      { key: 'f', number: 1, title: 'Only', state: 'open', run: 'only' },
      { key: 'g', number: 2, title: 'In the branch', state: 'open', branch: true },
      { key: 'm', number: 3, title: 'Merged', state: 'merged', when: '1 h ago' },
      { key: 'x', number: 4, title: 'Closed', state: 'closed' },
    ];
    const host = render(
      <StackTree
        {...props({
          layers: everything,
          current: 'm',
          focused: 'b',
          choosing: true,
          callout: <p>Offer</p>,
          notes: [{ key: 'n', text: 'A note.' }],
        })}
      />,
    );
    const open = render(<StackTree {...props({ current: 'c', focused: 'd' })} />);
    const classes = [
      ...new Set(
        [host, open].flatMap((each) =>
          [...each.querySelectorAll('[class]')].flatMap(
            (element) => element.getAttribute('class')?.split(/\s+/) ?? [],
          ),
        ),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-') && !name.startsWith('group/'));
    expect(classes.length).toBeGreaterThan(40);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
