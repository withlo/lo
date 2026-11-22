// @vitest-environment jsdom
// Settings' row for the `lo` command: where it's installed, and how the last install went, on the
// row itself.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, expect, it, onTestFinished } from 'vitest';

import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { rows } from '../../settings/window/shared.ts';
import type { CommandState, Installed } from '../contract.ts';
import CommandLine from './CommandLine.tsx';
import { commandStore, installCommand } from './command.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** What main says: where the command is, and what an install does. */
const said: { state: CommandState; done?: Installed } = { state: { installed: [] } };
installBridge({ 'open.command': () => said.state, 'open.installCommand': () => said.done });

/** Main, saying the command is at `state` and that an install does `done`. */
function main(state: CommandState, done?: Installed): void {
  said.state = state;
  said.done = done;
}

/** The row, as Settings draws it. */
async function render(): Promise<HTMLElement> {
  commandStore.setState({ state: undefined, installing: false, said: undefined, done: null });
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <Slots views={[CommandLine]}>
        <Slot slot={rows} props={{}} />
      </Slots>,
    );
    await Promise.resolve();
  });
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

it('says what the command does, then where it is and whose it is', async () => {
  main({ installed: [] });
  const host = await render();
  expect(host.querySelector('.text-ui-strong')?.textContent).toBe('lo command');
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    'Opens a pull request from a terminal with lo <link>.',
  );
  expect(host.querySelector('button')?.textContent).toContain('Install');
  act(() =>
    commandStore.setState({ state: { installed: [{ path: '/opt/bin/lo', current: false }] } }),
  );
  expect(host.querySelector('[role="status"]')?.textContent).toBe(
    'Installed at /opt/bin/lo. It opens another copy of Lo.',
  );
  expect(host.querySelector('button')?.textContent).toContain('Install again');
});

it('shows how the last install went on the row', async () => {
  main({ installed: [] }, { kind: 'installed', path: '/opt/bin/lo', onPath: false });
  const host = await render();
  await act(async () => {
    await installCommand();
  });
  expect(host.textContent).toContain('Add /opt/bin to PATH.');
  main({ installed: [] }, { kind: 'taken', path: '/opt/bin/lo' });
  await act(async () => {
    await installCommand();
  });
  expect(host.textContent).toContain('Couldn’t install the lo command');
  expect(host.textContent).toContain('Another lo file is already there.');
});
