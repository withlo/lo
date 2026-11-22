// The welcome's keys: `⏎` presses the step's main button. Its other controls are buttons, cards and
// a field, which `Tab` walks as it does in Settings, so their keys are the widgets' own. "Welcome
// to Lo" opens it again, from the Help menu and the command palette.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'welcome',
  {
    /** Opens the welcome over the tab on screen, at its first step, each step as it stands now. */
    show: {
      label: 'Welcome to Lo',
      control: 'Show on the Welcome to Lo row of Settings › About',
      group: 'Tabs and window',
      keys: [],
      bar: { menu: 'Help', order: 10 },
    },
    /**
     * The step's main button: "Continue", "Done" on the last step, and signing in on the first
     * while no account is signed in. With focus on another button, `⏎` presses that one, and in the
     * link field it opens the link, as they would without this key.
     */
    continue: {
      label: 'Continue',
      control: "The main button in the welcome's foot",
      group: 'Act',
      keys: ['enter'],
      when: { scope: 'welcome' },
    },
  },
  { scopes: ['welcome'] },
);
