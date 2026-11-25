// @vitest-environment jsdom
// The row for what a pull request's tab opens on, as the welcome's step that says what an overview
// is draws it, with the middle views there as features list them and main answered by a stand-in
// bridge.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { defineView, Slots, type Presence } from '../../../window/slots.tsx';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import { OpenOnRow } from './OpenOn.tsx';
import { middle } from './shared.ts';

/** Whether there are overviews, as the overview feature says, which a test turns off and on. */
const overviews = (() => {
  let on = true;
  const listeners = new Set<() => void>();
  const presence: Presence = {
    now: () => on,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    presence,
    set(next: boolean) {
      on = next;
      for (const listener of listeners) listener();
    },
  };
})();

/** The middle views, as the overview, the timeline and the diff list them. */
const VIEWS = [
  defineView(middle, {
    id: 'overview.view',
    order: 10,
    label: 'Overview',
    render: () => null,
    present: overviews.presence,
  }),
  defineView(middle, { id: 'diff.view', order: 20, label: 'Diff', render: () => null }),
  defineView(middle, { id: 'timeline.view', order: 30, label: 'Timeline', render: () => null }),
];

const answers: Record<string, (input: unknown) => unknown> = {};
let bridge: FakeBridge;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  bridge = installBridge(answers);
});

function render(): HTMLElement {
  const host = document.createElement('ul');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={VIEWS}>
        <OpenOnRow />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
    overviews.set(true);
  });
  return host;
}

/** The choice's options, and the one chosen. */
function choice(row: HTMLElement): { options: string[]; chosen: string | undefined } {
  const options = [...row.querySelectorAll('[role="radio"]')];
  return {
    options: options.map((option) => option.textContent),
    chosen: options.find((option) => option.getAttribute('aria-checked') === 'true')?.textContent,
  };
}

describe('the welcome’s row for what a tab opens on', () => {
  it('is the choice and the line Settings has, and writes a view as it’s chosen', async () => {
    answers['settings.set'] = () => undefined;
    bridge.calls.length = 0;
    const row = render();
    expect(row.querySelector('.text-ui-strong')?.textContent).toBe('Open pull requests on');
    expect(row.textContent).toContain(
      'With Overview, a pull request that has none opens on the timeline.',
    );
    expect(choice(row)).toEqual({ options: ['Overview', 'Timeline', 'Diff'], chosen: 'Overview' });
    const timeline = [...row.querySelectorAll('[role="radio"]')][1];
    act(() => {
      timeline?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    const writes = bridge.calls.filter(([channel]) => channel === 'settings.set');
    expect(writes.map(([, input]) => input)).toEqual([{ key: 'tab.open', value: 'timeline' }]);
  });

  it('offers Timeline and Diff alone while overviews are off, and chooses neither for Overview', () => {
    const row = render();
    act(() => overviews.set(false));
    expect(choice(row)).toEqual({ options: ['Timeline', 'Diff'], chosen: undefined });
    expect(row.textContent).toContain('The timeline starts with the pull request’s description.');
  });
});
