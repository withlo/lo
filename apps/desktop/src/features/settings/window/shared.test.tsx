// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { Slots, useViews } from '../../../window/slots.tsx';
import { IpcError } from '../../../ipc/contract.ts';
import { defineSetting, type SettingsState } from '../contract.ts';
import { z } from 'zod';
import {
  changeSetting,
  defineSection,
  sections,
  useProblems,
  useKnownSetting,
  useSetting,
  useSettingsFile,
} from './shared.ts';
import { sectionInfo } from './sections.ts';
import { settingsStore, showSettings } from './store.ts';
import { installBridge } from '../../../window/test/bridge.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const layout = defineSetting(
  'diff.layout',
  z.enum(['split', 'inline']),
  'split',
  'split or inline',
);

const state = (values: SettingsState['values'], problems: SettingsState['problems'] = []) =>
  ({ file: '~/.config/lo/settings.json', values, problems }) satisfies SettingsState;

afterEach(() => {
  // Back to before main said anything.
  showSettings(state({}));
});

/** Renders `element` into a fresh root, and what it shows. */
function render(element: ReactNode): { text: () => string } {
  const container = document.createElement('div');
  const root = createRoot(container);
  act(() => root.render(element));
  onTestFinished(() => act(() => root.unmount()));
  return { text: () => container.textContent };
}

function Layout() {
  return useSetting(layout);
}

describe('useSetting', () => {
  it('is the setting’s value as main last said, and re-renders when it changes', () => {
    showSettings(state({ 'diff.layout': 'inline' }));
    const shown = render(<Layout />);
    expect(shown.text()).toBe('inline');
    act(() => showSettings(state({ 'diff.layout': 'split' })));
    expect(shown.text()).toBe('split');
  });

  it('is the default until main has said, and when what it said is not a value the schema takes', () => {
    const shown = render(<Layout />);
    expect(shown.text()).toBe('split');
    act(() => showSettings(state({ 'diff.layout': 'wrapped' })));
    expect(shown.text()).toBe('split');
    act(() => showSettings(state({ 'diff.layout': 4 })));
    expect(shown.text()).toBe('split');
  });
});

function KnownLayout() {
  return useKnownSetting(layout) ?? 'not known';
}

describe('useKnownSetting', () => {
  it('is nothing until main has said, then the value, or the default for one the schema refuses', () => {
    settingsStore.setState({ settings: undefined });
    const shown = render(<KnownLayout />);
    expect(shown.text()).toBe('not known');
    act(() => showSettings(state({ 'diff.layout': 'inline' })));
    expect(shown.text()).toBe('inline');
    act(() => showSettings(state({ 'diff.layout': 'wrapped' })));
    expect(shown.text()).toBe('split');
  });
});

/** What is wrong in the file, and which file it is, as a string. */
function Problems() {
  const problems = useProblems();
  return `${useSettingsFile() ?? 'no file'}: ${problems.map(({ message }) => message).join(', ')}`;
}

/** The ids of the views in the sections slot. */
function Names() {
  return useViews(sections)
    .map(({ id }) => id)
    .join(' ');
}

describe('useProblems and useSettingsFile', () => {
  it('say what is wrong in the file, and where it is', () => {
    const shown = render(<Problems />);
    expect(shown.text()).toBe('~/.config/lo/settings.json: ');
    act(() =>
      showSettings(state({}, [{ message: 'Not JSON.' }, { key: 'theme', message: 'Bad.' }])),
    );
    expect(shown.text()).toBe('~/.config/lo/settings.json: Not JSON., Bad.');
  });
});

describe('changeSetting', () => {
  it('asks main to change the setting, with the value the schema made of it', async () => {
    const bridge = installBridge({ 'settings.set': () => undefined });
    expect(await changeSetting(layout, 'inline')).toBe(true);
    expect(bridge.calls).toEqual([['settings.set', { key: 'diff.layout', value: 'inline' }]]);
    expect(notice()).toBeUndefined();
  });

  it('says why in a note when main refuses, and resolves false', async () => {
    installBridge({
      'settings.set': () => {
        throw new IpcError(
          'unwritable',
          "Lo didn't change diff.layout, since the file has a problem.",
        );
      },
    });
    expect(await changeSetting(layout, 'inline')).toBe(false);
    expect(notice()).toEqual({
      title: 'Settings',
      body: "Lo didn't change diff.layout, since the file has a problem.",
    });
  });

  it('says only what Lo can safely say when something else went wrong', async () => {
    installBridge({
      'settings.set': () => {
        throw new IpcError('internal', 'settings.set failed.');
      },
    });
    expect(await changeSetting(layout, 'inline')).toBe(false);
    expect(notice()?.body).toBe("Lo couldn't change diff.layout.");
  });
});

describe('defineSection', () => {
  it('makes a view of the slot, in its order, and keeps what the page says of it', () => {
    const second = defineSection({
      id: 'test.second',
      title: 'Second',
      order: 20,
      render: () => 'b',
    });
    const first = defineSection({
      id: 'test.first',
      title: 'First',
      description: 'The first.',
      order: 10,
      render: () => 'a',
    });
    expect(first.slot).toBe(sections);
    expect(first.order).toBe(10);
    expect(sectionInfo.get('test.first')).toEqual({ title: 'First', description: 'The first.' });
    expect(sectionInfo.get('test.second')).toEqual({ title: 'Second' });
    const shown = render(
      <Slots views={[second, first]}>
        <Names />
      </Slots>,
    );
    expect(shown.text()).toBe('test.first test.second');
  });

  it('is named for its feature, like any view', () => {
    expect(() =>
      defineSection({ id: 'second', title: 'Second', order: 1, render: () => null }),
    ).toThrow('A view is named <feature>.<name>');
  });
});
