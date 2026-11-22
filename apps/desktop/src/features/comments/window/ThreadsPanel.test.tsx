// @vitest-environment jsdom
// The threads panel when its threads couldn't be read: why, and a way to read them again, which
// waits as the first read did, and says so again if it couldn't even be asked for.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, onTestFinished, test } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import { Failed } from './ThreadsPanel.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

test('a read again that can’t be asked for shows why the threads can’t be shown again', async () => {
  // Main doesn't answer: the ask for a read again is refused.
  const bridge = installBridge();
  const element = document.createElement('div');
  document.body.append(element);
  const root = createRoot(element);
  onTestFinished(() => {
    act(() => root.unmount());
    element.remove();
  });
  act(() => root.render(<Failed view="view-1" reason="Offline." />));
  expect(element.textContent).toContain('Can’t show the threads');
  const again = [...element.querySelectorAll('button')].find(
    (each) => each.textContent === 'Try again',
  )!;
  await act(async () => {
    again.click();
    await Promise.resolve();
  });
  expect(bridge.calls.map(([channel]) => channel)).toEqual(
    expect.arrayContaining([expect.stringContaining('reread')]),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve));
  });
  expect(element.textContent).toContain('Can’t show the threads');
  expect(element.textContent).toContain('Offline.');
  // What came back is behind Details.
  expect([...element.querySelectorAll('button')].map((each) => each.textContent)).toContain(
    'Details',
  );
});
