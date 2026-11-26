// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { notice, notices } from '../../../window/commands/notices.tsx';
import { Slots, useViews } from '../../../window/slots.tsx';
import { IpcError } from '../../../ipc/contract.ts';
import { defineSetting, type SettingsState } from '../contract.ts';
import { z } from 'zod';
import {
  changeSetting,
  choiceOf,
  defineRow,
  rows,
  settingRow,
  useChoice,
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

  it('says why nothing happened in a toast when main refuses, and resolves false', async () => {
    installBridge({
      'settings.set': () => {
        // No reason of main's, only what failed, on the line after it.
        throw new IpcError('settingsFile', '\nsomething');
      },
    });
    expect(await changeSetting(layout, 'inline')).toBe(false);
    expect(notice()).toEqual({ title: 'settings.json has an error', body: '' });
    installBridge({
      'settings.set': () => {
        throw new IpcError('unsaved', '\nEIO');
      },
    });
    expect(await changeSetting(layout, 'split')).toBe(false);
    expect(notice()).toEqual({ title: 'settings.json couldn’t be saved', body: '' });
    // Main's reason, when it gives one, in plain words.
    installBridge({
      'settings.set': () => {
        throw new IpcError('settingsFile', '`settings.json` isn’t valid JSON.\nValueExpected');
      },
    });
    expect(await changeSetting(layout, 'split')).toBe(false);
    expect(notice()).toEqual({ title: 'settings.json isn’t valid JSON', body: '' });
  });

  it('says what couldn’t change when something else went wrong', async () => {
    installBridge({
      'settings.set': () => {
        throw new IpcError('internal', 'settings.set failed.');
      },
    });
    expect(await changeSetting(layout, 'inline')).toBe(false);
    expect(notice()).toEqual({ title: 'Couldn’t change the diff layout', body: '' });
  });
});

/** Defining the row test.version with `description` as its line. */
const versionRow = (description: string) => () =>
  defineRow({
    id: 'test.version',
    group: 'about',
    order: 1,
    label: 'Lo',
    description,
    render: () => 'a',
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

  it('refuse a row with no line, one past 90 characters, or one without a full stop', () => {
    const said = 'The description of the row test.version is one line of 90 characters at most';
    expect(versionRow('')).toThrow(said);
    expect(versionRow(`${'x'.repeat(90)}.`)).toThrow(said);
    expect(versionRow('No full stop')).toThrow(said);
    expect(versionRow('The version in use.')).not.toThrow();
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

describe('choiceOf and useChoice', () => {
  const choice = choiceOf(layout);

  /** The choice as a screen shows it: its value, and its problem's words once there is one. */
  let changing: ((value: 'split' | 'inline') => Promise<void>) | undefined;
  function Offered() {
    const { value, onFile, change, problem } = useChoice(choice);
    changing = change;
    return (
      <>
        {value} on file: {onFile ?? 'nothing'}
        {problem}
      </>
    );
  }

  it('say what the setting says of itself: its key, label, options and place in Settings', () => {
    expect(choice).toMatchObject({
      key: 'diff.layout',
      label: 'Diff layout',
      place: 'Settings › Pull requests',
      options: [
        { value: 'split', label: 'Side by side' },
        { value: 'inline', label: 'Inline' },
      ],
    });
    const name = defineSetting('test.name', z.string(), '', 'text', {
      group: 'about',
      label: 'Name',
      description: 'A name.',
    });
    expect(() => choiceOf(name)).toThrow('isn’t a choice with a row in Settings');
    // A line for each option's card, where the feature gives one.
    expect(choiceOf(layout, { split: 'Two columns.', inline: 'One column.' }).options).toEqual([
      { value: 'split', label: 'Side by side', description: 'Two columns.' },
      { value: 'inline', label: 'Inline', description: 'One column.' },
    ]);
  });

  it('read the value on file, or the default until main has said or for one not an option', () => {
    act(() => settingsStore.setState({ settings: undefined }));
    const shown = render(<Offered />);
    // Nothing is on file before main has said, or with a value that isn't an option.
    expect(shown.text()).toBe('split on file: nothing');
    act(() => showSettings(state({ 'diff.layout': 'inline' })));
    expect(shown.text()).toBe('inline on file: inline');
    act(() => showSettings(state({ 'diff.layout': 'wrapped' })));
    expect(shown.text()).toBe('split on file: nothing');
    // With none in the file, the default is what it holds.
    act(() => showSettings(state({})));
    expect(shown.text()).toBe('split on file: split');
  });

  it('write a change, and say why the file refused one, with no toast, until the file changes', async () => {
    const bridge = installBridge({
      'settings.set': () => {
        throw new IpcError('settingsFile', '`settings.json` isn’t valid JSON.\nValueExpected');
      },
    });
    const shown = render(<Offered />);
    const toasts = notices().length;
    await act(() => changing?.('inline'));
    expect(bridge.calls).toEqual([['settings.set', { key: 'diff.layout', value: 'inline' }]]);
    expect(shown.text()).toContain('Couldn’t change the diff layout');
    expect(shown.text()).toContain('settings.json isn’t valid JSON.');
    expect(shown.text()).toContain('Open settings.json');
    expect(notices()).toHaveLength(toasts);
    // The file changed: what it was about may be gone.
    act(() => showSettings(state({ theme: 'dark' }, [{ message: 'Fixed' }])));
    expect(shown.text()).toBe('split on file: split');
  });
});
