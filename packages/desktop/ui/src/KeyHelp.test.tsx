// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import type { HelpArea, HelpGroup, HelpRow } from './commands/index.ts';
import { Key } from './Key.tsx';
import { ERRORS_SHOWN, KeyHelp } from './KeyHelp.tsx';
import { Palette, PaletteHint } from './Palette.tsx';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
});

/** Renders `node` into a fresh `.lo-app` element, and returns the page: dialogs portal to its body. */
function render(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return document.body;
}

/** Types `text` into the field, as React hears it: through the setter React watches. */
function type(field: HTMLInputElement, text: string): void {
  act(() => {
    Reflect.set(HTMLInputElement.prototype, 'value', text, field);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function press(target: Element, key: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
  });
}

/** One of keyboard shortcuts' rows, for the command `id`. */
const row = (
  id: string,
  label: string,
  keys: string[][],
  more: Partial<HelpRow> = {},
): HelpRow => ({
  id,
  ids: [id],
  label,
  description: undefined,
  keys,
  vim: false,
  editor: false,
  overVim: false,
  ...more,
});

const down = row('vim.down', 'Next line', [['j']], { vim: true });
const back = row('keys.back', 'Back', [['⌃o']], {
  overVim: true,
  description: 'Goes back to where you were.',
});
const forward = row('keys.forward', 'Forward', []);
const paletteRow = row('keys.palette', 'Command palette', [['⌘⇧P'], [']', 'p']]);
const find = row('tree.find', 'Go to file…', [['⌘P']]);
const install = row('open.installCommand', 'Install `lo` command', []);

const here: HelpGroup[] = [
  { group: 'Go', rows: [down, back, forward] },
  { group: 'App', rows: [paletteRow] },
];
const areas: HelpArea[] = [
  { scope: 'window', name: 'Anywhere', groups: here },
  { scope: 'tree', name: 'Files', groups: [{ group: 'Go', rows: [find] }] },
  { scope: 'welcome', name: 'Welcome', groups: [{ group: 'App', rows: [install] }] },
];
const all: HelpGroup[] = [
  { group: 'Go', rows: [down, back, forward, find] },
  { group: 'App', rows: [paletteRow, install] },
];
const lists = { here, areas, all };

/** The ids of the rows shown, in order. */
const shownRows = (page: HTMLElement) =>
  [...page.querySelectorAll('[data-command]')].map((each) => each.getAttribute('data-command'));

/** The tabs' names, and the one chosen. */
const tabsOf = (page: HTMLElement) => {
  const tabs = [...page.querySelectorAll('[role="tab"]')];
  return {
    names: tabs.map((tab) => tab.textContent),
    chosen: tabs.find((tab) => tab.getAttribute('aria-selected') === 'true')?.textContent,
  };
};

const tab = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll<HTMLElement>('[role="tab"]')].find((each) => each.textContent === name);

describe('Key', () => {
  it('draws a chord as one key and a sequence as keys side by side', () => {
    const page = render(
      <>
        <Key keys={['⌘⇧P']} />
        <Key keys={[']', 'f']} quiet />
      </>,
    );
    const keys = [...page.querySelectorAll('kbd')].map((kbd) => kbd.textContent);
    expect(keys).toEqual(['⌘⇧P', ']', 'f']);
    expect(page.textContent).not.toContain('+');
  });
});

describe('KeyHelp', () => {
  it('opens on the keys that work here, by group, Vim’s and those that replace Vim’s tagged', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    const dialog = page.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('data-lo-scope')).toBe('dialog');
    expect(dialog?.textContent).toContain('Keyboard shortcuts');
    // An area with only commands that have no key has no tab until they show.
    expect(tabsOf(page)).toEqual({ names: ['Here', 'Anywhere', 'Files'], chosen: 'Here' });
    expect([...page.querySelectorAll('[role="group"] h3')].map((h3) => h3.textContent)).toEqual([
      'Go',
      'App',
    ]);
    expect(shownRows(page)).toEqual(['vim.down', 'keys.back', 'keys.palette']);
    const line = (id: string) => page.querySelector(`[data-command="${id}"]`);
    expect(line('vim.down')?.textContent).toContain('Vim');
    expect(line('keys.back')?.textContent).toContain('Goes back to where you were.');
    expect(line('keys.back')?.textContent).toContain('Replaces Vim’s');
    expect(
      [...(line('keys.palette')?.querySelectorAll('kbd') ?? [])].map((kbd) => kbd.textContent),
    ).toEqual(['⌘⇧P', ']', 'p']);
  });

  it('shows the commands with no key too, with “Show all commands” on, code as code', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    act(() => page.querySelector<HTMLElement>('[role="switch"]')?.click());
    expect(shownRows(page)).toEqual(['vim.down', 'keys.back', 'keys.forward', 'keys.palette']);
    expect(page.querySelector('[data-command="keys.forward"]')?.textContent).toContain('No key');
    expect(tabsOf(page).names).toEqual(['Here', 'Anywhere', 'Files', 'Welcome']);
    act(() => tab(page, 'Welcome')?.click());
    const label = page.querySelector('[data-command="open.installCommand"] .code-small');
    expect(label?.textContent).toBe('lo');
    expect(page.querySelector('[data-command="open.installCommand"]')?.textContent).not.toContain(
      '`',
    );
  });

  it('shows another area by its tab, and moves through them with the arrows', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    act(() => tab(page, 'Files')?.click());
    expect(tabsOf(page).chosen).toBe('Files');
    expect(shownRows(page)).toEqual(['tree.find']);
    press(page.querySelector('[role="tablist"]')!, 'ArrowUp');
    expect(tabsOf(page).chosen).toBe('Anywhere');
    expect(document.activeElement).toBe(tab(page, 'Anywhere'));
    press(page.querySelector('[role="tablist"]')!, 'ArrowDown');
    press(page.querySelector('[role="tablist"]')!, 'ArrowDown');
    expect(tabsOf(page).chosen).toBe('Here');
  });

  it('starts in its search, which looks through every area', async () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    const search = page.querySelector<HTMLInputElement>('input[type="search"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    expect(search?.getAttribute('aria-label')).toBe('Search keys and commands');
    type(search!, 'file');
    expect(shownRows(page)).toEqual(['tree.find']);
    expect(tabsOf(page).chosen).toBeUndefined();
    type(search!, 'nothing like it');
    expect(page.textContent).toContain('No keys or commands match “nothing like it”');
  });

  it('names each group without making it a landmark', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    const named = [...page.querySelectorAll('[role="group"]')].map((group) => {
      const label = group.getAttribute('aria-labelledby');
      return page.ownerDocument.getElementById(label ?? '')?.textContent;
    });
    expect(named).toEqual(['Go', 'App']);
    expect(page.querySelector('section, [role="region"]')).toBeNull();
  });

  it('says aloud, in a live region, when nothing matches', async () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    const status = page.querySelector('[role="status"]');
    // The region is there before it has anything to say, so the change is announced.
    expect(status?.textContent).toBe('');
    const search = page.querySelector<HTMLInputElement>('input[type="search"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    type(search!, 'nothing like it');
    expect(page.querySelector('[role="status"]')).toBe(status);
    expect(status?.textContent).toBe('No keys or commands match “nothing like it”');
    type(search!, '');
    expect(status?.textContent).toBe('');
  });

  it('marks the command it was asked to show, in its area, even with no key', () => {
    const page = render(
      <KeyHelp open onOpenChange={() => {}} {...lists} show="tree.find" showIn="tree" />,
    );
    expect(tabsOf(page).chosen).toBe('Files');
    expect(page.querySelector('[aria-current="true"]')?.getAttribute('data-command')).toBe(
      'tree.find',
    );
    act(() => root?.unmount());
    const keyless = render(
      <KeyHelp open onOpenChange={() => {}} {...lists} show="keys.forward" showIn="here" />,
    );
    expect(keyless.querySelector('[aria-current="true"]')?.getAttribute('data-command')).toBe(
      'keys.forward',
    );
  });

  it('lists the keymap file’s lines it can’t use as an error, by line, code as code', () => {
    const page = render(
      <KeyHelp
        open
        onOpenChange={() => {}}
        {...lists}
        errors={[
          { line: 2, message: 'No command `diff.nope`' },
          { line: 5, message: 'Lines start with `bind`, `unbind`, `vim` or `#`' },
        ]}
      />,
    );
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Can’t use 2 lines of the keymap file');
    expect(alert?.textContent).toContain('Line 2 · No command diff.nope');
    expect(alert?.textContent).toContain('Line 5 · Lines start with bind');
    expect(alert?.querySelector('.code-small')?.textContent).toBe('diff.nope');
  });

  it('lists only the first of the keymap file’s lines, and counts the rest', () => {
    const errors = Array.from({ length: 5000 }, (_, index) => ({
      line: index + 1,
      message: 'No good',
    }));
    const page = render(<KeyHelp open onOpenChange={() => {}} {...lists} errors={errors} />);
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Can’t use 5,000 lines of the keymap file');
    expect(alert?.textContent).toContain('Line 1 · No good');
    expect(alert?.textContent).toContain(`Line ${ERRORS_SHOWN} · No good`);
    expect(alert?.textContent).not.toContain(`Line ${ERRORS_SHOWN + 1} ·`);
    expect(alert?.textContent).toContain(
      `${(5000 - ERRORS_SHOWN).toLocaleString('en')} more lines`,
    );
  });

  it('says what is wrong with the keymap file as a whole', () => {
    const none = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    expect(none.querySelector('[role="alert"]')).toBeNull();
    act(() => root?.unmount());
    const page = render(
      <KeyHelp
        open
        onOpenChange={() => {}}
        {...lists}
        problem={{
          title: 'Can’t read the keymap file',
          reason: 'It’s 1.1 MB, over the 1 MB limit.',
          details: 'EIO',
        }}
      />,
    );
    // An error, as every failure is: what failed and why, with what the system said behind Details.
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      'Can’t read the keymap file It’s 1.1 MB, over the 1 MB limit.',
    );
    expect([...page.querySelectorAll('button')].map((each) => each.textContent)).toContain(
      'Details',
    );
  });

  it('offers to open the keymap file when it can', () => {
    const none = render(<KeyHelp open onOpenChange={() => {}} {...lists} />);
    expect(none.textContent).not.toContain('Open keymap file');
    act(() => root?.unmount());
    const onOpenKeymap = vi.fn<() => void>();
    const page = render(
      <KeyHelp open onOpenChange={() => {}} {...lists} onOpenKeymap={onOpenKeymap} />,
    );
    const button = [...page.querySelectorAll('button')].find(
      (each) => each.textContent === 'Open keymap file',
    );
    act(() => button?.click());
    expect(onOpenKeymap).toHaveBeenCalledOnce();
  });

  it('closes on Esc, and on Close, which shows Esc', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const page = render(
      <KeyHelp open onOpenChange={onOpenChange} {...lists} closeKeys={['Esc']} />,
    );
    press(page.querySelector('input[type="search"]')!, 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    const close = [...page.querySelectorAll('button')].find((each) =>
      each.textContent?.startsWith('Close'),
    );
    expect(close?.querySelector('kbd')?.textContent).toBe('Esc');
    act(() => close?.click());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

interface Item {
  id: string;
  label: string;
}
const items: Item[] = [
  { id: 'a', label: 'Every key' },
  { id: 'b', label: 'Back' },
];

function palette(
  onRun = vi.fn<(item: Item) => void>(),
  onHighlight = vi.fn<(item: Item | undefined) => void>(),
  shown: readonly Item[] = items,
) {
  const page = render(
    <Palette<Item>
      open
      onOpenChange={() => {}}
      label="Command palette"
      placeholder="Search commands"
      query=""
      onQueryChange={() => {}}
      groups={shown.length > 0 ? [{ label: 'Find', items: shown }] : []}
      itemId={(item) => item.id}
      renderItem={(item) => item.label}
      onRun={onRun}
      onHighlight={onHighlight}
      empty="No commands match"
      foot={<PaletteHint keys={['⏎']}>Run</PaletteHint>}
    />,
  );
  return { page, onRun, onHighlight };
}

describe('Palette', () => {
  it('lists its items under their group, the first highlighted, in the palette scope', () => {
    const { page, onHighlight } = palette();
    expect(page.querySelector('[role="dialog"]')?.getAttribute('data-lo-scope')).toBe('palette');
    expect(page.textContent).toContain('Find');
    const options = [...page.querySelectorAll('[role="option"]')];
    expect(options.map((option) => option.textContent)).toEqual(['Every key', 'Back']);
    expect(options[0]?.hasAttribute('data-highlighted')).toBe(true);
    expect(onHighlight).toHaveBeenLastCalledWith(items[0]);
  });

  it('runs the highlighted item on ⏎, after the arrows move it', async () => {
    const { page, onRun, onHighlight } = palette();
    const input = page.querySelector('input')!;
    await vi.waitFor(() => expect(document.activeElement).toBe(input));
    press(input, 'ArrowDown');
    expect(onHighlight).toHaveBeenLastCalledWith(items[1]);
    press(input, 'Enter');
    expect(onRun).toHaveBeenCalledWith(items[1]);
  });

  it('names its list, so a screen reader can say what it is', () => {
    const { page } = palette();
    const list = page.querySelector('[role="listbox"]');
    expect(list?.getAttribute('aria-label')).toBe('Command palette results');
  });

  it('says so when nothing matches', () => {
    const { page } = palette(undefined, undefined, []);
    expect(page.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(page.textContent).toContain('No commands match');
  });

  it('says in its foot what a key does, then the key, and shows no key in its field', () => {
    const { page } = palette();
    const input = page.querySelector('input');
    expect(input?.parentElement?.querySelector('kbd')).toBeNull();
    const hint = [...page.querySelectorAll('span')].find((each) => each.textContent === 'Run⏎');
    expect(hint?.firstChild?.textContent).toBe('Run');
  });
});

describe('the styles', () => {
  it("only use utilities that Lo's stylesheet has", async () => {
    render(
      <>
        <KeyHelp
          open
          onOpenChange={() => {}}
          {...lists}
          show="keys.back"
          errors={[{ line: 1, message: 'x' }]}
          problem={{ title: 'x', reason: 'y', details: 'z' }}
          onOpenKeymap={() => {}}
        />
      </>,
    );
    const help = document.body.innerHTML;
    act(() => root?.unmount());
    root = undefined;
    const { page } = palette();
    const markup = help + page.innerHTML;
    const classes = [
      ...new Set(
        [...markup.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) => (value ?? '').split(/\s+/)),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    expect(classes.length).toBeGreaterThan(60);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
