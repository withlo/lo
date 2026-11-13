// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { focusMiddle } from '../../../window/commands/registry.ts';
import { Slots, type View } from '../../../window/slots.tsx';
import type { SettingsState } from '../contract.ts';
import feature from './index.ts';
import { moveSection } from './nav.ts';
import { SettingsTab } from './Page.tsx';
import { defineSection } from './shared.ts';
import { showSettings } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
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

/** The handler the feature gives the command called `name`. */
function handlerOf(name: string) {
  const handler = feature.commands.find((command) => command.name === name)?.handler;
  if (!handler) throw new Error(`settings.${name} has no handler.`);
  return handler;
}

/** Moves a section, as the keys do. */
function move(step: 1 | -1): void {
  act(() => {
    moveSection(step);
  });
}

/** Makes `element` say it's `top` px from the top of the window. */
function place(element: Element, top: number): void {
  Reflect.set(element, 'getBoundingClientRect', () => ({ top }));
}

/** The item `at` in a list that has one. */
function nth<T>(list: readonly T[], at: number): T {
  const item = list[at];
  if (item === undefined) throw new Error(`No item ${at}.`);
  return item;
}

const views: View[] = [
  defineSection({
    id: 'test.keys',
    title: 'Keys',
    order: 60,
    render: () => <p>Keymap</p>,
  }),
  defineSection({
    id: 'test.appearance',
    title: 'Appearance',
    description: 'Lo Glow, in dark or light.',
    order: 40,
    render: () => <input aria-label="Name" />,
  }),
  defineSection({ id: 'test.cache', title: 'Cache', order: 50, render: () => <p>Copies</p> }),
];

/** The page in the middle of a window, with the sections above. */
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
  const nav = () => [...container.querySelectorAll('nav button')];
  return {
    container,
    nav,
    current: () => nav().find((item) => item.getAttribute('aria-current') === 'true')?.textContent,
    sections: () => [...container.querySelectorAll('section')],
    alert: () => container.querySelector('[role="alert"]'),
  };
}

describe('the Settings tab', () => {
  it('draws each section features put in the slot, in order, with the list of them beside it', () => {
    const page = render();
    expect(page.nav().map((item) => item.textContent)).toEqual(['Appearance', 'Cache', 'Keys']);
    expect(page.sections().map((section) => section.querySelector('h2')?.textContent)).toEqual([
      'Appearance',
      'Cache',
      'Keys',
    ]);
    const [appearance] = page.sections();
    expect(appearance?.textContent).toContain('Lo Glow, in dark or light.');
    expect(appearance?.querySelector('input')).not.toBeNull();
    expect(page.current()).toBe('Appearance');
  });

  it('says where the settings file lives, once main has said', () => {
    const page = render();
    expect(page.container.querySelector('nav')?.textContent).toContain(
      'Settings live in ~/.config/lo/',
    );
  });

  it('is its own scope, whose fields keep the browser’s Tab', () => {
    const scope = render().container.querySelector('[data-lo-scope]');
    expect(scope?.getAttribute('data-lo-scope')).toBe('settings');
    expect(scope?.getAttribute('data-lo-tab')).toBe('browser');
  });

  it('shows a section that fails as a note, and the others stay', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const page = render([
      defineSection({ id: 'test.broken', title: 'Broken', order: 45, render: Throws }),
    ]);
    expect(page.sections().map((section) => section.querySelector('h2')?.textContent)).toEqual([
      'Appearance',
      'Broken',
      'Cache',
      'Keys',
    ]);
    expect(page.container.querySelector('[data-lo-failed-view="test.broken"]')).not.toBeNull();
    expect(page.container.textContent).toContain('Copies');
  });
});

describe('the list of sections', () => {
  it('scrolls to the section chosen, and marks it', () => {
    const page = render();
    const scrolled: string[] = [];
    for (const section of page.sections()) {
      Reflect.set(section, 'scrollIntoView', () => scrolled.push(section.id));
    }
    click(page.nav()[2]);
    expect(page.current()).toBe('Keys');
    expect(scrolled).toEqual(['test.keys']);
  });

  it('moves a section at a time with the keys, and stops at the ends', () => {
    const page = render();
    move(1);
    expect(page.current()).toBe('Cache');
    move(1);
    expect(page.current()).toBe('Keys');
    move(1);
    expect(page.current()).toBe('Keys');
    move(-1);
    move(-1);
    move(-1);
    expect(page.current()).toBe('Appearance');
  });

  it('moves by the feature’s next and previous section commands, which j and k run', () => {
    const next = handlerOf('nextSection');
    const previous = handlerOf('previousSection');
    const page = render();
    expect(next.enabled?.({ kind: 'none' })).toBe(true);
    act(() => {
      void next.run({ kind: 'none' });
    });
    expect(page.current()).toBe('Cache');
    act(() => {
      void previous.run({ kind: 'none' });
    });
    expect(page.current()).toBe('Appearance');
  });

  it('follows the scrolling: the last section whose top has reached the top of the body', () => {
    const page = render();
    const body = page.container.querySelector<HTMLElement>('nav + div');
    if (!body) throw new Error('No body.');
    place(body, 100);
    const appearance = nth(page.sections(), 0);
    const cache = nth(page.sections(), 1);
    const keys = nth(page.sections(), 2);
    // Scrolled past Appearance and into Cache.
    place(appearance, 40);
    place(cache, 100);
    place(keys, 400);
    scroll(body);
    expect(page.current()).toBe('Cache');
    // Back to the top.
    place(appearance, 100);
    place(cache, 300);
    scroll(body);
    expect(page.current()).toBe('Appearance');
    // At the end of the scroll, the last section is the one on screen, though its top never gets up.
    Object.defineProperties(body, {
      scrollTop: { value: 500, configurable: true },
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 800, configurable: true },
    });
    scroll(body);
    expect(page.current()).toBe('Keys');
  });

  it('keeps a section gone to by key on screen at the end of the scroll, until scrolled back', () => {
    const page = render();
    const body = page.container.querySelector<HTMLElement>('nav + div');
    if (!body) throw new Error('No body.');
    place(body, 100);
    // Going to Cache scrolls the body as far as it goes, short of Cache's top.
    move(1);
    expect(page.current()).toBe('Cache');
    Object.defineProperties(body, {
      scrollTop: { value: 500, configurable: true },
      clientHeight: { value: 300, configurable: true },
      scrollHeight: { value: 800, configurable: true },
    });
    place(nth(page.sections(), 0), -400);
    place(nth(page.sections(), 1), 200);
    place(nth(page.sections(), 2), 300);
    scroll(body);
    expect(page.current()).toBe('Cache');
    move(1);
    expect(page.current()).toBe('Keys');
    move(-1);
    expect(page.current()).toBe('Cache');
    // Scrolled back up, the scroll says again.
    Object.defineProperty(body, 'scrollTop', { value: 0, configurable: true });
    place(nth(page.sections(), 0), 100);
    scroll(body);
    expect(page.current()).toBe('Appearance');
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
    expect(render().alert()).toBeNull();
  });

  it('says what, and in which file, above the sections', () => {
    showSettings(
      settings([
        { key: 'theme', message: 'theme is "purple", but it must be dark, light or system.' },
        { key: 'cache.cap', message: 'cache.cap is 2.5, but it must be a whole number of GB.' },
      ]),
    );
    const page = render();
    const alert = page.alert();
    expect(alert?.textContent).toContain('Lo found 2 problems in the settings file');
    expect(alert?.textContent).toContain('~/.config/lo/settings.json');
    expect([...(alert?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      'theme is "purple", but it must be dark, light or system.',
      'cache.cap is 2.5, but it must be a whole number of GB.',
    ]);
    // Above the first section.
    const [first] = page.sections();
    expect(first && alert?.compareDocumentPosition(first)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('says it in the singular for one, and follows the file as it’s fixed', () => {
    showSettings(settings([{ message: "The settings file isn't valid JSON (x)." }]));
    const page = render();
    expect(page.alert()?.textContent).toContain('Lo found a problem in the settings file');
    act(() => showSettings(settings()));
    expect(page.alert()).toBeNull();
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
