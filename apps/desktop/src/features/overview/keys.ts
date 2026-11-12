// The overview feature's keys: copying a prompt for a coding agent, anywhere in a pull request's
// tab, and installing the overview skill, which has none. The overview's own view is the `overview`
// scope.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'overview',
  {
    /**
     * Copies the prompt the tab's overview offers: to write one, bring it up to date, fix it or make
     * it smaller. It works wherever focus is in a pull request's tab, so it takes `y` over Vim's
     * yank in the code views, as `yy` does there.
     */
    copyPrompt: {
      label: 'Copy prompt for an agent',
      group: 'Overview',
      keys: ['y a'],
      overVim: true,
      when: { except: ['menu', 'dialog', 'palette', 'box'], mode: 'normal' },
    },
    /**
     * Installs the overview skill for the coding agents that are set up: done once, so it has no
     * key. It's in the app's own menu on macOS beside installing the command-line tool, in
     * Settings, on the welcome screen, and in the command palette.
     */
    installSkill: {
      label: 'Install overview skill',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'App', order: 20 },
    },
  },
  { scopes: ['overview'] },
);
