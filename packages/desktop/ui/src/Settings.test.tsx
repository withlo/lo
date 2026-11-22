// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { buildCss, declarations, hasRule } from '../scripts/stylesheet.ts';
import { Button } from './Button.tsx';
import { Input } from './Input.tsx';
import { Meter } from './Meter.tsx';
import {
  Setting,
  SettingsEmpty,
  SettingsGroup,
  SettingsList,
  SettingsListItem,
  SettingsPage,
} from './Settings.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** Renders `element` into a fresh root, and returns its container. */
function render(element: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(element));
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

/** A click on `element`, as a person's. */
function click(element: Element | null | undefined): void {
  act(() => {
    element?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** The markup of a button. */
const buttonMarkup = (props: Parameters<typeof Button>[0]) =>
  renderToStaticMarkup(<Button {...props} />);

/** Every class a markup uses that isn't the design system's own (`lo-…`). */
function classesIn(html: string): string[] {
  return [
    ...new Set(
      [...html.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
    ),
  ].filter((name) => name !== '' && !name.startsWith('lo-'));
}

const page = (
  <SettingsPage
    items={[
      { id: 'a.one', label: 'One' },
      { id: 'a.two', label: 'Two' },
    ]}
    current="a.two"
    search={<Input type="search" aria-label="Search settings" />}
    footer={<Button size="sm">Open settings.json</Button>}
  >
    <SettingsGroup id="a.one" title="One">
      <Setting label="Name" description="What it is called." settingKey="a.name" onReset={() => {}}>
        <Button size="sm">Change</Button>
      </Setting>
    </SettingsGroup>
    <SettingsGroup id="a.two" title="Two">
      <SettingsList
        label="Accounts"
        description="Each one."
        actions={<Button size="sm">Add</Button>}
      >
        <div role="list">
          <SettingsListItem label="rozed-bot" description="github.com">
            <Button size="sm">Sign out</Button>
          </SettingsListItem>
        </div>
      </SettingsList>
      <SettingsList label="Empty">
        <SettingsEmpty heading="Nothing here" line="Add one above." />
      </SettingsList>
    </SettingsGroup>
  </SettingsPage>
);

describe('Button', () => {
  it('is a button that submits nothing, unless told to', () => {
    expect(renderToStaticMarkup(<Button>Clear the cache</Button>)).toMatch(
      /^<button type="button" class="[^"]*">Clear the cache<\/button>$/,
    );
    expect(renderToStaticMarkup(<Button type="submit">Save</Button>)).toContain('type="submit"');
  });

  it('draws each variant and size, a square one for an icon', () => {
    expect(buttonMarkup({ variant: 'primary' })).toContain('bg-accent');
    expect(buttonMarkup({ variant: 'primary' })).toContain('text-on-accent');
    expect(buttonMarkup({ variant: 'ghost' })).toContain('bg-transparent');
    expect(buttonMarkup({ variant: 'danger' })).toContain('text-danger');
    expect(buttonMarkup({})).toContain('h-control-h ');
    expect(buttonMarkup({ size: 'sm' })).toContain('h-control-h-sm');
    expect(buttonMarkup({ icon: true, 'aria-label': 'Close' })).toContain('w-control-h');
    expect(buttonMarkup({ icon: true, size: 'sm', 'aria-label': 'Close' })).toContain(
      'w-control-h-sm',
    );
  });

  it('uses only utilities Lo’s stylesheet has, and its medium weight is not overridden by the type style', async () => {
    const markup = [
      { variant: 'primary' as const },
      { variant: 'ghost' as const },
      { variant: 'danger' as const },
      { size: 'sm' as const },
      { icon: true },
      {},
    ]
      .map((props) => renderToStaticMarkup(<Button {...props}>x</Button>))
      .join('');
    const classes = classesIn(markup);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    // A weight is part of the type style's own font, so there's one rule for both.
    expect(declarations(css, 'text-ui-medium')).toBe('font: var(--lo-text-ui); font-weight: 500;');
    expect(declarations(css, 'text-small-medium')).toBe(
      'font: var(--lo-text-small); font-weight: 500;',
    );
    // And no button asks for a weight and a type style that would undo it.
    for (const button of markup.split('<button').slice(1)) {
      const used = /class="([^"]*)"/.exec(button)?.[1]?.split(/\s+/) ?? [];
      expect(used.filter((name) => ['text-ui', 'text-small'].includes(name))).toEqual([]);
    }
  });
});

describe('Input', () => {
  it('is a field set into chrome that says when it holds something wrong', () => {
    const plain = renderToStaticMarkup(<Input aria-label="Size limit" />);
    expect(plain).toContain('bg-bg-well');
    expect(classesIn(plain)).toContain('border-border');
    expect(plain).not.toContain('aria-invalid');
    const wrong = renderToStaticMarkup(<Input aria-label="Size limit" invalid mono />);
    expect(wrong).toContain('aria-invalid="true"');
    expect(wrong).toContain('border-danger-border');
    expect(wrong).toContain('code-text');
  });

  it('passes its field’s own attributes and events on', () => {
    const typed = vi.fn<(value: string) => void>();
    const container = render(
      <Input
        aria-label="Size limit"
        defaultValue="10"
        inputMode="numeric"
        onChange={(event) => typed(event.target.value)}
      />,
    );
    const field = container.querySelector('input');
    expect(field?.getAttribute('inputmode')).toBe('numeric');
    expect(field?.value).toBe('10');
  });
});

describe('Meter', () => {
  it('says how full it is to a screen reader, and fills the track that much', () => {
    const container = render(<Meter value={2.5} max={10} label="Room the copies take" />);
    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute('aria-valuenow')).toBe('2.5');
    expect(meter?.getAttribute('aria-valuemax')).toBe('10');
    expect(meter?.getAttribute('aria-label')).toBe('Room the copies take');
    const fill = container.querySelector<HTMLElement>('[role="meter"] div div');
    expect(fill?.style.width).toBe('25%');
  });

  it('never fills past its end', () => {
    const container = render(<Meter value={30} max={10} label="Room" />);
    expect(container.querySelector('[role="meter"]')?.getAttribute('aria-valuenow')).toBe('10');
  });
});

describe('Settings', () => {
  it('draws the list of groups beside the groups, with the one on screen marked', () => {
    const container = render(page);
    const nav = container.querySelector('nav[aria-label="Settings"]');
    const items = [...(nav?.querySelectorAll('button') ?? [])];
    expect(items.map((item) => item.textContent)).toEqual(['One', 'Two', 'Open settings.json']);
    expect(items.map((item) => item.getAttribute('aria-current'))).toEqual([null, 'true', null]);
    const headings = [...container.querySelectorAll('h2')].map((heading) => heading.textContent);
    expect(headings).toEqual(['One', 'Two']);
    // Each group is named by its title, and the search sits over them, outside what scrolls.
    const section = container.querySelector('section#a\\.one');
    expect(section?.getAttribute('aria-labelledby')).toBe('a.one-title');
    expect(container.querySelector('input[type="search"]')?.closest('.overflow-auto')).toBeNull();
  });

  it('shows a row’s key beside its label, and Reset before its control', () => {
    const reset = vi.fn<() => void>();
    const container = render(
      <Setting label="Name" settingKey="a.name" onReset={reset} resetName="Name">
        <Button>Change</Button>
      </Setting>,
    );
    const row = container.querySelector('.setting-row');
    expect(row?.getAttribute('data-setting')).toBe('a.name');
    expect(row?.querySelector('[aria-hidden="true"]')?.textContent).toBe('a.name');
    const button = row?.querySelector('[data-reset]');
    expect(button?.getAttribute('aria-label')).toBe('Reset Name');
    click(button);
    expect(reset).toHaveBeenCalledOnce();
    // Focus goes to the control beside it, as Reset goes once the setting is its default.
    expect(document.activeElement?.textContent).toBe('Change');
  });

  it('draws a list row’s label, line and actions over the list in its box', () => {
    const container = render(page);
    const [, accounts, empty] = container.querySelectorAll('section#a\\.two > *');
    expect(accounts?.textContent).toBe('AccountsEach one.Addrozed-botgithub.comSign out');
    expect(accounts?.querySelector('[role="listitem"]')?.textContent).toBe(
      'rozed-botgithub.comSign out',
    );
    expect(empty?.textContent).toBe('EmptyNothing hereAdd one above.');
  });

  it('tells which section was chosen in the list', () => {
    const chosen = vi.fn<(id: string) => void>();
    const container = render(
      <SettingsPage
        items={[
          { id: 'a.one', label: 'One' },
          { id: 'a.two', label: 'Two' },
        ]}
        onGo={chosen}
      />,
    );
    const [, second] = container.querySelectorAll('nav button');
    click(second);
    expect(chosen).toHaveBeenCalledWith('a.two');
  });

  it('puts a setting’s controls at the end of its row, and leaves out what it hasn’t got', () => {
    const container = render(
      <>
        <Setting label="Name" description="What it is called.">
          <Button>Change</Button>
        </Setting>
        <Setting label="Bare" />
      </>,
    );
    const [full, bare] = container.querySelectorAll('.setting-row');
    expect(full?.textContent).toBe('NameWhat it is called.Change');
    expect(full?.querySelector('.col-start-2')?.textContent).toBe('Change');
    expect(bare?.textContent).toBe('Bare');
    expect(bare?.querySelector('.col-start-2')).toBeNull();
  });

  it('uses only utilities Lo’s stylesheet has, and the design’s measures', async () => {
    const markup = renderToStaticMarkup(
      <>
        {page}
        <Meter value={1} max={2} label="Room" />
        <Input aria-label="x" />
      </>,
    );
    const classes = classesIn(markup);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
    const flat = css.replaceAll(/\s+/g, ' ');
    // 220 px of list, then the groups; a row's name and what it does, then its controls.
    expect(flat).toContain('grid-template-columns: var(--lo-settings-nav-w) minmax(0, 1fr)');
    expect(flat).toContain('grid-template-columns: minmax(0, 1fr) auto');
    expect(flat).toContain('gap: var(--lo-sp-4) var(--lo-sp-24)');
    expect(declarations(css, 'max-w-settings-w')).toBe('max-width: var(--lo-settings-w);');
  });
});
