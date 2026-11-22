// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, onTestFinished, test, vi } from 'vitest';

import { Countdown, countdownSaid, countdownWords } from './Countdown.tsx';
import { Problem } from './Problem.tsx';
import { TooltipGroup } from './Tooltip.tsx';

function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<TooltipGroup>{node}</TooltipGroup>));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** The text of `element`, but that of what `left` matches in it. */
function textWithout(element: Element, left: string): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return '';
  for (const out of copy.querySelectorAll(left)) out.remove();
  return copy.textContent ?? '';
}

/** What a screen reader hears of `element`: its text, but what's hidden from it. */
const heard = (element: Element) => textWithout(element, '[aria-hidden="true"]');

/** What the eye reads of `element`: its text, but what's there only for a screen reader. */
const seen = (element: Element) => textWithout(element, '.sr-only');

test('says how long is left in the largest whole unit, rounded up, never under a second', () => {
  const now = 1_000_000;
  expect(countdownWords(now + 7_200, now)).toBe('in 8 s');
  expect(countdownWords(now + 59_000, now)).toBe('in 59 s');
  expect(countdownWords(now + 61_000, now)).toBe('in 2 min');
  expect(countdownWords(now + 3 * 3_600_000, now)).toBe('in 3 h');
  expect(countdownWords(now + 2 * 86_400_000, now)).toBe('in 2 d');
  expect(countdownWords(now - 5_000, now)).toBe('in 1 s');
});

test('spells the same out for a screen reader', () => {
  const now = 1_000_000;
  expect(countdownSaid(now + 7_200, now)).toBe('in 8 seconds');
  expect(countdownSaid(now + 500, now)).toBe('in 1 second');
  expect(countdownSaid(now + 61_000, now)).toBe('in 2 minutes');
  expect(countdownSaid(now + 60_000, now)).toBe('in 1 minute');
  expect(countdownSaid(now + 3 * 3_600_000, now)).toBe('in 3 hours');
  expect(countdownSaid(now + 86_400_000, now)).toBe('in 1 day');
});

/** A problem whose reason counts down to `at`. */
function retrying(at: number) {
  return (
    <Problem
      layout="view"
      title="Can’t fetch the overview"
      reason={
        <>
          Offline. Retrying <Countdown at={at} />.
        </>
      }
    />
  );
}

test('counts down for the eye, while a problem’s alert reads as it was first drawn', () => {
  vi.useFakeTimers({ now: 1_000_000 });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const host = draw(retrying(1_000_000 + 8_000));
  const alert = host.querySelector('[role="alert"]')!;
  expect(seen(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 8 s.');
  expect(heard(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 8 seconds.');
  // Each second the count goes down, and nothing a screen reader hears changes.
  const said = heard(alert);
  const watching = new MutationObserver(() => {});
  watching.observe(alert, { subtree: true, childList: true, characterData: true });
  for (let second = 0; second < 3; second++) {
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
  }
  const changed = watching.takeRecords().filter((record) => {
    const node = record.target instanceof Element ? record.target : record.target.parentElement;
    return node?.closest('[aria-hidden="true"]') === null;
  });
  watching.disconnect();
  expect(seen(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 5 s.');
  expect(heard(alert)).toBe(said);
  // What changed is only what a screen reader doesn't hear.
  expect(changed).toEqual([]);
  // Run out, it stops at a second until what it waits for comes.
  for (let second = 0; second < 10; second++) {
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
  }
  expect(seen(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 1 s.');
  expect(vi.getTimerCount()).toBe(0);
});

test('reads anew for a new time to count to, once', () => {
  vi.useFakeTimers({ now: 1_000_000 });
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  act(() => root.render(<TooltipGroup>{retrying(1_000_000 + 8_000)}</TooltipGroup>));
  const alert = host.querySelector('[role="alert"]')!;
  act(() => {
    vi.advanceTimersByTime(3_000);
  });
  act(() => root.render(<TooltipGroup>{retrying(Date.now() + 180_000)}</TooltipGroup>));
  expect(seen(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 3 min.');
  expect(heard(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 3 minutes.');
  for (let second = 0; second < 65; second++) {
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
  }
  expect(seen(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 2 min.');
  expect(heard(alert)).toBe('Can’t fetch the overviewOffline. Retrying in 3 minutes.');
});
