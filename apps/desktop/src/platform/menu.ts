// The app menu: one tree of eight menus on both systems. Electron's default one goes: it reloads the
// page on ⌘R and closes the window on ⌘W behind Lo's back. macOS shows the tree as the menu bar,
// with the system's roles where its menus have them; Lo's window on Linux is frameless, with no
// menu bar, so there the same tree is the menu that opens from the end of the tab strip.
//
// On macOS a chord reaches the page first, and the menu only when the page let it pass, which Lo's
// registry does where its key doesn't apply. So a menu item a key triggered runs nothing: the key
// already ran its command or was meant to do nothing there, and a command runs once either way.
// Only clicks run Lo's commands. A menu that pops up registers no keys, so on Linux none can.

import type { MenuItemConstructorOptions } from 'electron';

import type { BarItem, BarKey } from '../features/keys/contract.ts';

/** The systems the app menu is drawn on. */
type System = 'mac' | 'linux';

/** The system's own items, by role, with the label each has in Lo's words where it differs. */
interface Roles {
  readonly roles: readonly MenuItemConstructorOptions[];
  /** Only on this system: the other has no such role, or a command of Lo's in its place. */
  readonly on?: System;
  /** Only in a build that offers the developer tools. */
  readonly dev?: true;
}

/** A section Lo's commands join by name: a command's `bar` names its menu and this. */
interface Section {
  readonly section: string;
}

/** A menu of the app menu: its name, which commands join it by, and its parts, in order. */
interface BarMenu {
  readonly menu: string;
  /** Its role, for a menu macOS fills or searches: Window and Help. */
  readonly role?: 'windowMenu' | 'help';
  /** Its parts, separated. */
  readonly parts: readonly (Roles | Section)[];
}

/**
 * The app menu's menus, in order, and the parts of each, which separators part: the system's own
 * items, by role, and the sections Lo's commands join by name. Lo's menu is shown as the app's name;
 * every other menu as its name. A command names the menu and section it's in, and its order there,
 * in its `bar`, and a test fails on one that names a menu or section this doesn't have.
 *
 * The menu bar holds actions on the window and the pull request. Preferences and one-time set-up
 * are in Settings.
 */
export const barMenus: readonly BarMenu[] = [
  {
    menu: 'Lo',
    parts: [
      { roles: [{ role: 'about' }], on: 'mac' },
      // Check for updates, and Settings.
      { section: 'app' },
      { roles: [{ role: 'services' }], on: 'mac' },
      {
        roles: [
          { role: 'hide' },
          { role: 'hideOthers', label: 'Hide others' },
          { role: 'unhide', label: 'Show all' },
        ],
        on: 'mac',
      },
      { roles: [{ role: 'quit' }], on: 'mac' },
    ],
  },
  {
    menu: 'File',
    // Opening a pull request; its page and link; closing its tab; and Quit, on Linux.
    parts: [{ section: 'open' }, { section: 'pull' }, { section: 'tab' }, { section: 'quit' }],
  },
  {
    menu: 'Edit',
    parts: [
      { roles: [{ role: 'undo' }, { role: 'redo' }] },
      {
        roles: [
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll', label: 'Select all' },
        ],
      },
      { section: 'find' },
    ],
  },
  {
    menu: 'View',
    // Overview, Diff and Timeline; the panels and code beside; the width of what has focus; the
    // diff's layout; how review threads show in it; what it shows; the command palette; reading the
    // tab again; zoom; and full screen, which is a command of Lo's on Linux. Each choice of two is a
    // part of its own: Electron makes one choice of every radio item between two separators.
    parts: [
      { section: 'views' },
      { section: 'panels' },
      { section: 'layout' },
      { section: 'diff' },
      { section: 'threads' },
      { section: 'shows' },
      { section: 'palette' },
      { section: 'refresh' },
      { section: 'zoom' },
      { roles: [{ role: 'toggleDevTools', label: 'Developer tools' }], dev: true },
      { roles: [{ role: 'togglefullscreen', label: 'Full screen' }], on: 'mac' },
      { section: 'screen' },
    ],
  },
  {
    menu: 'Go',
    // Back, Forward and the other view; the next and previous change, file and thread; and Go to file.
    parts: [{ section: 'history' }, { section: 'steps' }, { section: 'find' }],
  },
  {
    menu: 'Review',
    // Submitting the review; and merging.
    parts: [{ section: 'review' }, { section: 'merge' }],
  },
  {
    menu: 'Window',
    role: 'windowMenu',
    parts: [
      { roles: [{ role: 'minimize' }, { role: 'zoom' }], on: 'mac' },
      { roles: [{ role: 'minimize' }], on: 'linux' },
      { section: 'tabs' },
      { roles: [{ role: 'front', label: 'Bring all to front' }], on: 'mac' },
    ],
  },
  {
    menu: 'Help',
    role: 'help',
    // The welcome, keyboard shortcuts and the docs; what's new and reporting an issue; and About,
    // on Linux.
    parts: [{ section: 'help' }, { section: 'news' }, { section: 'about' }],
  },
];

/** Each menu by name, with the names of the sections commands join, for the check of them. */
export function barNames(): { menu: string; sections: string[] }[] {
  return barMenus.map(({ menu, parts }) => ({
    menu,
    sections: parts.flatMap((part) => ('section' in part ? [part.section] : [])),
  }));
}

/**
 * What a system's app menu calls a command where that differs from its label: macOS's Settings in
 * the app's own menu has the system's `…`.
 */
const systemLabels: Readonly<Record<System, Readonly<Record<string, string>>>> = {
  mac: { 'settings.open': 'Settings…' },
  linux: {},
};

export interface MenuOptions {
  /** The app's name, for its own menu. */
  readonly name: string;
  /** Whether the View menu offers the developer tools. */
  readonly devTools: boolean;
  /** Runs a command a click chose, through the window's registry. */
  readonly run: (id: string) => void;
  /**
   * Draws the menu again from the tree as the window last listed it. Electron flips a check box's
   * or a radio item's mark itself, on a click or its key, whatever the command then does.
   */
  readonly redraw: () => void;
}

/** The app menu on `platform`, from the commands the window lists. */
export function appMenu(
  platform: NodeJS.Platform,
  items: readonly BarItem[],
  options: MenuOptions,
): MenuItemConstructorOptions[] {
  return menuTree(platform === 'darwin' ? 'mac' : 'linux', items, options);
}

const separator: MenuItemConstructorOptions = { type: 'separator' };

/** The parts, separated, leaving out the empty ones. */
function separated(parts: readonly MenuItemConstructorOptions[][]): MenuItemConstructorOptions[] {
  return parts
    .filter((part) => part.length > 0)
    .flatMap((part, index) => (index === 0 ? part : [separator, ...part]));
}

/**
 * One section's commands, in their order. One that takes another's place while it can run
 * (`instead`) does, and isn't there otherwise.
 */
function inSection(items: readonly BarItem[], menu: string, section: string): BarItem[] {
  const here = items.filter((item) => item.menu === menu && item.section === section);
  const taken = new Set(
    here.flatMap((item) => (item.instead !== undefined && item.enabled ? [item.instead] : [])),
  );
  return here
    .filter((item) => !taken.has(item.id) && (item.instead === undefined || item.enabled))
    .toSorted((a, b) => a.order - b.order);
}

/**
 * The app menu on `system`: the eight menus, each with those of its parts that have anything in
 * them. On Linux, Lo's menu has no roles of the system's, and the commands Linux has for quitting,
 * About and full screen are in File, Help and View instead. A menu with nothing in it isn't there.
 */
export function menuTree(
  system: System,
  items: readonly BarItem[],
  options: MenuOptions,
): MenuItemConstructorOptions[] {
  return barMenus.flatMap(({ menu, role, parts }): MenuItemConstructorOptions[] => {
    const submenu = separated(
      parts.map((part) => {
        if ('section' in part) {
          return inSection(items, menu, part.section).map((item) => loItem(item, system, options));
        }
        if (part.on !== undefined && part.on !== system) return [];
        if (part.dev && !options.devTools) return [];
        return [...part.roles];
      }),
    );
    if (submenu.length === 0) return [];
    const label = menu === 'Lo' ? options.name : menu;
    // Only macOS fills or searches a menu by its role.
    return [{ label, ...(system === 'mac' && role ? { role } : {}), submenu }];
  });
}

/**
 * A command's item: its label, key and state, and a check where it's a switch or a choice. A click
 * on a check has the menu drawn again as the window last said, so its mark shows what's on until
 * the window says what the command changed, not what Electron flipped it to.
 */
function loItem(item: BarItem, system: System, options: MenuOptions): MenuItemConstructorOptions {
  const accelerator = item.key && acceleratorOf(item.key);
  const toggle: MenuItemConstructorOptions =
    item.toggle === undefined
      ? {}
      : { type: item.toggle === 'choice' ? 'radio' : 'checkbox', checked: item.checked === true };
  return {
    id: item.id,
    label: systemLabels[system][item.id] ?? item.label,
    enabled: item.enabled,
    ...toggle,
    ...(accelerator ? { accelerator } : {}),
    click(_menuItem, _window, event) {
      if (item.toggle !== undefined) options.redraw();
      if (!event.triggeredByAccelerator) options.run(item.id);
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
