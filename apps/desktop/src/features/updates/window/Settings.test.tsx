// @vitest-environment jsdom
// Settings' About rows for updates: this Lo's version with "Check now", which runs the check and
// says on the row what it found, the update on offer, and the switch for checking by itself, which
// changes `updates.check` and nothing else.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { notice, notices, withdraw } from '../../../window/commands/notices.tsx';
import { Slots, useViews } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { rows } from '../../settings/window/shared.ts';
import { RELEASES } from '../contract.ts';
import feature from './index.ts';
import { Offer } from './Offer.tsx';
import { showVersion, updatesStore } from './store.ts';

let finish: (answer: unknown) => void = () => {};
/** What main says of this Lo, when the window asks. */
let info: Record<string, unknown> = {};
const bridge = installBridge({
  'app.info': () => info,
  'updates.how': () => 'page',
  'updates.read': () => ({ status: 'idle' }),
  'updates.check': () =>
    new Promise((resolve) => {
      finish = resolve;
    }),
  'settings.set': () => undefined,
  'tab.openExternal': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(() => {
  bridge.calls.length = 0;
  act(() => {
    updatesStore.setState({ state: { status: 'idle' }, checkedAt: undefined, failed: undefined });
    showVersion('0.1.0', { kind: 'commit', commit: '0123456' });
  });
});

afterEach(() => {
  document.body.replaceChildren();
  for (const note of notices()) withdraw(note.title, note.body);
});

/** The rows features put in Settings' slot, as the Settings page draws them. */
function Rows() {
  return useViews(rows).map((view) => <div key={view.id}>{view.render({})}</div>);
}

function draw(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={feature.views ?? []}>
        <Rows />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
  });
  return host;
}

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find((each) => each.textContent.startsWith(name));

describe('the About rows', () => {
  it('are rows of Settings › About', () => {
    const views = (feature.views ?? []).filter((each) => each.slot === rows);
    expect(views.map(({ id }) => id)).toEqual(['updates.version', 'updates.check']);
    expect(views.map((view) => Reflect.get(view, 'group'))).toEqual(['about', 'about']);
  });

  it('show this Lo’s version, and the switch for checking by itself', () => {
    const page = draw();
    expect(page.textContent).toContain('Lo 0.1.0');
    expect(page.textContent).toContain('Check for updates automatically');
    expect(page.textContent).toContain('Checks at startup, then every 6 h.');
    const toggle = page.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-label')).toBe('Check for updates automatically');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });

  it('change only the setting from the switch', async () => {
    const page = draw();
    await act(async () => page.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(bridge.calls).toEqual([['settings.set', { key: 'updates.check', value: false }]]);
  });

  it('show the commit this Lo is built from beside its version, once main has said', () => {
    expect(draw().textContent).toContain('Commit 0123456');
    act(() => showVersion('0.1.0', { kind: 'source' }));
    expect(draw().textContent).toContain('Built from source');
    act(() => showVersion('0.1.0'));
    expect(draw().textContent).not.toContain('Commit');
    expect(draw().textContent).not.toContain('Built from source');
  });

  it('ask main for it with its version: a packaged Lo says its commit, a source build says so', async () => {
    for (const [said, shown] of [
      [
        { version: '0.2.0', packaged: true, commit: '89abcde' },
        { kind: 'commit', commit: '89abcde' },
      ],
      [{ version: '0.2.0', packaged: false, commit: '89abcde' }, { kind: 'source' }],
    ] as const) {
      act(() => updatesStore.setState({ version: undefined, build: undefined }));
      info = said;
      feature.start?.();
      await vi.waitFor(() => expect(updatesStore.getState().build).toEqual(shown));
      expect(updatesStore.getState().version).toBe('0.2.0');
    }
  });

  it('say only "Lo" until main has said which version', () => {
    act(() => updatesStore.setState({ version: undefined }));
    expect(draw().textContent).toContain('Lo');
    expect(draw().textContent).not.toContain('Lo 0.');
  });

  it('check on "Check now", once while it goes, and say on the row when it checked', async () => {
    const page = draw();
    expect(bridge.calls).toEqual([]);
    await act(async () => button(page, 'Check now')?.click());
    expect(bridge.calls).toEqual([['updates.check', undefined]]);
    // The button says it's checking, stays where it is with focus, and presses again do nothing.
    const busy = button(page, 'Check now');
    expect(busy?.getAttribute('aria-busy')).toBe('true');
    await act(async () => busy?.click());
    expect(bridge.calls).toHaveLength(1);
    await act(async () => {
      finish({ status: 'newest', version: '0.1.0' });
      await Promise.resolve();
    });
    expect(button(page, 'Check now')?.getAttribute('aria-busy')).toBeNull();
    expect(page.textContent).toContain('Checked just now');
    // Said here, so no note says it again.
    expect(notice()).toBeUndefined();
  });

  it('say why a check failed on the row, with a way to try again', async () => {
    const page = draw();
    await act(async () => button(page, 'Check now')?.click());
    await act(async () => {
      finish({ status: 'failed', why: 'timeout' });
      await Promise.resolve();
    });
    expect(page.textContent).toContain('Couldn’t check for updates');
    expect(page.textContent).toContain('GitHub didn’t respond.');
    expect(page.textContent).not.toContain('Checked');
    expect(button(page, 'Try again')).toBeDefined();
  });

  it('offer Lo’s releases on GitHub where this copy can’t check, as a build from source', async () => {
    const page = draw();
    await act(async () => button(page, 'Check now')?.click());
    await act(async () => {
      finish({ status: 'failed', why: 'source' });
      await Promise.resolve();
    });
    expect(page.textContent).toContain('Can’t check for updates');
    expect(page.textContent).toContain('This copy of Lo is built from source.');
    expect(button(page, 'Try again')).toBeUndefined();
    bridge.calls.length = 0;
    await act(async () => button(page, 'Open on GitHub')?.click());
    expect(bridge.calls).toEqual([['tab.openExternal', { url: RELEASES }]]);
  });

  it('show the update on offer under the version', () => {
    const page = draw();
    act(() => updatesStore.setState({ state: { status: 'ready', version: '0.2.0' } }));
    expect(page.textContent).toContain('Lo 0.2.0 is ready');
    act(() =>
      updatesStore.setState({
        state: { status: 'downloading', version: '0.2.0', received: 0, total: 0 },
      }),
    );
    expect(page.textContent).toContain('Downloading Lo 0.2.0…');
  });

  it('have the toast step aside while the offer under the version is in view, and come back after', () => {
    const toast = document.createElement('div');
    document.body.append(toast);
    const region = createRoot(toast);
    act(() => region.render(<Offer />));
    onTestFinished(() => {
      act(() => region.unmount());
    });
    act(() => updatesStore.setState({ state: { status: 'ready', version: '0.2.0' } }));
    expect(toast.textContent).toContain('Lo 0.2.0 is ready');

    const host = document.createElement('div');
    document.body.append(host);
    const settings = createRoot(host);
    act(() =>
      settings.render(
        <Slots views={feature.views ?? []}>
          <Rows />
        </Slots>,
      ),
    );
    // A test has no layout to tell, so the offer counts as in view, and is said once, on the row.
    expect(host.textContent).toContain('Lo 0.2.0 is ready');
    expect(toast.textContent).toBe('');

    act(() => settings.unmount());
    expect(toast.textContent).toContain('Lo 0.2.0 is ready');
  });

  it('have the toast step aside for an offer that comes while the version is in view', () => {
    const toast = document.createElement('div');
    document.body.append(toast);
    const region = createRoot(toast);
    act(() => region.render(<Offer />));
    onTestFinished(() => {
      act(() => region.unmount());
    });
    const page = draw();
    act(() => updatesStore.setState({ state: { status: 'ready', version: '0.2.0' } }));
    expect(page.textContent).toContain('Lo 0.2.0 is ready');
    expect(toast.textContent).toBe('');
  });
});
