// Settings' keys: opening the tab, and moving between its sections.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'settings',
  {
    /** Opens Settings in a tab of its own, or shows it if it's open. */
    open: {
      label: 'Open Settings',
      group: 'Tabs and window',
      keys: ['cmd+,'],
      when: { except: ['dialog', 'palette'] },
    },
    /** In Settings, on the list of sections or the sections themselves. */
    nextSection: {
      label: 'Next section of Settings',
      group: 'Move',
      keys: ['j'],
      when: { scope: 'settings' },
      repeat: true,
    },
    previousSection: {
      label: 'Previous section of Settings',
      group: 'Move',
      keys: ['k'],
      when: { scope: 'settings' },
      repeat: true,
    },
  },
  { scopes: ['settings'] },
);
