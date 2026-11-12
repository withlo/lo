// @vitest-environment jsdom
// Settings' Command line section: the `lo` command's row, then the rows other features put in the
// section's slot, in their order.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished } from 'vitest';

import { Slot, Slots, defineView } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { sections } from '../../settings/window/shared.ts';
import CommandLine from './CommandLine.tsx';
import { commandLine } from './shared.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  installBridge({ 'open.command': () => ({ installed: [] }) });
});

/** A view's component that draws a row called `name`. */
const row = (name: string) => () => <div data-testid="extra">{name}</div>;

it('lists the rows other features add after the lo command’s, by their order', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Slots
        views={[
          CommandLine,
          defineView(commandLine, { id: 'test.second', order: 20, render: row('second') }),
          defineView(commandLine, { id: 'test.first', order: 10, render: row('first') }),
        ]}
      >
        <Slot slot={sections} props={{}} />
      </Slots>,
    );
    await Promise.resolve();
  });
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  const texts = [...host.querySelectorAll('.text-ui-strong, [data-testid="extra"]')].map(
    (each) => each.textContent,
  );
  expect(texts).toEqual(['The lo command', 'first', 'second']);
});
