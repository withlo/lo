// @vitest-environment jsdom
// A view's diff waits for its threads' first read only the first time it's drawn, and no longer
// than WAIT_FOR_THREADS; drawn anew as its tab comes back on screen, it never waits. The middle
// says it waits only once the wait outlasts SAY_WAITING_AFTER.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import { SAY_WAITING_AFTER, useSaysWaiting, useThreadsSettled } from './settled.ts';
import { setThreader, threadsChanged } from './shared.ts';
import { NO_THREADS, WAIT_FOR_THREADS } from './threads.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Which views' threads the stand-in threader has read. */
const read = new Set<string>();

/** Has the stand-in threader say views' threads are read as `read` holds. */
function threading(): void {
  const stop = setThreader({
    threadsIn: () => NO_THREADS,
    render: () => () => ({ update: () => undefined, destroy: () => undefined }),
    settled: (tab) => read.has(tab),
  });
  onTestFinished(stop);
}

/** What a component asking about a view's threads heard each time it was drawn. */
interface Heard {
  readonly settled: boolean;
  readonly saysWaiting: boolean;
}

/**
 * Draws a component asking whether view `tab`'s diff may be drawn, and whether the middle says it
 * waits: `said` is what it heard last, and `heard` everything it heard.
 */
function asking(
  tab: string,
  ready = true,
): { said: () => boolean; saysWaiting: () => boolean; heard: Heard[]; root: Root } {
  const heard: Heard[] = [];
  function Asking() {
    const settled = useThreadsSettled(tab, ready);
    heard.push({ settled, saysWaiting: useSaysWaiting(tab, settled) });
    return null;
  }
  const element = document.createElement('div');
  const root = createRoot(element);
  act(() => root.render(<Asking />));
  onTestFinished(() => act(() => root.unmount()));
  return {
    said: () => heard.at(-1)?.settled ?? false,
    saysWaiting: () => heard.at(-1)?.saysWaiting ?? false,
    heard,
    root,
  };
}

test('a first draw waits until the threads’ first read ends', () => {
  threading();
  const view = asking('first');
  expect(view.said()).toBe(false);
  read.add('first');
  act(() => threadsChanged('first'));
  expect(view.said()).toBe(true);
});

test('it waits no longer than WAIT_FOR_THREADS, and never again for the view', () => {
  vi.useFakeTimers();
  threading();
  const view = asking('slow');
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS - 1);
  });
  expect(view.said()).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(view.said()).toBe(true);
  act(() => view.root.unmount());
  // Drawn anew, as its tab comes back on screen, its threads still unread.
  expect(asking('slow').said()).toBe(true);
});

test('drawn anew while it waits, it waits only what’s left', () => {
  vi.useFakeTimers();
  threading();
  const first = asking('moved');
  act(() => {
    vi.advanceTimersByTime(600);
  });
  act(() => first.root.unmount());
  const again = asking('moved');
  expect(again.said()).toBe(false);
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS - 600);
  });
  expect(again.said()).toBe(true);
});

test('a view whose files aren’t ready yet doesn’t start waiting', () => {
  vi.useFakeTimers();
  threading();
  const view = asking('later', false);
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS * 2);
  });
  expect(view.said()).toBe(false);
});

test('the middle says it waits for the threads only once the wait outlasts SAY_WAITING_AFTER', () => {
  vi.useFakeTimers();
  threading();
  const view = asking('told');
  act(() => {
    vi.advanceTimersByTime(SAY_WAITING_AFTER - 1);
  });
  expect(view.saysWaiting()).toBe(false);
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(view.saysWaiting()).toBe(true);
  read.add('told');
  act(() => threadsChanged('told'));
  expect(view.saysWaiting()).toBe(false);
});

test('a first read that ends sooner never has the middle say it waits', () => {
  vi.useFakeTimers();
  threading();
  const view = asking('quick');
  act(() => {
    vi.advanceTimersByTime(SAY_WAITING_AFTER / 2);
  });
  read.add('quick');
  act(() => threadsChanged('quick'));
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS * 2);
  });
  expect(view.heard.some((heard) => heard.saysWaiting)).toBe(false);
});

test('drawn anew with its threads settled, as on a switch back to its tab, it never says it waits', () => {
  vi.useFakeTimers();
  threading();
  const first = asking('back');
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS);
  });
  expect(first.said()).toBe(true);
  act(() => first.root.unmount());
  // Its threads still unread, and the wait long over.
  const again = asking('back');
  act(() => {
    vi.advanceTimersByTime(WAIT_FOR_THREADS * 2);
  });
  expect(again.heard.length).toBeGreaterThan(0);
  expect(again.heard.every((heard) => heard.settled && !heard.saysWaiting)).toBe(true);
});
