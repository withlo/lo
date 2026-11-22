// @vitest-environment jsdom
// Settings' page: the rows features put in the slot, in their groups, with the list of groups
// beside them, the search that filters them, what's wrong in the settings file, and focus.

import { holdRegistry, listen } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry, focusMiddle, registry } from '../../../window/commands/registry.ts';
import { Slots, type View } from '../../../window/slots.tsx';
import type { SettingsState } from '../contract.ts';
import feature from './index.ts';
import { moveSection, search } from './nav.ts';
import { matches, SettingsTab } from './Page.tsx';
import { defineRow } from './shared.ts';
import { showSettings } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // The window's controls run their commands through it, as Settings' buttons do.
  holdRegistry(createRegistry(feature.commands, 'mac'));
});

const settings = (problems: SettingsState['problems'] = []) =>
  ({ file: '~/.config/lo/settings.json', values: {}, problems }) satisfies SettingsState;

afterEach(() => {
  showSettings(settings());
});

function Throws(): ReactNode {
  throw new Error('broken');
}

/** A click on `element`, as a person's. */
function click(element: Element | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** The body of the page, scrolled. */
function scroll(element: Element): void {
  act(() => {
    element.dispatchEvent(new Event('scroll', { bubbles: true }));
  });
}

/** `⌘⌫` going down, as the window hears it. */
function backspace(): KeyboardEvent {
  return new KeyboardEvent('keydown', {
    key: 'Backspace',
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
}

/** Types `text` into the search field, as a person does. */
function type(input: HTMLInputElement, text: string): void {
  act(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, input);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** The handler the feature gives the command called `name`. */
function handlerOf(name: string) {
  const handler = feature.commands.find((command) => command.name === name)?.handler;
  if (!handler) throw new Error(`settings.${name} has no handler.`);
  return handler;
}

/** Moves a group, as the keys do. */
function move(step: 1 | -1): void {
  act(() => {
    moveSection(step);
  });
}

/** Makes `element` say it's `top` px from the top of the window. */
function place(element: Element, top: number): void {
  Reflect.set(element, 'getBoundingClientRect', () => ({ top }));
}

const views: View[] = [
  defineRow({
    id: 'test.keymap',
    group: 'keyboard',
    order: 10,
    label: 'Keymap file',
    description: 'Holds changed keys.',
    render: () => <p>Keymap</p>,
  }),
  defineRow({
    id: 'test.theme',
    group: 'appearance',
    order: 10,
    label: 'Theme',
    description: 'Dark or light.',
    words: () => ['Lo Glow'],
    render: () => <input aria-label="Name" />,
  }),
  defineRow({
    id: 'test.cache',
    group: 'storage',
    order: 10,
    label: 'Cache',
    description: 'Local copies.',
    render: () => <p>Copies</p>,
  }),
];

/** The page in the middle of a window, with the rows above. */
function render(extra: readonly View[] = []) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Slots views={[...views, ...extra]}>
        <main data-lo-middle tabIndex={-1} className="flex">
          <SettingsTab />
        </main>
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  // The list's groups, then the button at its foot.
  const groups = () => [...container.querySelectorAll('nav button')].slice(0, -1);
  const field = container.querySelector<HTMLInputElement>('input[type="search"]');
  if (!field) throw new Error('No search field.');
  return {
    container,
    field,
    groups,
    current: () =>
      groups().find((item) => item.getAttribute('aria-current') === 'true')?.textContent,
    sections: () => [...container.querySelectorAll('section')],
    titles: () => [...container.querySelectorAll('section h2')].map((each) => each.textContent),
    rows: () =>
      [...container.querySelectorAll('[data-settings-row]')].map((each) =>
        each.getAttribute('data-settings-row'),
      ),
  };
}

describe('the Settings tab', () => {
  it('draws each row in its group, the groups in their order, with the list of them beside it', () => {
    const page = render();
    expect(page.groups().map((item) => item.textContent)).toEqual([
      'Appearance',
      'Keyboard',
      'Storage',
    ]);
    expect(page.titles()).toEqual(['Appearance', 'Keyboard', 'Storage']);
    expect(page.sections()[0]?.querySelector('input')).not.toBeNull();
    expect(page.current()).toBe('Appearance');
  });

  it('has the button that opens the settings file at the foot of the list', () => {
    const page = render();
    expect(page.container.querySelector('nav')?.textContent).toContain('Open settings.json');
  });

  it('is its own scope, whose fields keep the browser’s Tab', () => {
    const scope = render().container.querySelector('[data-lo-scope]');
    expect(scope?.getAttribute('data-lo-scope')).toBe('settings');
    expect(scope?.getAttribute('data-lo-tab')).toBe('browser');
  });

  it('shows a row that fails as a note, and the others stay', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const page = render([
      defineRow({
        id: 'test.broken',
        group: 'storage',
        order: 20,
        label: 'Broken',
        description: 'Throws.',
        render: Throws,
      }),
    ]);
    expect(page.container.querySelector('[data-lo-failed-view="test.broken"]')).not.toBeNull();
    expect(page.container.textContent).toContain('Copies');
  });
});

describe('the search', () => {
  it('finds a row by its label, its line or its own words, and drops empty groups', () => {
    const page = render();
    type(page.field, 'cache');
    expect(page.rows()).toEqual(['test.cache']);
    expect(page.titles()).toEqual(['Storage']);
    expect(page.groups().map((item) => item.textContent)).toEqual(['Storage']);
    type(page.field, 'changed keys');
    expect(page.rows()).toEqual(['test.keymap']);
    type(page.field, 'glow');
    expect(page.rows()).toEqual(['test.theme']);
    type(page.field, '');
    expect(page.rows()).toEqual(['test.theme', 'test.keymap', 'test.cache']);
  });

  it('says when nothing matches, and clears with its button, which is the command', () => {
    const page = render();
    type(page.field, 'purple');
    expect(page.container.querySelector('h2')?.textContent).toBe('No settings match “purple”');
    const clear = [...page.container.querySelectorAll('button')].find((each) =>
      each.textContent.startsWith('Clear search'),
    );
    // Its key is the command's.
    expect(clear?.querySelector('kbd')).not.toBeNull();
    click(clear);
    expect(page.rows()).toHaveLength(3);
    expect(document.activeElement).toBe(page.field);
  });

  it('leaves ⌘⌫ in the search to the field, and clears with it only from "Clear search"', () => {
    const stop = listen(window, registry());
    // Stopping lets go of the registry the controls read, which the other tests hold.
    onTestFinished(() => {
      stop();
      holdRegistry(registry());
    });
    const page = render();
    type(page.field, 'purple');
    // Typing, the key is the field's, which deletes what it deletes: the command doesn't run.
    act(() => page.field.focus());
    const typed = backspace();
    act(() => {
      page.field.dispatchEvent(typed);
    });
    expect(typed.defaultPrevented).toBe(false);
    expect(page.field.value).toBe('purple');
    // On the button, it's the command's.
    const clear = [...page.container.querySelectorAll<HTMLElement>('button')].find((each) =>
      each.textContent.startsWith('Clear search'),
    );
    act(() => clear?.focus());
    act(() => {
      clear?.dispatchEvent(backspace());
    });
    expect(page.field.value).toBe('');
    expect(page.rows()).toHaveLength(3);
  });

  it('is gone to by its command, with what it holds selected', () => {
    const page = render();
    type(page.field, 'cache');
    act(() => {
      search();
    });
    expect(document.activeElement).toBe(page.field);
    expect([page.field.selectionStart, page.field.selectionEnd]).toEqual([0, 5]);
  });

  it('matches every word typed, in any order and case, and a setting by its key', () => {
    const row = { group: 'storage', label: 'Cache', description: 'Local copies.' } as const;
    expect(matches(row, '  ')).toBe(true);
    expect(matches(row, 'COPIES cache')).toBe(true);
    expect(matches(row, 'cache keys')).toBe(false);
    expect(matches({ ...row, settingKey: 'cache.cap' }, 'cache.cap')).toBe(true);
  });
});

describe('the list of groups', () => {
  it('goes to the group chosen, and marks it', () => {
    const page = render();
    click(page.groups()[2]);
    expect(page.current()).toBe('Storage');
  });

  it('moves a group at a time with the keys, and stops at the ends', () => {
    const page = render();
    move(1);
    expect(page.current()).toBe('Keyboard');
    move(1);
    expect(page.current()).toBe('Storage');
    move(1);
    expect(page.current()).toBe('Storage');
    move(-1);
    move(-1);
    move(-1);
    expect(page.current()).toBe('Appearance');
  });

  it('moves by the feature’s next and previous group commands, which j and k run', () => {
    const next = handlerOf('nextSection');
    const previous = handlerOf('previousSection');
    const page = render();
    expect(next.enabled?.({ kind: 'none' })).toBe(true);
    act(() => {
      void next.run({ kind: 'none' });
    });
    expect(page.current()).toBe('Keyboard');
    act(() => {
      void previous.run({ kind: 'none' });
    });
    expect(page.current()).toBe('Appearance');
  });

  it('follows the scrolling: the last group whose top has reached the top of the body', () => {
    const page = render();
    const body = page.container.querySelector<HTMLElement>('.overflow-auto');
    if (!body) throw new Error('No body.');
    place(body, 100);
    const [appearance, keyboard, storage] = page.sections();
    if (!appearance || !keyboard || !storage) throw new Error('No groups.');
    place(appearance, 40);
    place(keyboard, 100);
    place(storage, 400);
    scroll(body);
    expect(page.current()).toBe('Keyboard');
    place(appearance, 100);
    place(keyboard, 300);
    scroll(body);
    expect(page.current()).toBe('Appearance');
    // At the end of the scroll, the last group is the one on screen, though its top never gets up.
    Object.defineProperties(body, {
      scrollTop: { value: 500, configurable: true },
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 800, configurable: true },
    });
    scroll(body);
    expect(page.current()).toBe('Storage');
  });

  it('has no keys to move with once the page is gone', () => {
    const container = document.createElement('div');
    const root = createRoot(container);
    act(() =>
      root.render(
        <Slots views={views}>
          <SettingsTab />
        </Slots>,
      ),
    );
    act(() => root.unmount());
    expect(() => moveSection(1)).not.toThrow();
  });
});

describe('what is wrong in the settings file', () => {
  it('shows nothing when nothing is', () => {
    expect(render().container.textContent).not.toContain('Can’t');
  });

  it('says what, above the groups, with the button that opens the file', () => {
    showSettings(
      settings([
        { key: 'theme', message: 'theme is "purple", but it must be dark, light or system.' },
        { key: 'cache.cap', message: 'cache.cap is 2.5, but it must be a whole number of GB.' },
      ]),
    );
    const page = render();
    expect(page.container.textContent).toContain('Can’t use 2 settings');
    const alert = page.container.querySelector('[role="alert"]');
    expect(
      [...(alert?.querySelectorAll('[data-problem]') ?? [])].map((each) => each.textContent),
    ).toEqual([
      'theme is "purple", but it must be dark, light or system.',
      'cache.cap is 2.5, but it must be a whole number of GB.',
    ]);
    const [first] = page.sections();
    expect(first && alert?.compareDocumentPosition(first)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says the file can’t be read when it can’t, and follows the file as it’s fixed', () => {
    showSettings(settings([{ message: "The settings file isn't valid JSON (x)." }]));
    const page = render();
    expect(page.container.textContent).toContain('Can’t read settings.json');
    act(() => showSettings(settings()));
    expect(page.container.textContent).not.toContain('Can’t read settings.json');
  });
});

describe('focus', () => {
  it('goes to the page when it opens with focus nowhere in particular, or on the middle', () => {
    expect(render().container.contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.getAttribute('data-lo-scope')).toBe('settings');
  });

  it('stays in a field it was in, rather than taking it away', () => {
    const field = document.createElement('input');
    document.body.append(field);
    onTestFinished(() => field.remove());
    field.focus();
    render();
    expect(document.activeElement).toBe(field);
  });

  it('comes back to the page when the middle is asked for, as Esc does', () => {
    const page = render();
    const outside = document.createElement('button');
    document.body.append(outside);
    onTestFinished(() => outside.remove());
    outside.focus();
    act(() => {
      focusMiddle();
    });
    expect(page.container.contains(document.activeElement)).toBe(true);
  });
});
