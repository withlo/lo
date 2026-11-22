// @vitest-environment jsdom
import { LOADING_DELAY_MS, LOADING_SLOW_MS } from '@lo/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Placeholder } from './Placeholder.tsx';

const close = vi.hoisted(() => vi.fn<(tab: { id: string }) => Promise<void>>());
vi.mock('./main.ts', () => ({ main: () => ({ close }) }));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
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

/** Draws tab `tab`'s placeholder, as one of the tab's views would. */
function draw(tab: string): { box: HTMLElement; gone: () => void } {
  const box = document.createElement('div');
  document.body.append(box);
  const root = createRoot(box);
  act(() => root.render(<Placeholder tab={tab} />));
  let there = true;
  const gone = () => {
    if (!there) return;
    there = false;
    act(() => root.unmount());
    box.remove();
  };
  drawn.push(gone);
  return { box, gone };
}

function wait(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}
const cancel = (box: HTMLElement) => box.querySelector('button');

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

  it('keeps each tab’s wait to itself', () => {
    draw('fd');
    wait(500);
    expect(draw('bat').box.textContent).toBe('');
  });

  it('begins a new wait once the last has been gone a moment', () => {
    const first = draw('fd');
    wait(500);
    first.gone();
    wait(LOADING_DELAY_MS);
    const again = draw('fd');
    expect(again.box.textContent).toBe('');
    wait(LOADING_DELAY_MS);
    expect(again.box.textContent).toContain('Opening pull request…');
  });
});
