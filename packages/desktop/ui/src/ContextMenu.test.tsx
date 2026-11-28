// @vitest-environment jsdom
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { buildCss, hasRule } from '../scripts/stylesheet.ts';
import { ContextMenu, type ContextMenuItem } from './ContextMenu.tsx';

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

/** Renders `node` into a fresh `.lo-app` element, and returns the page: menus portal to its body. */
function render(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(node));
  return document.body;
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

const sections: ContextMenuItem[][] = [
  [
    { id: 'show', label: 'Show in the diff', keys: ['⏎'], shortcut: 'Enter' },
    { id: 'viewed', label: 'Mark viewed', keys: ['e'] },
  ],
  [
    { id: 'path', label: 'Copy the path', keys: ['y', 'p'] },
    {
      id: 'stack',
      label: 'Make this a GitHub stack…',
      keys: ['g', 'S'],
      disabled: '#4821 is in a merge queue.',
    },
  ],
];

interface HarnessProps {
  onClosed?: (chosen: string | undefined) => void;
  onOpenChange?: (open: boolean) => void;
  finalFocus?: HTMLElement | SVGElement;
  opener?: Element;
}

/** A menu that opens at a point and closes as it's asked to. */
function Harness({ onClosed, onOpenChange, finalFocus, opener }: HarnessProps) {
  const [open, setOpen] = useState(true);
  return (
    <ContextMenu
      open={open}
      onOpenChange={(next) => {
        onOpenChange?.(next);
        setOpen(next);
      }}
      label="File actions"
      anchor={{ x: 40, y: 60 }}
      sections={sections}
      finalFocus={finalFocus}
      opener={opener}
      onClosed={onClosed}
    />
  );
}

const items = (page: HTMLElement) => [...page.querySelectorAll('[role="menuitem"]')];
const highlighted = (page: HTMLElement) =>
  items(page).find((item) => item.hasAttribute('data-highlighted'))?.textContent;

describe('ContextMenu', () => {
  it('lists the actions with their keys, in the menu scope, a separator between sections', () => {
    const page = render(<Harness />);
    const menu = page.querySelector('[role="menu"]');
    expect(menu?.getAttribute('aria-label')).toBe('File actions');
    expect(page.querySelector('[data-lo-scope="menu"]')).not.toBeNull();
    expect(items(page).map((item) => item.querySelector('span span')?.textContent)).toEqual([
      'Show in the diff',
      'Mark viewed',
      'Copy the path',
      'Make this a GitHub stack…',
    ]);
    expect(
      items(page).map((item) => [...item.querySelectorAll('kbd')].map((kbd) => kbd.textContent)),
    ).toEqual([['⏎'], ['e'], ['y', 'p'], ['g', 'S']]);
    expect(page.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('ticks a switch that’s on, which a screen reader hears as a checkbox, and runs it as chosen', async () => {
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    function Switches() {
      const [open, setOpen] = useState(true);
      return (
        <ContextMenu
          open={open}
          onOpenChange={setOpen}
          label="Block actions"
          anchor={{ x: 40, y: 60 }}
          sections={[
            [
              { id: 'here', label: 'Collapse in this repo', checked: true },
              { id: 'every', label: 'Collapse in every repo', checked: false },
              { id: 'fold', label: 'Collapse section', keys: ['z', 'a'] },
            ],
          ]}
          onClosed={onClosed}
        />
      );
    }
    const page = render(<Switches />);
    const switches = [...page.querySelectorAll('[role="menuitemcheckbox"]')];
    expect(switches.map((item) => item.getAttribute('aria-checked'))).toEqual(['true', 'false']);
    expect(switches.map((item) => item.querySelector('svg') !== null)).toEqual([true, false]);
    expect(items(page)).toHaveLength(1);
    act(() => {
      if (switches[1] instanceof HTMLElement) switches[1].click();
    });
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith('every'));
  });

  it('gives a screen reader an action’s key as aria-keyshortcuts, or a sequence described, never the key caps', () => {
    const page = render(<Harness />);
    const [show, , path] = items(page);
    expect(show?.getAttribute('aria-keyshortcuts')).toBe('Enter');
    expect(path?.hasAttribute('aria-keyshortcuts')).toBe(false);
    expect(path?.getAttribute('aria-description')).toBe('Keys y then p');
    for (const kbd of page.querySelectorAll('[role="menuitem"] kbd')) {
      expect(kbd.closest('[aria-hidden="true"]')).not.toBeNull();
    }
  });

  it('greys an action that can’t be done and says why', () => {
    const page = render(<Harness />);
    const stack = items(page).at(-1);
    expect(stack?.getAttribute('aria-disabled')).toBe('true');
    expect(stack?.hasAttribute('data-disabled')).toBe(true);
    expect(stack?.textContent).toContain('#4821 is in a merge queue.');
    expect(items(page)[0]?.hasAttribute('data-disabled')).toBe(false);
  });

  it('moves with the arrows, which reach a greyed action too, and chooses with ⏎', async () => {
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    const page = render(<Harness onClosed={onClosed} />);
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'ArrowDown');
    expect(highlighted(page)).toContain('Show in the diff');
    press(document.activeElement!, 'ArrowDown');
    expect(highlighted(page)).toContain('Mark viewed');
    press(document.activeElement!, 'ArrowUp');
    press(document.activeElement!, 'ArrowDown');
    press(document.activeElement!, 'ArrowDown');
    press(document.activeElement!, 'ArrowDown');
    expect(highlighted(page)).toContain('Make this a GitHub stack…');
    // ⏎ on a greyed action does nothing: the menu stays open.
    press(document.activeElement!, 'Enter');
    expect(onClosed).not.toHaveBeenCalled();
    expect(page.querySelector('[role="menu"]')).not.toBeNull();
    press(document.activeElement!, 'ArrowUp');
    press(document.activeElement!, 'Enter');
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith('path'));
  });

  it('highlights the first action that can be done as it opens from the keyboard, past a greyed one', async () => {
    const back = { id: 'back', label: 'Back', disabled: '' };
    const page = render(
      <ContextMenu
        open
        onOpenChange={() => undefined}
        label="File actions"
        anchor={{ x: 40, y: 60 }}
        sections={[[back, ...sections[0]!], ...sections.slice(1)]}
        highlightFirst
      />,
    );
    await vi.waitFor(() => expect(highlighted(page)).toContain('Show in the diff'));
    expect(items(page)[0]?.getAttribute('aria-disabled')).toBe('true');
  });

  it('highlights the first action as it opens from the keyboard where none can be done', async () => {
    const page = render(
      <ContextMenu
        open
        onOpenChange={() => undefined}
        label="File actions"
        anchor={{ x: 40, y: 60 }}
        sections={[
          [
            { id: 'back', label: 'Back', disabled: '' },
            { id: 'forward', label: 'Forward', disabled: '' },
          ],
        ]}
        highlightFirst
      />,
    );
    await vi.waitFor(() => expect(highlighted(page)).toBe('Back'));
  });

  it('closes on a click, then says which action was chosen', async () => {
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    const page = render(<Harness onClosed={onClosed} />);
    const viewed = items(page)[1];
    act(() => {
      if (viewed instanceof HTMLElement) viewed.click();
    });
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith('viewed'));
    expect(page.querySelector('[role="menu"]')).toBeNull();
  });

  it('closes on Esc with nothing chosen', async () => {
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    const onOpenChange = vi.fn<(open: boolean) => void>();
    const page = render(<Harness onClosed={onClosed} onOpenChange={onOpenChange} />);
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'Escape');
    expect(onOpenChange).toHaveBeenCalledWith(false);
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith(undefined));
  });

  it('takes focus itself, without waiting for a frame', async () => {
    // Keys reach the menu's scope only through focus, so none may reach the window first.
    const frame = vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
    try {
      const page = render(<Harness />);
      const menu = page.querySelector('[role="menu"]');
      expect(menu).not.toBeNull();
      await vi.waitFor(() => expect(document.activeElement).toBe(menu));
    } finally {
      frame.mockRestore();
    }
  });

  it('gives focus back to where it was when it closes', async () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const page = render(<Harness />);
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'Escape');
    await vi.waitFor(() => expect(document.activeElement).toBe(before));
    before.remove();
  });

  it('gives focus back to an element only a script can focus, not to a control inside it', async () => {
    // A block of text that has a link in it: the block had focus, not its link.
    const block = document.createElement('div');
    block.tabIndex = -1;
    const link = document.createElement('button');
    link.textContent = 'parse';
    block.append(link);
    document.body.append(block);
    block.focus();
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    const page = render(<Harness finalFocus={block} onClosed={onClosed} />);
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'Escape');
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith(undefined));
    // Focus is the block's when the caller hears the menu closed, and stays so.
    expect(document.activeElement).toBe(block);
    await act(async () => {
      await new Promise((settle) => setTimeout(settle, 0));
    });
    expect(document.activeElement).toBe(block);
    block.remove();
  });

  it('gives focus back to a part of a drawing, such as a figure’s', async () => {
    const drawing = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const part = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    part.setAttribute('tabindex', '0');
    part.setAttribute('role', 'link');
    drawing.append(part);
    document.body.append(drawing);
    part.focus();
    expect(document.activeElement).toBe(part);
    const onClosed = vi.fn<(chosen: string | undefined) => void>();
    const page = render(<Harness finalFocus={part} onClosed={onClosed} />);
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'Escape');
    await vi.waitFor(() => expect(onClosed).toHaveBeenCalledWith(undefined));
    expect(document.activeElement).toBe(part);
    drawing.remove();
  });

  it('has the `⋯` it opened from say it’s expanded while it’s open, and not once it closes', async () => {
    const more = document.createElement('button');
    more.setAttribute('aria-haspopup', 'menu');
    document.body.append(more);
    const page = render(<Harness opener={more} />);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const menu = page.querySelector('[role="menu"]')!;
    await vi.waitFor(() => expect(menu.contains(document.activeElement)).toBe(true));
    press(document.activeElement!, 'Escape');
    await vi.waitFor(() => expect(more.hasAttribute('aria-expanded')).toBe(false));
    more.remove();
  });

  it('opens nowhere without an anchor', () => {
    const page = render(
      <ContextMenu
        open
        onOpenChange={() => {}}
        label="Actions"
        anchor={undefined}
        sections={sections}
      />,
    );
    expect(page.querySelector('[role="menu"]')).toBeNull();
  });
});

describe('the styles', () => {
  it("only use utilities that Lo's stylesheet has", async () => {
    const page = render(<Harness />);
    const classes = [
      ...new Set(
        [...page.innerHTML.matchAll(/class="([^"]*)"/g)].flatMap(([, value]) =>
          (value ?? '').split(/\s+/),
        ),
      ),
    ].filter((name) => name !== '' && !name.startsWith('lo-'));
    expect(classes.length).toBeGreaterThan(20);
    const css = await buildCss(classes);
    expect(classes.filter((name) => !hasRule(css, name))).toEqual([]);
  });
});
