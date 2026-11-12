// The overview feature's keys: for now, installing the overview skill, which has none.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('overview', {
  /**
   * Installs the overview skill for the coding agents that are set up: done once, so it has no key.
   * It's in the app's own menu on macOS beside installing the command-line tool, in Settings, on
   * the welcome screen, and in the command palette.
   */
  installSkill: {
    label: 'Install overview skill',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 20 },
  },
});
