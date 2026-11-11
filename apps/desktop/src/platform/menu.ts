// The app menu. Electron's default one goes: it reloads the page on ⌘R and closes the window on ⌘W
// behind Lo's back. macOS gets a menu of the system's roles and Lo's commands; Linux gets none,
// since Lo draws its own window.
//
// On macOS a chord reaches the page first, and the menu only when the page let it pass, which Lo's
// registry does where its key doesn't apply. So a menu item a key triggered runs nothing: the key
// already ran its command or was meant to do nothing there, and a command runs once either way.
// Only clicks run Lo's commands.

import type { MenuItemConstructorOptions } from 'electron';

import type { BarItem, BarKey } from '../features/keys/contract.ts';

/** The app menu on `platform`: macOS's, or none on Linux. */
export function appMenu(
  platform: NodeJS.Platform,
  items: readonly BarItem[],
  options: MenuOptions,
): MenuItemConstructorOptions[] | null {
  return platform === 'darwin' ? macMenu(items, options) : null;
}

export interface MenuOptions {
  /** The app's name, for its own menu. */
  readonly name: string;
  /** Whether the View menu offers the developer tools. */
  readonly devTools: boolean;
  /** Runs a command a click chose, through the window's registry. */
  readonly run: (id: string) => void;
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** A menu with its items, or none when it has none. */
function menu(label: string, submenu: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return submenu.length > 0 ? [{ label, submenu }] : [];
}

/** The groups, separated, leaving out the empty ones. */
function grouped(...groups: MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  return groups
    .filter((group) => group.length > 0)
    .flatMap((group, index) => (index === 0 ? group : [separator, ...group]));
}

/**
 * The macOS app menu: the app's menu, File, Edit, View, Go, Review and Window, with Lo's commands
 * in the menus they declare, in their order. Nothing reloads the page or closes the window by
 * key, and the developer tools appear only when `devTools` says.
 */
export function macMenu(
  items: readonly BarItem[],
  options: MenuOptions,
): MenuItemConstructorOptions[] {
  const lo = (name: BarItem['menu']) =>
    items
      .filter((item) => item.menu === name)
      .toSorted((a, b) => a.order - b.order)
      .map((item) => loItem(item, options.run));
  return [
    {
      label: options.name,
      submenu: grouped(
        [{ role: 'about' }],
        [{ role: 'services' }],
        [{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }],
        [{ role: 'quit' }],
      ),
    },
    ...menu('File', lo('File')),
    {
      label: 'Edit',
      submenu: grouped(
        [{ role: 'undo' }, { role: 'redo' }],
        [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
      ),
    },
    ...menu(
      'View',
      grouped(lo('View'), options.devTools ? [{ role: 'toggleDevTools' }] : [], [
        { role: 'togglefullscreen' },
      ]),
    ),
    ...menu('Go', lo('Go')),
    ...menu('Review', lo('Review')),
    {
      label: 'Window',
      role: 'windowMenu',
      submenu: grouped([{ role: 'minimize' }, { role: 'zoom' }], lo('Window'), [{ role: 'front' }]),
    },
  ];
}

function loItem(item: BarItem, run: (id: string) => void): MenuItemConstructorOptions {
  const accelerator = item.key && acceleratorOf(item.key);
  return {
    id: item.id,
    label: item.label,
    enabled: item.enabled,
    ...(accelerator ? { accelerator } : {}),
    click(_menuItem, _window, event) {
      if (!event.triggeredByAccelerator) run(item.id);
    },
  };
}

/** Electron's names for the keys Lo names. */
const acceleratorNames: Readonly<Record<string, string>> = {
  enter: 'Return',
  esc: 'Escape',
  tab: 'Tab',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  insert: 'Insert',
  '+': 'Plus',
};

/** A keystroke as an Electron accelerator (`Command+Shift+P`), or undefined if it can't be one. */
export function acceleratorOf(key: BarKey): string | undefined {
  let name = acceleratorNames[key.key];
  if (name === undefined && /^f(?:[1-9]|1\d|2[0-4])$/.test(key.key)) name = key.key.toUpperCase();
  if (name === undefined && /^[!-~]$/.test(key.key)) name = key.key.toUpperCase();
  if (name === undefined) return undefined;
  const held = [
    ...(key.meta ? ['Command'] : []),
    ...(key.ctrl ? ['Control'] : []),
    ...(key.alt ? ['Alt'] : []),
    ...(key.shift ? ['Shift'] : []),
  ];
  return [...held, name].join('+');
}
