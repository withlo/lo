// Settings' keys: opening its tab, moving between its groups, and searching it; and opening the
// settings file, beside the keymap file's key, and showing the cache's folder, in Settings.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'settings',
  {
    /** Opens Settings in a tab of its own, or shows it if it's open. */
    open: {
      label: 'Settings',
      control: 'the gear at the end of the tab strip',
      group: 'Tabs and window',
      keys: ['cmd+,'],
      when: { except: ['dialog', 'palette'] },
    },
    /** In Settings, on the list of groups or the rows themselves. */
    nextSection: {
      label: 'Next group',
      control: "a group in Settings' list",
      group: 'Move',
      keys: ['j'],
      when: { scope: 'settings' },
      repeat: true,
    },
    previousSection: {
      label: 'Previous group',
      control: "a group in Settings' list",
      group: 'Move',
      keys: ['k'],
      when: { scope: 'settings' },
      repeat: true,
    },
    /** Goes to the search field over Settings' rows, with what it holds selected. */
    search: {
      label: 'Search settings',
      control: "the search field over Settings' rows",
      group: 'Find',
      keys: ['/', 'cmd+f'],
      when: { scope: 'settings' },
    },
    /** Opens the settings file in the system's text editor, so the person can fix it. */
    openFile: {
      label: 'Open settings.json',
      control: "Open settings.json at the foot of Settings' list",
      group: 'Tabs and window',
      keys: ['g .'],
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    },
    /** Shows the cache's folder in Finder, or in the system's file manager. */
    showCache: {
      label: 'Show cache folder',
      control: 'Show in Finder on the Cache row of Settings › Storage',
      group: 'Tabs and window',
      keys: ['g c'],
      when: { scope: 'settings' },
    },
  },
  { scopes: ['settings'] },
);
