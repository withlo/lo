// @vitest-environment jsdom
import { defineCommands, handlers, NO_TARGET, setScopeSource, type Target } from '@lo/ui/commands';
import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import keys from '../../features/keys/window/index.ts';
import { closeMenu, Menus, menu, openMenu, openMenuAtFocus, useMenuTarget } from './menus.tsx';
import { createRegistry, registry } from './registry.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

/** A feature declared only for these tests: commands with a menu on a file, a line and a thread. */
const declared = defineCommands(
  'tree',
  {
    show: {
      label: 'Show in the diff',
      group: 'Files',
      keys: ['enter'],
      targets: ['file'],
      menu: { on: 'file', order: 10 },
    },
    markViewed: {
      label: 'Mark viewed',
      group: 'Files',
      keys: ['e'],
      targets: ['file'],
      menu: { on: 'file', order: 20 },
    },
    copyPath: {
      label: 'Copy the path',
      group: 'Copy and open',
      keys: ['y p'],
      targets: ['file'],
      menu: { on: 'file', order: 30 },
    },
    comment: {
      label: 'Comment',
      group: 'Act',
      keys: ['c'],
      targets: ['line'],
      menu: { on: 'line', order: 10 },
    },
    quit: {
      label: 'Quit Lo',
      group: 'Tabs and window',
      keys: ['cmd+q'],
      when: { system: 'linux' },
      menu: { on: 'file', order: 40 },
    },
  },
  { scopes: ['tree'] },
);

const ran: { id: string; target: Target }[] = [];
const asked: Target[] = [];

/** A handler that notes the command and target it ran with. */
const record = (id: string) => ({
  run(target: Target) {
    ran.push({ id, target });
  },
});

function commands() {
  return [
    ...keys.commands,
    ...handlers(declared, {
      show: record('tree.show'),
      markViewed: {
        run(target) {
          ran.push({ id: 'tree.markViewed', target });
        },
        enabled(target) {
          asked.push(target);
          return target.file.startsWith('generated/') ? 'Generated files aren’t reviewed.' : true;
        },
      },
      copyPath: record('tree.copyPath'),
      comment: record('tree.comment'),
      quit: record('tree.quit'),
    }),
  ];
}

let root: Root | undefined;

function mount(node: ReactNode, system: 'mac' | 'linux' = 'mac'): HTMLElement {
  createRegistry(commands(), system);
  const page = document.createElement('div');
  page.id = 'root';
  page.className = 'lo-app';
  document.body.append(page);
  root = createRoot(page.appendChild(document.createElement('div')));
  act(() => root?.render(node));
  return page;
}

beforeEach(() => {
  ran.length = 0;
  asked.length = 0;
});

afterEach(() => {
  act(() => closeMenu());
  act(() => root?.unmount());
  root = undefined;
  document.body.replaceChildren();
});

/** The menu that's open, if one is. */
const popup = () => document.querySelector('[role="menu"]');
const items = () => [...document.querySelectorAll('[role="menuitem"]')];
const labelOf = (item: Element) => item.querySelector('span span')?.textContent;
const labels = () => items().map(labelOf);
const press = (key: string) =>
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });

/** A right-click on `element`, as the page sends it: the event React hears. */
function rightClick(element: Element, at = { x: 30, y: 40 }): MouseEvent {
  const event = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: at.x,
    clientY: at.y,
  });
  act(() => {
    element.dispatchEvent(event);
  });
  return event;
}

/** An element whose right-click opens the menu of `target`. */
function Clickable({
  target,
  id,
  children,
}: {
  target: Parameters<typeof useMenuTarget>[0];
  id: string;
  children?: ReactNode;
}) {
  const props = useMenuTarget(target);
  return (
    <div id={id} tabIndex={-1} {...props}>
      {children}
    </div>
  );
}

const file: Target = { kind: 'file', file: 'plugins/rate-limit.ts' };

describe('a right-click', () => {
  it('opens the menu of the target clicked, with its keys in this system’s form', () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    const event = rightClick(page.querySelector('#row')!);
    expect(event.defaultPrevented).toBe(true);
    expect(popup()?.getAttribute('aria-label')).toBe('File actions');
    expect(popup()?.getAttribute('data-lo-scope')).toBe('menu');
    expect(labels()).toEqual(['Show in the diff', 'Mark viewed', 'Copy the path']);
    expect(
      items().map((item) => [...item.querySelectorAll('kbd')].map((kbd) => kbd.textContent)),
    ).toEqual([['⏎'], ['e'], ['y', 'p']]);
    expect(page.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it('shows each system its own keys, and its own commands', () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
      'linux',
    );
    rightClick(page.querySelector('#row')!);
    expect(labels()).toEqual(['Show in the diff', 'Mark viewed', 'Copy the path', 'Quit Lo']);
    expect(
      items().map((item) => [...item.querySelectorAll('kbd')].map((kbd) => kbd.textContent)),
    ).toEqual([['Enter'], ['e'], ['y', 'p'], ['Ctrl+Q']]);
  });

  it('lists the window’s own actions where nothing in particular was clicked', () => {
    const page = mount(
      <>
        <Clickable id="window" target={NO_TARGET}>
          <div id="empty" />
        </Clickable>
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#empty')!);
    expect(popup()?.getAttribute('aria-label')).toBe('Actions');
    expect(labels()).toEqual(['Back', 'Forward', 'Command palette', 'Every key']);
  });

  it('is taken by the innermost target that has a menu, and left to the next if none does', () => {
    const page = mount(
      <>
        <Clickable id="window" target={NO_TARGET}>
          <Clickable id="row" target={file}>
            <Clickable id="thread" target={{ kind: 'thread', thread: 't1' }} />
          </Clickable>
        </Clickable>
        <Menus />
      </>,
    );
    // Nothing has a menu on a thread, so the file around it takes the click.
    rightClick(page.querySelector('#thread')!);
    expect(popup()?.getAttribute('aria-label')).toBe('File actions');
    act(() => closeMenu());
    // The file's own.
    rightClick(page.querySelector('#row')!);
    expect(popup()?.getAttribute('aria-label')).toBe('File actions');
  });

  it('leaves a click on a target with no menu alone', () => {
    const page = mount(
      <>
        <Clickable id="thread" target={{ kind: 'thread', thread: 't1' }} />
        <Menus />
      </>,
    );
    const event = rightClick(page.querySelector('#thread')!);
    expect(event.defaultPrevented).toBe(false);
    expect(popup()).toBeNull();
  });

  it('asks a target of the click, as a code view finds the line under the pointer', () => {
    const page = mount(
      <>
        <Clickable
          id="code"
          target={(event) => ({
            kind: 'line',
            at: { file: 'rate-limit.ts', side: 'new', line: Math.round(event.clientY / 10) },
          })}
        />
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#code')!, { x: 10, y: 410 });
    expect(labels()).toEqual(['Comment']);
    act(() => {
      items()[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    return vi.waitFor(() =>
      expect(ran).toEqual([
        {
          id: 'tree.comment',
          target: { kind: 'line', at: { file: 'rate-limit.ts', side: 'new', line: 41 } },
        },
      ]),
    );
  });

  it('leaves an open menu where it is, as the browser’s own event for its key would', () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    act(() => {
      openMenu(file, { x: 5, y: 6 }, true);
    });
    const event = rightClick(page.querySelector('#row')!, { x: 120, y: 80 });
    expect(event.defaultPrevented).toBe(true);
    expect(menu()?.anchor).toEqual({ x: 5, y: 6 });
    expect(menu()?.keyboard).toBe(true);
  });

  it('opens at the pointer', () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#row')!, { x: 120, y: 80 });
    expect(menu()?.anchor).toEqual({ x: 120, y: 80 });
    expect(menu()?.keyboard).toBe(false);
  });
});

describe('choosing an action', () => {
  it('runs the command on the target clicked, through the registry, once the menu has closed', async () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#row')!);
    const viewed = items()[1];
    act(() => {
      viewed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await vi.waitFor(() => expect(ran).toEqual([{ id: 'tree.markViewed', target: file }]));
    expect(popup()).toBeNull();
    // The handler a key runs is the one the menu ran: `enabled` was asked about the same target.
    expect(asked.every((target) => target === file || target.kind === 'file')).toBe(true);
  });

  it('runs nothing when the menu is closed with Esc', async () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#row')!);
    await vi.waitFor(() => expect(popup()?.contains(document.activeElement)).toBe(true));
    press('Escape');
    await vi.waitFor(() => expect(popup()).toBeNull());
    expect(ran).toEqual([]);
  });

  it('greys an action its handler says can’t run on this target, with the reason, and runs nothing', async () => {
    const generated: Target = { kind: 'file', file: 'generated/api.ts' };
    const page = mount(
      <>
        <Clickable id="row" target={generated} />
        <Menus />
      </>,
    );
    rightClick(page.querySelector('#row')!);
    const viewed = items()[1];
    expect(viewed?.getAttribute('aria-disabled')).toBe('true');
    expect(viewed?.textContent).toContain('Generated files aren’t reviewed.');
    expect(viewed?.querySelector('kbd')?.textContent).toBe('e');
    expect(items()[0]?.hasAttribute('data-disabled')).toBe(false);
    act(() => {
      viewed?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    // The arrows reach it, as they do every item, and ⏎ on it does nothing.
    await vi.waitFor(() => expect(popup()?.contains(document.activeElement)).toBe(true));
    press('ArrowDown');
    press('ArrowDown');
    expect(items()[1]?.hasAttribute('data-highlighted')).toBe(true);
    press('Enter');
    expect(ran).toEqual([]);
    expect(popup()).not.toBeNull();
  });

  it('shows a remapped key as it is now', () => {
    const page = mount(
      <>
        <Clickable id="row" target={file} />
        <Menus />
      </>,
    );
    act(() => {
      registry().setKeymap('bind cmd+shift+e tree.markViewed\nunbind e tree.markViewed');
    });
    rightClick(page.querySelector('#row')!);
    expect(items()[1]?.querySelector('kbd')?.textContent).toBe('⌘⇧E');
    act(() => {
      registry().setKeymap('');
    });
    expect(items()[1]?.querySelector('kbd')?.textContent).toBe('e');
  });
});

describe('from the keyboard', () => {
  it('opens the menu of what has focus, under it, with the first action highlighted', async () => {
    const page = mount(
      <>
        <div id="tree" data-lo-scope="tree" tabIndex={-1} />
        <Menus />
      </>,
    );
    const tree = page.querySelector<HTMLElement>('#tree')!;
    setScopeSource(tree, { target: () => file });
    tree.focus();
    act(() => {
      openMenuAtFocus();
    });
    expect(popup()?.getAttribute('aria-label')).toBe('File actions');
    expect(menu()?.keyboard).toBe(true);
    await vi.waitFor(() => expect(items()[0]?.hasAttribute('data-highlighted')).toBe(true));
    // ⏎ runs it, on the focused scope's target, as the key of the first action would.
    press('Enter');
    await vi.waitFor(() => expect(ran).toEqual([{ id: 'tree.show', target: file }]));
  });

  it('returns focus to the element it was opened from', async () => {
    const page = mount(
      <>
        <div id="tree" data-lo-scope="tree" tabIndex={-1} />
        <Menus />
      </>,
    );
    const tree = page.querySelector<HTMLElement>('#tree')!;
    setScopeSource(tree, { target: () => file });
    tree.focus();
    act(() => {
      openMenuAtFocus();
    });
    await vi.waitFor(() => expect(popup()?.contains(document.activeElement)).toBe(true));
    press('Escape');
    await vi.waitFor(() => expect(popup()).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(tree));
  });

  it('opens nothing where the focused scope has no menu', () => {
    const page = mount(
      <>
        <div id="tree" data-lo-scope="tree" tabIndex={-1} />
        <Menus />
      </>,
    );
    const tree = page.querySelector<HTMLElement>('#tree')!;
    setScopeSource(tree, { target: () => ({ kind: 'thread', thread: 't1' }) });
    tree.focus();
    let opened = true;
    act(() => {
      opened = openMenuAtFocus();
    });
    expect(opened).toBe(false);
    expect(popup()).toBeNull();
  });

  it('is a command with the menu key and ⇧F10, which opens the menu of the focused scope', () => {
    const page = mount(
      <>
        <div id="tree" data-lo-scope="tree" tabIndex={-1} />
        <Menus />
      </>,
    );
    const tree = page.querySelector<HTMLElement>('#tree')!;
    setScopeSource(tree, { target: () => file });
    tree.focus();
    const command = registry().command('keys.menu');
    expect(command?.label).toBe('Show the right-click menu');
    expect(
      registry()
        .keysOf('keys.menu')
        .map((strokes) => strokes.map((stroke) => stroke.id)),
    ).toEqual([['menu'], ['shift+f10']]);
    act(() => {
      registry().run('keys.menu', NO_TARGET);
    });
    expect(popup()?.getAttribute('aria-label')).toBe('File actions');
  });
});

describe('the menu’s state', () => {
  it('is open only until it’s closed', () => {
    mount(<Menus />);
    expect(menu()).toBeUndefined();
    let opened = false;
    act(() => {
      opened = openMenu(NO_TARGET, { x: 1, y: 2 });
    });
    expect(opened).toBe(true);
    expect(menu()?.target).toEqual(NO_TARGET);
    act(() => closeMenu());
    expect(menu()).toBeUndefined();
  });
});
