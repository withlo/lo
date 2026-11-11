// The registry's own commands. Back and Forward are the right-click menu of the window itself: what
// a click on nothing in particular lists.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('keys', {
  /** Every key. `?` is Vim's backward search in code views; Lo searches with `/` alone. */
  help: {
    label: 'Every key',
    group: 'Tabs and window',
    keys: ['?'],
    overVim: true,
  },
  palette: {
    label: 'Command palette',
    group: 'Find',
    keys: ['cmd+shift+p'],
  },
  /** In the palette, shows the highlighted action in key help. */
  showKey: {
    label: "Show an action's key",
    group: 'Palettes',
    keys: ['alt+enter'],
    when: { scope: 'palette' },
  },
  /**
   * The right-click menu of what has focus, for the keyboard: the context-menu key on keyboards
   * that have one, and ⇧F10 on every system. Not in a menu or a dialog, which have no target of
   * their own.
   */
  menu: {
    label: 'Show the right-click menu',
    group: 'Tabs and window',
    keys: ['menu', 'shift+f10'],
    when: { except: ['menu', 'dialog', 'palette'] },
  },
  /**
   * Back to the middle view, from anywhere but the widgets that close on `Esc` themselves (menus,
   * dialogs, the palette), a comment box, whose `Esc` is Vim's, and Vim's visual mode.
   */
  escape: {
    label: 'Back to the middle view',
    group: 'Tabs and window',
    keys: ['esc'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
  /** Back through the tab's history. In a comment box, `⌃o` is Vim's, on the box's own list. */
  back: {
    label: 'Back',
    group: 'Code',
    keys: ['ctrl+o'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', order: 10 },
    menu: { on: 'none', order: 10 },
  },
  forward: {
    label: 'Forward',
    group: 'Code',
    keys: ['ctrl+i'],
    overVim: true,
    when: { except: ['box'] },
    bar: { menu: 'Go', order: 20 },
    menu: { on: 'none', order: 20 },
  },
  /**
   * Opens the keymap file in the system's app for it, making it first if there is none. Not where
   * `g` goes to the widget or to Vim: in menus, dialogs, the palette and comment boxes.
   */
  openKeymap: {
    label: 'Open the keymap file',
    group: 'Tabs and window',
    keys: ['g ,'],
    when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
  },
});
