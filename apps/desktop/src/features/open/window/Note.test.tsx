// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished, vi } from 'vitest';

import { LinkNote } from './Note.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

it('says its title and reason from a region drawn empty and filled after, so it’s read', () => {
  vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  act(() =>
    root.render(<LinkNote title="This link isn’t secure" reason="It’s `http`, not `https`." />),
  );
  const region = host.querySelector('[role="status"]');
  expect(region?.textContent).toBe('');
  act(() => {
    vi.advanceTimersToNextFrame();
  });
  expect(region?.textContent).toBe('This link isn’t secure. It’s http, not https.');
  // What shows has no live region of its own, so nothing is read twice.
  expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
});
