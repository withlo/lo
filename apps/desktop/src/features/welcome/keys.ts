// The welcome screen's keys: `⏎` signs in. The screen's other controls are buttons and a field,
// which `Tab` walks as it does in Settings, so their keys are the widgets' own.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands(
  'welcome',
  {
    /**
     * The welcome screen's default action. With focus on one of its other buttons, `⏎` presses
     * that one, and in its field it opens the link, as they would without this key.
     */
    signIn: {
      label: 'Sign in with GitHub',
      group: 'Act',
      keys: ['enter'],
      when: { scope: 'welcome' },
    },
  },
  { scopes: ['welcome'] },
);
