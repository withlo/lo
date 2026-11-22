// Settings' keys: opening its tab, moving between its groups, and searching it.

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
  },
  { scopes: ['settings'] },
);
