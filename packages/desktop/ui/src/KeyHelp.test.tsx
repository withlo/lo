// @vitest-environment jsdom
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import type { HelpGroup } from './commands/index.ts';
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

const groups: HelpGroup[] = [
  {
    group: 'Move',
    rows: [
      {
        id: 'vim.down',
        label: 'Line down',
        keys: [['j']],
        where: undefined,
        vim: true,
        overVim: false,
      },
    ],
  },
  {
    group: 'Code',
    rows: [
      {
        id: 'keys.back',
        label: 'Back',
        keys: [['⌃o']],
        where: 'Not in comment boxes',
        vim: false,
        overVim: true,
      },
      {
        id: 'keys.forward',
        label: 'Forward',
        keys: [],
        where: undefined,
        vim: false,
        overVim: false,
      },
    ],
  },
  {
    group: 'Find',
    rows: [
      {
        id: 'keys.palette',
        label: 'Command palette',
        keys: [['⌘⇧P'], [']', 'p']],
        where: undefined,
        vim: false,
        overVim: false,
      },
    ],
  },
];

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
  it('lists every group and key, Vim’s and those that replace Vim’s marked', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} groups={groups} />);
    const dialog = page.querySelector('[role="dialog"]');
    expect(dialog?.getAttribute('data-lo-scope')).toBe('dialog');
    expect([...page.querySelectorAll('section h3')].map((h3) => h3.textContent)).toEqual([
      'Move',
      'Code',
      'Find',
    ]);
    const row = (id: string) => page.querySelector(`[data-command="${id}"]`);
    expect(row('vim.down')?.textContent).toContain("Vim's");
    expect(row('keys.back')?.textContent).toContain('Not in comment boxes');
    expect(row('keys.back')?.textContent).toContain("Replaces Vim's");
    expect(row('keys.forward')?.textContent).toContain('No key');
    expect(
      [...(row('keys.palette')?.querySelectorAll('kbd') ?? [])].map((kbd) => kbd.textContent),
    ).toEqual(['⌘⇧P', ']', 'p']);
  });

  it('starts in its search, which narrows the list', async () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} groups={groups} />);
    const search = page.querySelector<HTMLInputElement>('input[type="search"]');
    await vi.waitFor(() => expect(document.activeElement).toBe(search));
    type(search!, 'forward');
    expect(
      [...page.querySelectorAll('[data-command]')].map((row) => row.getAttribute('data-command')),
    ).toEqual(['keys.forward']);
    type(search!, 'nothing like it');
    expect(page.textContent).toContain('No key or action matches "nothing like it".');
  });

  it('marks the command it was asked to show', () => {
    const page = render(<KeyHelp open onOpenChange={() => {}} groups={groups} show="keys.back" />);
    expect(page.querySelector('[aria-current="true"]')?.getAttribute('data-command')).toBe(
      'keys.back',
    );
  });

  it('lists the keymap file’s errors by line', () => {
    const page = render(
      <KeyHelp
        open
        onOpenChange={() => {}}
        groups={groups}
        errors={[
          { line: 2, message: "There's no command called diff.nope." },
          { line: 5, message: 'A line starts with bind, unbind, vim or #, not bnid.' },
        ]}
      />,
    );
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The keymap file has 2 lines Lo can't use:");
    expect(alert?.textContent).toContain("Line 2: There's no command called diff.nope.");
    expect(alert?.textContent).toContain('Line 5: A line starts with bind');
  });

  it('lists only the first of the keymap file’s errors, and counts the rest', () => {
    const errors = Array.from({ length: 5000 }, (_, index) => ({
      line: index + 1,
      message: 'No good.',
    }));
    const page = render(<KeyHelp open onOpenChange={() => {}} groups={groups} errors={errors} />);
    const alert = page.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("The keymap file has 5000 lines Lo can't use:");
    const items = [...(alert?.querySelectorAll('li') ?? [])].map((item) => item.textContent);
    expect(items).toHaveLength(ERRORS_SHOWN + 1);
    expect(items[0]).toBe('Line 1: No good.');
    expect(items.at(-1)).toBe(`And ${5000 - ERRORS_SHOWN} more.`);
  });

  it('says what is wrong with the keymap file as a whole', () => {
    const none = render(<KeyHelp open onOpenChange={() => {}} groups={groups} />);
    expect(none.querySelector('[role="alert"]')).toBeNull();
    act(() => root?.unmount());
    const page = render(
      <KeyHelp
        open
        onOpenChange={() => {}}
        groups={groups}
        problem="The keymap file is over 1 MiB, so Lo didn't read it."
      />,
    );
    expect(page.querySelector('[role="alert"]')?.textContent).toBe(
      "The keymap file is over 1 MiB, so Lo didn't read it.",
    );
  });

  it('offers to open the keymap file when it can', () => {
    const none = render(<KeyHelp open onOpenChange={() => {}} groups={groups} />);
    expect(none.textContent).not.toContain('Open the keymap file');
    act(() => root?.unmount());
    const onOpenKeymap = vi.fn<() => void>();
    const page = render(
      <KeyHelp open onOpenChange={() => {}} groups={groups} onOpenKeymap={onOpenKeymap} />,
    );
    const button = [...page.querySelectorAll('button')].find(
      (each) => each.textContent === 'Open the keymap file',
    );
    act(() => button?.click());
    expect(onOpenKeymap).toHaveBeenCalledOnce();
  });

  it('closes on Esc', () => {
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const page = render(<KeyHelp open onOpenChange={onOpenChange} groups={groups} />);
    press(page.querySelector('input[type="search"]')!, 'Escape');
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
      placeholder="Type an action"
      keys={['⌘⇧P']}
      query=""
      onQueryChange={() => {}}
      groups={shown.length > 0 ? [{ label: 'Find', items: shown }] : []}
      itemId={(item) => item.id}
      renderItem={(item) => item.label}
      onRun={onRun}
      onHighlight={onHighlight}
      empty="No action matches."
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

  it('says so when nothing matches', () => {
    const { page } = palette(undefined, undefined, []);
    expect(page.querySelectorAll('[role="option"]')).toHaveLength(0);
    expect(page.textContent).toContain('No action matches.');
  });
});

describe('the styles', () => {
  it("only use utilities that Lo's stylesheet has", async () => {
    render(
      <>
        <KeyHelp
          open
          onOpenChange={() => {}}
          groups={groups}
          show="keys.back"
          errors={[{ line: 1, message: 'x' }]}
          problem="x"
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
