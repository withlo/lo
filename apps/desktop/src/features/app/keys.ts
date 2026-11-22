// The window's own commands. Linux has no app menu to quit, go full screen or open About from, so
// those three are Lo's there; on macOS the app menu's roles do them. Zooming is Lo's on both, in
// the View menu on macOS. Showing the licenses is Lo's on both, in the app menu on macOS.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('app', {
  /** Ctrl+Q quits wherever focus is, as in other Linux apps, even over Vim's ⌃q in code views. */
  quit: {
    label: 'Quit Lo',
    group: 'Tabs and window',
    keys: ['cmd+q'],
    overVim: true,
    when: { system: 'linux' },
  },
  /** `cmd+plus` is ⌘ or Ctrl and the key that types `+`: Shift and `=` on a US keyboard. */
  zoomIn: {
    label: 'Zoom in',
    control: 'the + on the Zoom row of Settings › Appearance',
    group: 'Tabs and window',
    keys: ['cmd+=', 'cmd+plus'],
    bar: { menu: 'View', order: 100 },
  },
  zoomOut: {
    label: 'Zoom out',
    control: 'the − on the Zoom row of Settings › Appearance',
    group: 'Tabs and window',
    keys: ['cmd+-'],
    bar: { menu: 'View', order: 110 },
  },
  actualSize: {
    label: 'Reset zoom',
    control: 'Reset on the Zoom row of Settings › Appearance',
    group: 'Tabs and window',
    keys: ['cmd+0'],
    bar: { menu: 'View', order: 120 },
  },
  fullScreen: {
    label: 'Full screen',
    group: 'Tabs and window',
    keys: ['f11'],
    when: { system: 'linux' },
  },
  /**
   * Shows the system's About panel. Done once in a while, so it has no key: Linux's right-click
   * menu and the palette reach it. On macOS, the app menu's About does it.
   */
  about: {
    label: 'About Lo',
    group: 'Tabs and window',
    keys: [],
    when: { system: 'linux' },
    menu: { on: 'none', order: 30 },
  },
  /**
   * Opens the file of licenses: Lo's, and those of the packages and files it ships. It's how the
   * About panel says to read Lo's license, as GPL-3.0 asks, so it has no key and sits where About
   * does: under it in the app menu on macOS, and beside it in Linux's right-click menu.
   */
  licenses: {
    label: 'Show licenses',
    control: 'Show on the Licenses row of Settings › About',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 5 },
    menu: { on: 'none', order: 40 },
  },
});
