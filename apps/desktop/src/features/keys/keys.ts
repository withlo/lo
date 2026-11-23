// The registry's own commands. Back and Forward are the right-click menu of the window itself: what
// a click on nothing in particular lists.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('keys', {
  /** Every key. `?` is Vim's backward search in code views; Lo searches with `/` alone. */
  help: {
    label: 'Keyboard shortcuts',
    control: 'Show on the Keyboard shortcuts row of Settings',
    group: 'App',
    keys: ['?'],
    bar: { menu: 'Help', section: 'help', order: 20 },
    overVim: true,
  },
  palette: {
    label: 'Command palette',
    group: 'View',
    keys: ['cmd+shift+p'],
    bar: { menu: 'View', section: 'palette', order: 10 },
  },
  /** In the palette, shows the highlighted command in keyboard shortcuts. */
  showKey: {
    label: 'Show key',
    control: "Show key in the command palette's foot",
    group: 'App',
    keys: ['alt+enter'],
    when: { scope: 'palette' },
  },
  /**
   * The right-click menu of what has focus, for the keyboard: the context-menu key on keyboards
   * that have one, and ⇧F10 on every system. Not in a menu or a dialog, which have no target of
   * their own.
   */
  menu: {
    label: 'Show right-click menu',
    control: 'A right-click on what has focus',
    group: 'App',
    keys: ['menu', 'shift+f10'],
    when: { except: ['menu', 'dialog', 'palette'] },
  },
  /**
   * The app menu, as a menu at the end of the tab strip: Linux's window has no menu bar to hold it.
   * `F10` opens a window's menu on Linux's desktops.
   */
  appMenu: {
    label: 'Show menu',
    control: 'The menu button at the end of the tab strip',
    group: 'App',
    keys: ['f10'],
    when: { system: 'linux', except: ['menu', 'dialog', 'palette'] },
  },
  /**
   * Back to the middle view, from anywhere but the widgets that close on `Esc` themselves (menus,
   * dialogs, the palette), a comment box, whose `Esc` is Vim's, and Vim's visual mode. In the
   * middle view, it first closes what that has open, such as a note in the diff.
   */
  escape: {
    label: 'Go to view',
    description: 'Closes what’s open in the view first.',
    control: 'A click in the middle view',
    group: 'Go',
    keys: ['esc'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
  /** Back through the tab's history. In a comment box, `⌃o` is Vim's, on the box's own list. */
  back: {
    label: 'Back',
    group: 'Go',
    keys: ['ctrl+o'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', section: 'history', order: 10 },
    menu: { on: 'none', order: 10 },
  },
  forward: {
    label: 'Forward',
    group: 'Go',
    keys: ['ctrl+i'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', section: 'history', order: 20 },
    menu: { on: 'none', order: 20 },
  },
  /**
   * Opens the keymap file in the system's app for it, making it first if there is none. Not where
   * `g` goes to the widget or to Vim: in menus, dialogs, the palette and comment boxes.
   */
  openKeymap: {
    label: 'Open keymap file',
    control: "Open keymap file at the foot of Settings' list",
    group: 'App',
    keys: ['g ,'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
});
