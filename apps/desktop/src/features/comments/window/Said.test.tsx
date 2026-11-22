// @vitest-environment jsdom
// What the comments say to a screen reader: one region, which each thing said changes.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, onTestFinished, test, vi } from 'vitest';

import { Said, SAID_FOR, tell } from './Said.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

test('the same words twice running are said twice: the region is empty for a frame between', () => {
  vi.useFakeTimers();
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
    vi.useRealTimers();
  });
  act(() => root.render(<Said />));
  const region = element.querySelector('[role="status"]');
  act(() => tell('Resolved thread'));
  expect(region?.textContent).toBe('Resolved thread');
  act(() => tell('Resolved thread'));
  expect(region?.textContent).toBe('');
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(region?.textContent).toBe('Resolved thread');
  // Said, it's gone after a moment, so the next is a change too.
  act(() => {
    vi.advanceTimersByTime(SAID_FOR);
  });
  expect(region?.textContent).toBe('');
});
