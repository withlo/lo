// @vitest-environment jsdom
// Settings' Updates section: this Lo's version with "Check now", which runs the check and says
// what it found, and the switch for checking by itself, which changes `updates.check` and nothing
// else.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { notice, notices, withdraw } from '../../../window/commands/notices.tsx';
import { Slots, useViews } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import type { Setting } from '../../settings/contract.ts';
import { sections } from '../../settings/window/shared.ts';
import { check as checkSetting } from '../settings.ts';
import feature from './index.ts';
import { showVersion, updatesStore } from './store.ts';

/** What Settings holds for `updates.check`, and what Settings was asked to change. */
const settings = vi.hoisted(() => ({ on: true, changed: [] as [string, unknown][] }));

vi.mock(import('../../settings/window/shared.ts'), async (original) => ({
  ...(await original()),
  useSetting: <T,>(setting: Setting<T>): T => setting.schema.parse(settings.on),
  changeSetting: <T,>(setting: Setting<T>, value: T): Promise<boolean> => {
    settings.changed.push([setting.key, value]);
    return Promise.resolve(true);
  },
}));

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
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

beforeEach(() => {
  settings.on = true;
  settings.changed.length = 0;
  bridge.calls.length = 0;
  act(() => showVersion('0.1.0', 'Commit 0123456'));
});

afterEach(() => {
  document.body.replaceChildren();
  for (const note of notices()) withdraw(note.title, note.body);
});

/** The sections of Settings that features put in its slot, as the Settings page draws them. */
function Sections() {
  return useViews(sections).map((view) => <div key={view.id}>{view.render({})}</div>);
}

function draw(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={feature.views ?? []}>
        <Sections />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
  });
  return host;
}

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find((each) => each.textContent === name);

describe('the Updates section', () => {
  it('is a section of Settings, after the others', () => {
    const [view] = (feature.views ?? []).filter((each) => each.slot === sections);
    expect(view).toMatchObject({ id: 'updates.settings', order: 80 });
  });

  it('shows this Lo’s version, and the switch for checking by itself', () => {
    const page = draw();
    expect(page.textContent).toContain('Lo 0.1.0');
    expect(page.textContent).toContain('Check for updates by itself');
    expect(page.textContent).toContain('Off, Lo checks only when you ask.');
    const toggle = page.querySelector('[role="switch"]');
    expect(toggle?.getAttribute('aria-label')).toBe('Check for updates by itself');
    expect(toggle?.getAttribute('aria-checked')).toBe('true');
  });

  it('shows the switch off when the setting is off, and changes only that setting', async () => {
    settings.on = false;
    const page = draw();
    const toggle = page.querySelector<HTMLElement>('[role="switch"]');
    expect(toggle?.getAttribute('aria-checked')).toBe('false');
    await act(async () => toggle?.click());
    expect(settings.changed).toEqual([[checkSetting.key, true]]);
    // The switch changes how Lo checks by itself, never asks it to check or to install.
    expect(bridge.calls).toEqual([]);
  });

  it('shows the commit this Lo is built from beside its version, once main has said', () => {
    expect(draw().textContent).toContain('Commit 0123456');
    act(() => showVersion('0.1.0', 'Run from source'));
    expect(draw().textContent).toContain('Run from source');
    act(() => showVersion('0.1.0'));
    expect(draw().textContent).not.toContain('Commit');
    expect(draw().textContent).not.toContain('Run from source');
  });

  it('asks main for it with its version: a packaged Lo says its commit, a source build says so', async () => {
    for (const [said, shown] of [
      [{ version: '0.2.0', packaged: true, commit: '89abcde' }, 'Commit 89abcde'],
      [{ version: '0.2.0', packaged: false, commit: '89abcde' }, 'Run from source'],
    ] as const) {
      act(() => updatesStore.setState({ version: undefined, build: undefined }));
      info = said;
      feature.start?.();
      await vi.waitFor(() => expect(updatesStore.getState().build).toBe(shown));
      expect(updatesStore.getState().version).toBe('0.2.0');
    }
  });

  it('says only "Lo" until main has said which version', () => {
    act(() => updatesStore.setState({ version: undefined }));
    expect(draw().textContent).toContain('Lo');
    expect(draw().textContent).not.toContain('Lo 0.');
  });

  it('checks on "Check now", once while it goes, and says what it found', async () => {
    const page = draw();
    expect(bridge.calls).toEqual([]);
    await act(async () => button(page, 'Check now')?.click());
    expect(bridge.calls).toEqual([['updates.check', undefined]]);
    // The button says it's checking, stays where it is with focus, and presses again do nothing.
    const busy = button(page, 'Checking');
    expect(busy?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => busy?.click());
    expect(bridge.calls).toHaveLength(1);
    await act(async () => {
      finish({ status: 'newest', version: '0.1.0' });
      await Promise.resolve();
    });
    expect(button(page, 'Check now')).toBeDefined();
    expect(notice()?.title).toBe('Lo 0.1.0 is the newest version.');
  });
});
