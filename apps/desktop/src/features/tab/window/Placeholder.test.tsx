// @vitest-environment jsdom
import { LOADING_DELAY_MS, LOADING_SLOW_MS } from '@lo/ui';
import { commandsOf } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import keys from '../keys.ts';
import type { PullView } from '../contract.ts';
import { Placeholder, waitedFor } from './Placeholder.tsx';
import { pullsStore } from './store.ts';

const close = vi.hoisted(() => vi.fn<(tab: { id: string }) => Promise<void>>());
vi.mock('./main.ts', () => ({ main: () => ({ close }) }));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(commandsOf(keys), 'mac');
});

beforeEach(() => {
  vi.useFakeTimers();
  close.mockReset().mockResolvedValue();
});

/** What takes each placeholder drawn off the page again. */
const drawn: (() => void)[] = [];

afterEach(() => {
  for (const gone of drawn.splice(0)) gone();
  // Long enough for every wait to be over before the next test.
  wait(LOADING_DELAY_MS);
  vi.useRealTimers();
});

/** Draws tab `tab`'s placeholder, as one of the tab's views would, over `status` if it gives one. */
function draw(tab: string, status?: string) {
  const box = document.createElement('div');
  document.body.append(box);
  const root = createRoot(box);
  const say = (line?: string) => act(() => root.render(<Placeholder tab={tab} status={line} />));
  say(status);
  let there = true;
  const gone = () => {
    if (!there) return;
    there = false;
    act(() => root.unmount());
    box.remove();
  };
  drawn.push(gone);
  return { box, gone, say };
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
const cancel = (box: HTMLElement) => box.querySelector('button');
/** How far the mark in `box` is moved from its box's middle, to hold its place. */
const held = (box: HTMLElement) =>
  box.querySelector<HTMLElement>('[data-lo-placeholder] > [role="status"]')?.style.translate;

describe('a tab’s placeholder', () => {
  it('shows nothing at first, then the mark over what it waits for', () => {
    const { box } = draw('fd');
    expect(box.querySelector('[data-lo-placeholder]')?.getAttribute('aria-busy')).toBe('true');
    expect(box.textContent).toBe('');
    wait(LOADING_DELAY_MS);
    expect(box.querySelector('[role="status"] p')?.textContent).toBe('Opening pull request…');
    // Cancel has its room, and isn't offered yet.
    expect(cancel(box)?.parentElement?.className).toContain('invisible');
    expect(cancel(box)?.tabIndex).toBe(-1);
  });

  it('says GitHub is slow after eight seconds, and offers Cancel, which closes the tab', () => {
    const { box } = draw('fd');
    wait(LOADING_SLOW_MS - 1);
    expect(box.textContent).toContain('Opening pull request…');
    wait(1);
    expect(box.querySelector('[role="status"] p')?.textContent).toBe('Waiting for GitHub…');
    expect(cancel(box)?.parentElement?.className).not.toContain('invisible');
    // Cancel closes the tab, so it shows the key that does.
    expect(cancel(box)?.textContent).toBe('Cancel⌘W');
    expect(close).not.toHaveBeenCalled();
    act(() => cancel(box)?.click());
    expect(close).toHaveBeenCalledExactlyOnceWith({ id: 'fd' });
  });

  it('carries one wait from view to view: the mark stays, and slow counts from the start', () => {
    const first = draw('fd');
    wait(500);
    expect(first.box.textContent).toContain('Opening pull request…');
    // The overview gives way to the diff, which draws the same wait.
    first.gone();
    const second = draw('fd');
    expect(second.box.textContent).toContain('Opening pull request…');
    wait(200);
    second.gone();
    const third = draw('fd');
    expect(third.box.textContent).toContain('Opening pull request…');
    wait(LOADING_SLOW_MS - 700);
    expect(third.box.textContent).toContain('Waiting for GitHub…');
  });

  it('swaps only its line for what the view reads next, the mark and the wait carrying on', () => {
    const first = draw('fd');
    wait(500);
    first.gone();
    // The next view finds the mark and the line as they were, with nothing coming in again.
    const second = draw('fd');
    const mark = second.box.querySelector('svg');
    const line = () => second.box.querySelector('[role="status"] p');
    expect(mark?.getAttribute('class')).not.toContain('move-swap');
    expect(line()?.className).not.toContain('move-swap');
    // With the pull request there, it says what it reads now: a new line under the same mark.
    second.say('Reading changed files…');
    expect(line()?.textContent).toBe('Reading changed files…');
    expect(line()?.className).toContain('move-swap');
    expect(second.box.querySelector('svg')).toBe(mark);
    // Cancel's room is there through the whole wait, so nothing shifts under the mark, and it
    // comes eight seconds after the tab began to wait.
    expect(cancel(second.box)?.parentElement?.className).toContain('invisible');
    wait(LOADING_SLOW_MS - 500);
    expect(cancel(second.box)?.parentElement?.className).not.toContain('invisible');
    expect(line()?.textContent).toBe('Reading changed files…');
  });

  it('swaps the next view’s own line in over the last one’s, as a line does in one view', () => {
    const first = draw('fd', 'Fetching overview…');
    wait(500);
    first.gone();
    const second = draw('fd', 'Reading changed files…');
    const line = second.box.querySelector('[role="status"] p');
    expect(line?.textContent).toBe('Reading changed files…');
    expect(line?.className).toContain('move-swap');
    // The mark carries on, with nothing coming in again.
    expect(second.box.querySelector('svg')?.getAttribute('class')).not.toContain('move-swap');
  });

  it('holds the mark where it came on screen as the next view draws the wait lower', () => {
    const boxes = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');
    const at = (top: number, height: number) =>
      boxes.mockImplementation(() => DOMRect.fromRect({ x: 0, y: top, width: 800, height }));
    try {
      // The tab's middle, as it opens: the mark comes in its middle, at 400.
      at(100, 600);
      const first = draw('fd');
      wait(500);
      expect(held(first.box)).toBe('');
      first.gone();
      // The diff's box, under its bar, 40 px lower: the mark stays at 400.
      at(140, 560);
      expect(held(draw('fd').box)).toBe('0 -20px');
    } finally {
      boxes.mockRestore();
    }
  });

  it('waits as a view’s skeleton where it gives one, carrying the wait on, its line said to a screen reader', () => {
    const first = draw('fd');
    wait(500);
    first.gone();
    const box = document.createElement('div');
    document.body.append(box);
    const root = createRoot(box);
    act(() =>
      root.render(
        <Placeholder
          tab="fd"
          status="Reading timeline…"
          skeleton={<span className="skeleton" data-testid="rows" />}
        />,
      ),
    );
    drawn.push(() => {
      act(() => root.unmount());
      box.remove();
    });
    // The wait has run its first moments: the skeleton shows at once, in place of the mark.
    const status = box.querySelector('[data-lo-placeholder] [role="status"]');
    expect(status?.getAttribute('aria-busy')).toBe('true');
    expect(status?.textContent).toBe('Reading timeline…');
    expect(status?.querySelector('[data-testid="rows"]')).not.toBeNull();
    expect(box.querySelector('svg')).toBeNull();
  });

  it('keeps each tab’s wait to itself', () => {
    draw('fd');
    wait(500);
    expect(draw('bat').box.textContent).toBe('');
  });

  it('begins a new wait once the last has been gone a moment', () => {
    expect(waitedFor('fd')).toBeUndefined();
    const first = draw('fd');
    wait(500);
    // How long the tab has waited, which a view the tab goes to by itself goes by.
    expect(waitedFor('fd')).toBe(500);
    first.gone();
    wait(LOADING_DELAY_MS);
    expect(waitedFor('fd')).toBeUndefined();
    const again = draw('fd');
    expect(again.box.textContent).toBe('');
    wait(LOADING_DELAY_MS);
    expect(again.box.textContent).toContain('Opening pull request…');
  });
});

/** What main says of tab `fd`, with `problem`, drawn at `shown` or not yet. */
const pullView = (problem: PullView['problem'], shown: string | null): PullView => ({
  id: 'fd',
  loading: false,
  acting: { kind: 'account', login: 'rozed-bot' },
  header: null,
  connection: { kind: 'live' },
  problem,
  shown,
  newer: null,
});
/** A read that failed, with no retry set. */
const failed: PullView['problem'] = { kind: 'failed', cause: { kind: 'unknown' }, retryAt: null };
/** Has main say `pull`. */
const show = (pull: PullView) => {
  act(() => pullsStore.setState({ views: new Map([[pull.id, pull]]) }));
};

describe('a tab’s placeholder once a read fails', () => {
  afterEach(() => {
    pullsStore.setState({ views: new Map() });
  });

  it('keeps waiting where the pull request was drawn, since the read tried again may answer', () => {
    show(pullView(failed, 'a'.repeat(40)));
    const { box } = draw('fd');
    expect(box.querySelector('[data-lo-placeholder]')?.getAttribute('aria-busy')).toBe('true');
    expect(box.querySelector('[role="status"]')).not.toBeNull();
  });

  it('draws nothing where the pull request can’t be shown, as its banner says why', () => {
    show(pullView(failed, null));
    const { box } = draw('fd');
    expect(box.querySelector('[data-lo-placeholder]')?.hasAttribute('aria-busy')).toBe(false);
    expect(box.querySelector('[role="status"]')).toBeNull();
  });
});
