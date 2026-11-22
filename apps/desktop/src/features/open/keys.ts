// Opening pull requests: the open box, from anywhere but a dialog or a palette; the Recent list's
// keys, in its own scope; and installing the `lo` command.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'open',
  {
    /**
     * The open box, filled in when the clipboard holds a pull request's link. `⌘L` is the
     * browser's key for an address, on both systems; `⌘O` too on macOS, since on Linux it would be
     * Ctrl+O, Vim's `⌃o`.
     */
    box: {
      label: 'Review a pull request',
      group: 'Find',
      keys: ['cmd+l', { keys: 'cmd+o', on: 'mac' }],
      when: { except: ['dialog', 'palette'] },
      bar: { menu: 'File', order: 5 },
    },
    /** In Recent, opens the pull request link on the clipboard. */
    paste: {
      label: 'Open the link on the clipboard',
      control: "Paste link in Recent, before any pull request's listed",
      group: 'Find',
      keys: ['cmd+v'],
      when: { scope: 'recent' },
    },
    /** In Recent, to the box that filters it. */
    filter: {
      label: 'Filter recent pull requests',
      group: 'Find',
      keys: ['/'],
      when: { scope: 'recent' },
    },
    /**
     * In Recent's list, empties the filter, so every pull request shows again: the button where the
     * filter matches nothing. `⌘⌫` is what empties a line of text on macOS. The filter field is
     * outside the list's scope, so it keeps the key for its own editing, as Ctrl+Backspace on Linux.
     */
    clearFilter: {
      label: 'Clear filter',
      control: 'Clear filter in Recent, where the filter matches nothing',
      group: 'Find',
      keys: ['cmd+backspace'],
      when: { scope: 'recent' },
    },
    /** In Recent, opens the pull request chosen. */
    openRecent: {
      label: 'Open the pull request',
      group: 'Find',
      keys: ['enter'],
      when: { scope: 'recent' },
    },
    nextRecent: {
      label: 'Next pull request',
      group: 'Move',
      keys: ['j', 'down'],
      when: { scope: 'recent' },
      repeat: true,
    },
    previousRecent: {
      label: 'Previous pull request',
      group: 'Move',
      keys: ['k', 'up'],
      when: { scope: 'recent' },
      repeat: true,
    },
    /**
     * Installs `lo`, which reviews a pull request from a terminal: done once, so it has no key. It's
     * in the app's own menu on macOS, in Settings, and in the command palette.
     */
    installCommand: {
      label: 'Install command-line tool',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 10 },
    },
  },
  { scopes: ['recent'] },
);
