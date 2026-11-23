// The window's own commands. Quitting, going full screen and About are the system's on macOS, its
// app menu's roles, and Lo's on Linux, in the same places of the app menu there. Zooming is Lo's
// on both, in the View menu. Opening the licenses is Lo's on both, from Settings › About. The Help
// menu's documentation and issues are Lo's pages on GitHub.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('app', {
  /** Ctrl+Q quits wherever focus is, as in other Linux apps, even over Vim's ⌃q in code views. */
  quit: {
    label: 'Quit Lo',
    group: 'App',
    keys: ['cmd+q'],
    bar: { menu: 'File', section: 'quit', order: 10 },
    overVim: true,
    when: { system: 'linux' },
  },
  /** `cmd+plus` is ⌘ or Ctrl and the key that types `+`: Shift and `=` on a US keyboard. */
  zoomIn: {
    label: 'Zoom in',
    control: 'the + on the Zoom row of Settings › Appearance',
    group: 'View',
    keys: ['cmd+=', 'cmd+plus'],
    bar: { menu: 'View', section: 'zoom', order: 10 },
  },
  zoomOut: {
    label: 'Zoom out',
    control: 'the − on the Zoom row of Settings › Appearance',
    group: 'View',
    keys: ['cmd+-'],
    bar: { menu: 'View', section: 'zoom', order: 20 },
  },
  actualSize: {
    label: 'Reset zoom',
    control: 'Reset on the Zoom row of Settings › Appearance',
    group: 'View',
    keys: ['cmd+0'],
    bar: { menu: 'View', section: 'zoom', order: 30 },
  },
  fullScreen: {
    label: 'Full screen',
    group: 'View',
    keys: ['f11'],
    bar: { menu: 'View', section: 'screen', order: 10 },
    toggle: 'switch',
    when: { system: 'linux' },
  },
  /**
   * Shows the system's About panel. Done once in a while, so it has no key: the Help menu, Linux's
   * right-click menu and the palette reach it. On macOS, the app menu's About does it.
   */
  about: {
    label: 'About Lo',
    group: 'App',
    keys: [],
    bar: { menu: 'Help', section: 'about', order: 10 },
    when: { system: 'linux' },
    menu: { on: 'none', order: 30 },
  },
  /**
   * Opens the file of licenses: Lo's, and those of the packages and files it ships. It's how the
   * About panel says to read Lo's license, as GPL-3.0 asks, so it has no key and sits in Settings ›
   * About, and beside About in Linux's right-click menu.
   */
  licenses: {
    label: 'Open licenses',
    control: 'Show on the Licenses row of Settings › About',
    group: 'App',
    keys: [],
    menu: { on: 'none', order: 40 },
  },
  /** Opens Lo's documentation, its README on GitHub, in the browser. */
  docs: {
    label: 'Documentation',
    group: 'App',
    keys: [],
    bar: { menu: 'Help', section: 'help', order: 30 },
  },
  /** Opens a new issue on Lo's repository on GitHub, in the browser, for a bug or an idea. */
  report: {
    label: 'Report issue',
    group: 'App',
    keys: [],
    bar: { menu: 'Help', section: 'news', order: 20 },
  },
});
