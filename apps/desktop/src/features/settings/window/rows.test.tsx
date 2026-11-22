// @vitest-environment jsdom
// This feature's rows of Settings: the theme and motion, the cache and its limit, and the keymap
// file and every key.
import { defineCommands, handlers, holdRegistry, NO_TARGET, type Registry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import { z } from 'zod';

import { IpcError } from '../../../ipc/contract.ts';
import { applyKeymapFile, keymapState } from '../../../window/commands/keymap.ts';
import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { Slot, Slots, type View } from '../../../window/slots.tsx';
import keysFeature from '../../keys/keys.ts';
import { defineSetting, type CacheUsage, type SettingsState } from '../contract.ts';
import Appearance from './Appearance.tsx';
import Cache from './Cache.tsx';
import Keys from './Keys.tsx';
import { rows, settingRow } from './shared.ts';
import { cacheStore } from './storage.ts';
import { showSettings } from './store.ts';
import { installBridge } from '../../../window/test/bridge.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const settings = (values: SettingsState['values'] = {}) =>
  ({ file: '~/.config/lo/settings.json', values, problems: [] }) satisfies SettingsState;

beforeEach(() => {
  showSettings(settings());
  // Each test's cache is measured afresh.
  cacheStore.setState({ usage: undefined });
});

afterEach(() => {
  vi.useRealTimers();
});

/** Renders rows' views into a fresh root, in the slot they're made for. */
function render(views: readonly View[]) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Slots views={views}>
        <Slot slot={rows} props={{}} />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

/** Lets what's waiting on a reply from main settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((done) => setTimeout(done, 0));
  });
}

/** A click on `element`, as a person's. */
function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** An answer to `cacheUsage` that is each of `answers` in turn, and then the last for ever. */
function usage(...answers: CacheUsage[]): () => CacheUsage | undefined {
  const rest = [...answers];
  return () => (rest.length > 1 ? rest.shift() : rest[0]);
}

/** Types into `input` as a person does: React hears of it as it would of a key. */
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    // The setter every input has, which React's own copy of the value doesn't see.
    Reflect.set(HTMLInputElement.prototype, 'value', text, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Presses ⏎ in `input`. */
function enter(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
}

/** Leaves `input`. */
function leave(input: HTMLInputElement): void {
  act(() => {
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  });
}

/** The size limit's field, in a Cache that has been measured, and the requests made so far. */
async function sizeField() {
  const bridge = installBridge({
    'settings.cacheUsage': usage({ status: 'unavailable' }),
    'settings.set': () => undefined,
  });
  const container = render(Cache);
  await settle();
  const input = container.querySelector<HTMLInputElement>('input');
  if (!input) throw new Error('No field.');
  return { container, input, calls: bridge.calls };
}

/** The requests that changed a setting. */
const sets = (calls: [string, unknown][]) =>
  calls.filter(([channel]) => channel === 'settings.set');

/** The theme's choices, and whether each is the one chosen. */
const themes = (container: HTMLElement) =>
  [...container.querySelectorAll('[role="radiogroup"][aria-label="Theme"] [role="radio"]')].map(
    (each) => [each.textContent, each.getAttribute('aria-checked')],
  );

describe('Appearance', () => {
  it('draws each row from its setting: label, line, key, and a choice of its options', () => {
    showSettings(settings({ theme: 'light' }));
    const container = render(Appearance);
    const [theme, motion] = container.querySelectorAll('.setting-row');
    expect(theme?.getAttribute('data-setting')).toBe('theme');
    expect(theme?.textContent).toContain('Theme');
    expect(motion?.getAttribute('data-setting')).toBe('motion.reduce');
    expect(themes(container)).toEqual([
      ['Dark', 'false'],
      ['Light', 'true'],
      ['System', 'false'],
    ]);
  });

  it('asks main to change the theme to the one chosen, which then follows what main says', async () => {
    const bridge = installBridge({ 'settings.set': () => undefined });
    const container = render(Appearance);
    click(container.querySelector('[role="radiogroup"][aria-label="Theme"] [role="radio"]'));
    await settle();
    expect(bridge.calls).toEqual([['settings.set', { key: 'theme', value: 'dark' }]]);
    // Nothing changed until main says so.
    expect(themes(container).find(([, checked]) => checked === 'true')?.[0]).toBe('System');
    act(() => showSettings(settings({ theme: 'dark' })));
    expect(themes(container).find(([, checked]) => checked === 'true')?.[0]).toBe('Dark');
  });

  it('offers Reset while a setting isn’t its default, which puts the default back', async () => {
    const bridge = installBridge({ 'settings.set': () => undefined });
    const container = render(Appearance);
    expect(container.querySelector('[data-reset]')).toBeNull();
    act(() => showSettings(settings({ theme: 'dark' })));
    click(container.querySelector('[data-reset]'));
    await settle();
    expect(bridge.calls).toEqual([['settings.set', { key: 'theme', value: 'system' }]]);
  });

  it('says a change main couldn’t save as a problem under the row, which tries it again, and keeps the value the file has', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const bridge = installBridge({
      'settings.set': () => {
        throw new IpcError('unsaved', '\nEACCES');
      },
    });
    const container = render(Appearance);
    click(container.querySelector('[role="radiogroup"][aria-label="Theme"] [role="radio"]'));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t change the theme settings.json couldn’t be saved.',
    );
    // What failed, in its own words, is behind Details.
    expect(container.textContent).not.toContain('EACCES');
    click([...container.querySelectorAll('button')].find((each) => each.textContent === 'Details'));
    expect(container.textContent).toContain('EACCES');
    expect(themes(container).find(([, checked]) => checked === 'true')?.[0]).toBe('System');
    click(
      [...container.querySelectorAll('button')].find((each) => each.textContent === 'Try again'),
    );
    await settle();
    expect(sets(bridge.calls)).toEqual([
      ['settings.set', { key: 'theme', value: 'dark' }],
      ['settings.set', { key: 'theme', value: 'dark' }],
    ]);
  });

  it('offers nothing to try again for a change main refused outright', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    installBridge({
      'settings.set': () => {
        throw new IpcError('unwritable', 'theme is only the file’s to change.');
      },
    });
    const container = render(Appearance);
    click(container.querySelector('[role="radiogroup"][aria-label="Theme"] [role="radio"]'));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t change the theme',
    );
    expect(
      [...container.querySelectorAll('button')].some((each) => each.textContent === 'Try again'),
    ).toBe(false);
  });

  it('says a change the file’s error kept from being made, with the way to the file, until the file changes', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const broken = {
      ...settings(),
      problems: [{ message: 'Line 2, column 1 isn’t valid JSON.' }],
    } satisfies SettingsState;
    showSettings(broken);
    installBridge({
      'settings.set': () => {
        throw new IpcError(
          'settingsFile',
          '`settings.json` isn’t valid JSON.\nPropertyNameExpected at line 2, column 1',
        );
      },
    });
    const container = render(Appearance);
    click(container.querySelector('[role="radiogroup"][aria-label="Theme"] [role="radio"]'));
    await settle();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t change the theme settings.json isn’t valid JSON.',
    );
    expect(container.querySelector('[role="alert"] .code-small')?.textContent).toBe(
      'settings.json',
    );
    click([...container.querySelectorAll('button')].find((each) => each.textContent === 'Details'));
    expect(container.textContent).toContain('PropertyNameExpected at line 2, column 1');
    expect(
      [...container.querySelectorAll('button')].some(
        (each) => each.textContent === 'Open settings.json',
      ),
    ).toBe(true);
    // Fixed, the file says so, and the problem goes: it may have been what kept the change.
    act(() => showSettings(settings()));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('gives a setting’s key from a view in its control’s tooltip, not on the row', () => {
    const registry = createRegistry(
      [
        ...handlers(
          defineCommands('settings', {
            layout: { label: 'Inline or side by side', group: 'Diff view', keys: ['g i'] },
          }),
          { layout: { run: () => undefined } },
        ),
      ],
      'mac',
    );
    onTestFinished(holdRegistry(registry));
    const layout = defineSetting(
      'test.layout',
      z.enum(['split', 'inline']),
      'split',
      'split or inline',
      {
        group: 'pullRequests',
        label: 'Diff layout',
        description: 'How a diff shows its two sides.',
        options: { split: 'Side by side', inline: 'Inline' },
      },
    );
    const container = render([settingRow(layout, { order: 10, command: 'settings.layout' })]);
    expect(container.querySelector('kbd')).toBeNull();
    expect(container.querySelector('[role="radiogroup"]')).not.toBeNull();
  });
});

/** A cache that takes `used` bytes under the default limit. */
const ready = (used: number): CacheUsage => ({ status: 'ready', used, cap: 10 * 1024 ** 3 });

describe('Cache', () => {
  it('says how much room the local copies take against the limit, and the limit', async () => {
    installBridge({ 'settings.cacheUsage': usage(ready(6.2 * 1024 ** 3)) });
    const container = render(Cache);
    await settle();
    expect(container.textContent).toContain('6.2 GB');
    expect(container.textContent).toContain('6.2 GB of 10 GB');
    const meter = container.querySelector('[role="meter"]');
    expect(Number(meter?.getAttribute('aria-valuenow'))).toBeCloseTo(6.2 * 1024 ** 3, -3);
    expect(meter?.getAttribute('aria-valuemax')).toBe(String(10 * 1024 ** 3));
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('10');
  });

  it('measures against the limit the setting has, which follows it', async () => {
    showSettings(settings({ 'cache.cap': 20 }));
    installBridge({ 'settings.cacheUsage': usage(ready(1024 ** 3)) });
    const container = render(Cache);
    await settle();
    expect(container.textContent).toContain('1 GB of 20 GB');
    expect(container.querySelector<HTMLInputElement>('input')?.value).toBe('20');
  });

  it('says it is measuring until main has answered, and that there are no copies if it can’t be asked', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    installBridge({
      'settings.cacheUsage': () => {
        throw new IpcError('internal', 'settings.cacheUsage failed.');
      },
    });
    const container = render(Cache);
    expect(container.textContent).toContain('Measuring…');
    await settle();
    expect(container.textContent).toContain('No local copies');
    expect(container.textContent).not.toContain('Measuring');
  });

  it('says it is looking for git, asks again until Lo has looked, then shows the copies', async () => {
    vi.useFakeTimers();
    const bridge = installBridge({
      'settings.cacheUsage': usage({ status: 'checking' }, { status: 'checking' }, ready(2048)),
    });
    const container = render(Cache);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain('Looking for Git…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.textContent).toContain('Looking for Git…');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(container.textContent).toContain('2 KB');
    expect(container.textContent).not.toContain('Looking for Git');
    // It stops asking once it has an answer.
    const asked = bridge.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(bridge.calls).toHaveLength(asked);
  });

  it('gives up waiting for the cache to open, and says so, with a way to look again', async () => {
    vi.useFakeTimers();
    const bridge = installBridge({ 'settings.cacheUsage': usage({ status: 'checking' }) });
    const container = render(Cache);
    // A second at a time, each asked about and drawn before the next.
    for (let second = 0; second < 32; second++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
    }
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Can’t use the cache folder',
    );
    // Asked to look again, it asks main again.
    const asked = bridge.calls.length;
    click(
      [...container.querySelectorAll('button')].find((each) => each.textContent === 'Check again'),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(bridge.calls.length).toBeGreaterThan(asked);
  });

  it('says there are no local copies without git, though the answers saved from GitHub can still be cleared', async () => {
    const bridge = installBridge({
      'settings.cacheUsage': usage({ status: 'unavailable' }),
      'settings.clearCache': () => ({ kept: 0 }),
    });
    const container = render(Cache);
    await settle();
    expect(container.textContent).toContain('No local copies');
    expect(container.querySelector('[role="meter"]')).toBeNull();
    const clear = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.startsWith('Clear cache'),
    );
    click(clear);
    await settle();
    expect(bridge.calls.map(([channel]) => channel)).toContain('settings.clearCache');
    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it('clears the cache, says how it went, and measures again', async () => {
    const bridge = installBridge({
      'settings.cacheUsage': usage(ready(5 * 1024 ** 3), ready(0)),
      'settings.clearCache': () => ({ kept: 0 }),
    });
    const container = render(Cache);
    await settle();
    const clear = [...container.querySelectorAll('button')].find((button) =>
      button.textContent.startsWith('Clear cache'),
    );
    click(clear);
    await settle();
    expect(bridge.calls.map(([channel]) => channel)).toEqual([
      'settings.cacheUsage',
      'settings.clearCache',
      'settings.cacheUsage',
    ]);
    expect(container.textContent).toContain('0 B of 10 GB');
  });

  it('says how many copies stayed because they were in use', async () => {
    installBridge({
      'settings.cacheUsage': usage(ready(1024 ** 3)),
      'settings.clearCache': () => ({ kept: 2 }),
    });
    const container = render(Cache);
    await settle();
    click(
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent.startsWith('Clear cache'),
      ),
    );
    await settle();
    expect(container.querySelector('[role="status"]')?.textContent).toBe(
      '2 local copies are in use and weren’t cleared.',
    );
  });

  it('says on the row when the cache couldn’t be cleared, with a way to try again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    installBridge({
      'settings.cacheUsage': usage(ready(1024 ** 3)),
      'settings.clearCache': () => {
        throw new IpcError('unavailable', 'Lo has no local copies to clear.');
      },
    });
    const container = render(Cache);
    await settle();
    click(
      [...container.querySelectorAll('button')].find((b) =>
        b.textContent.startsWith('Clear cache'),
      ),
    );
    await settle();
    expect(container.textContent).toContain('Couldn’t clear the cache');
    expect(notice()).toBeUndefined();
    expect([...container.querySelectorAll('button')].map((b) => b.textContent)).toContain(
      'Try again',
    );
  });

  describe('the size limit', () => {
    it('changes the setting when what is typed is left, or ⏎ is pressed', async () => {
      const { input, calls } = await sizeField();
      type(input, '20');
      expect(sets(calls)).toEqual([]);
      enter(input);
      await settle();
      expect(sets(calls)).toEqual([['settings.set', { key: 'cache.cap', value: 20 }]]);
      type(input, '30');
      leave(input);
      await settle();
      expect(sets(calls).at(-1)).toEqual(['settings.set', { key: 'cache.cap', value: 30 }]);
    });

    it('writes nothing for a number that is what it was', async () => {
      const { input, calls } = await sizeField();
      type(input, ' 10 ');
      enter(input);
      await settle();
      expect(sets(calls)).toEqual([]);
      expect(input.value).toBe('10');
    });

    it('says what is wanted, under the field, for what is not a whole number of GB from 1 to 10,000', async () => {
      const { container, input, calls } = await sizeField();
      for (const text of ['', '2.5', '0', '10001', 'big', '-3']) {
        type(input, text);
        enter(input);
        await settle();
        expect(input.getAttribute('aria-invalid')).toBe('true');
        // Said on the row, under its line.
        expect(container.querySelector('[role="alert"]')?.textContent).toBe(
          'Use a whole number from 1 to 10,000.',
        );
      }
      expect(sets(calls)).toEqual([]);
      // What's typed stays, to be corrected.
      expect(input.value).toBe('-3');
      type(input, '5');
      enter(input);
      await settle();
      expect(input.getAttribute('aria-invalid')).toBeNull();
      expect(container.querySelector('[role="alert"]')).toBeNull();
      expect(sets(calls)).toEqual([['settings.set', { key: 'cache.cap', value: 5 }]]);
    });

    it('shows the limit again when the file changes it, once what was typed is dealt with', async () => {
      const { input } = await sizeField();
      act(() => showSettings(settings({ 'cache.cap': 40 })));
      expect(input.value).toBe('40');
    });
  });
});

describe('Keys', () => {
  let registry: Registry;
  let release: (() => void) | undefined;
  afterEach(() => release?.());
  const run = vi.fn<(id: string) => void>();

  beforeEach(() => {
    run.mockClear();
    registry = createRegistry(
      handlers(keysFeature, {
        help: { run: () => run('keys.help') },
        palette: { run: () => undefined },
        showKey: { run: () => undefined },
        menu: { run: () => undefined },
        escape: { run: () => undefined },
        back: { run: () => undefined },
        forward: { run: () => undefined },
        openKeymap: {
          run: () => run('keys.openKeymap'),
          enabled: () => (keymapState().canOpen ? true : 'The keymap file can’t be opened'),
        },
      }),
      'mac',
    );
    // The registry the rows' buttons run their commands through, as the window's is.
    release = holdRegistry(registry);
    applyKeymapFile({ text: '', canOpen: true });
    showSettings(settings());
  });

  it('says where the keymap file is, beside the settings file, and has buttons for it and for every key', () => {
    const container = render(Keys);
    expect(container.textContent).toContain('~/.config/lo/keymap');
    expect([...container.querySelectorAll('button')].map((button) => button.textContent)).toEqual([
      'Open',
      'Show',
    ]);
  });

  it('runs the keymap’s command and key help’s through the registry', () => {
    const container = render(Keys);
    const [open, help] = container.querySelectorAll('button');
    click(open);
    click(help);
    expect(run.mock.calls).toEqual([['keys.openKeymap'], ['keys.help']]);
    expect(registry.enabled('keys.openKeymap', NO_TARGET)).toBe(true);
  });

  it('says what is wrong with the file, and dims the button that opens one that can’t be opened', () => {
    const container = render(Keys);
    act(() => {
      applyKeymapFile({
        text: '',
        problem: "The keymap file isn't a plain file, so Lo doesn't read or open it.",
        canOpen: false,
      });
    });
    expect(container.textContent).toContain("The keymap file isn't a plain file");
    const [open] = container.querySelectorAll('button');
    expect(open?.getAttribute('aria-disabled')).toBe('true');
    expect(container.textContent).toContain('The keymap file can’t be opened');
  });

  it('has nowhere to say where the file is until main says where the settings are', () => {
    showSettings({ file: '', values: {}, problems: [] });
    const container = render(Keys);
    expect(container.textContent).toContain('keymap');
  });
});
