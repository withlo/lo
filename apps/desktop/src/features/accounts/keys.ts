// The accounts feature's keys: copying the code in the sign-in dialog. The dialogs' other keys are
// their widgets' own: `⏎` on the main button, `Esc` to cancel, `Space` on a switch, and `j`, `k` or
// the arrows among an account picker's choices.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('accounts', {
  /** In the sign-in dialog, copies the code to type on GitHub's page. */
  copyCode: {
    label: 'Copy the sign-in code',
    group: 'Copy and open',
    keys: ['y y'],
    when: { scope: 'dialog' },
  },
});
