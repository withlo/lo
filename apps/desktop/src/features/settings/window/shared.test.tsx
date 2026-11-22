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
  ago,
  changeSetting,
  defineRow,
  rows,
  settingRow,
  useProblems,
  useKnownSetting,
  useSetting,
  useSettingsFile,
  watchSetting,
} from './shared.ts';
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
  {
    group: 'pullRequests',
    label: 'Diff layout',
    description: 'How a diff shows its old and new sides.',
    options: { split: 'Side by side', inline: 'Inline' },
  },
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
  return useViews(rows)
    .map(({ id, group, label }) => `${id}:${group}:${label}`)
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

describe('settingRow and defineRow', () => {
  it('make views of the slot, in their order, with what search reads of each', () => {
    const cache = defineRow({
      id: 'test.cache',
      group: 'storage',
      order: 20,
      label: 'Cache',
      description: 'Local copies.',
      render: () => 'a',
    });
    const row = settingRow(layout, { order: 10 });
    expect(row).toMatchObject({
      slot: rows,
      id: 'diff.layout',
      order: 10,
      group: 'pullRequests',
      settingKey: 'diff.layout',
    });
    const shown = render(
      <Slots views={[cache, row]}>
        <Names />
      </Slots>,
    );
    expect(shown.text()).toBe('diff.layout:pullRequests:Diff layout test.cache:storage:Cache');
  });

  it('refuse a setting only in the file, and one with no control to draw', () => {
    const gpu = defineSetting('app.gpu', z.boolean(), true, 'true or false', {
      group: 'file',
      label: 'Hardware acceleration',
      description: 'Draws with the graphics card.',
    });
    expect(() => settingRow(gpu, { order: 1 })).toThrow('only in the settings file');
    const name = defineSetting('test.name', z.string(), '', 'text', {
      group: 'about',
      label: 'Name',
      description: 'A name.',
    });
    expect(() => settingRow(name, { order: 1 })).toThrow('needs a control of its own');
  });
});

describe('watchSetting', () => {
  it('hears the value once main has said, then each change, and nothing that changes nothing', () => {
    act(() => settingsStore.setState({ settings: undefined }));
    const heard: string[] = [];
    const stop = watchSetting(layout, (value) => heard.push(value));
    expect(heard).toEqual([]);
    act(() => showSettings(state({ 'diff.layout': 'split' })));
    act(() => showSettings(state({ 'diff.layout': 'split', theme: 'dark' })));
    act(() => showSettings(state({ 'diff.layout': 'inline' })));
    stop();
    act(() => showSettings(state({})));
    expect(heard).toEqual(['split', 'inline']);
  });
});

describe('ago', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');

  it('says a time as how long ago it was, then as its date', () => {
    expect(ago(now - 30 * 1000, now)).toBe('just now');
    expect(ago(now - 5 * 60 * 1000, now)).toBe('5 min ago');
    expect(ago(now - 2 * 60 * 60 * 1000, now)).toBe('2 h ago');
    expect(ago(Date.parse('2026-11-03T12:00:00.000Z'), now)).toBe('12 d ago');
    expect(ago(Date.parse('2026-09-12T12:00:00.000Z'), now)).toBe('Sep 12');
    expect(ago(Date.parse('2025-11-12T12:00:00.000Z'), now)).toBe('Nov 12, 2025');
    expect(ago(Number.NaN, now)).toBe('just now');
  });
});
