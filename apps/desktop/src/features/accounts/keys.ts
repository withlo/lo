// The accounts feature's keys: copying the code in the sign-in dialog, and adding and signing out of
// accounts, which are done once in a while, so they have no key: the app menu and the command
// palette reach them. The dialogs' other keys are their widgets' own: `⏎` on the main button, `Esc`
// to cancel, `Space` on a switch, and `j`, `k` or the arrows among an account picker's choices.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('accounts', {
  /** In the sign-in dialog, copies the code to type on GitHub's page. */
  copyCode: {
    label: 'Copy sign-in code',
    control: 'Copy beside the code, in Sign in with GitHub',
    group: 'Copy and open',
    keys: ['y y'],
    when: { scope: 'dialog' },
  },
  /** Starts signing in with GitHub, with an account to add to those Lo has. */
  addAccount: {
    label: 'Sign in with GitHub…',
    control: 'Sign in with GitHub… on the GitHub row of Settings › Accounts',
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 30 },
  },
  /**
   * Opens the dialog for signing out: it asks which account when Lo has several, and what signing
   * out does either way.
   */
  signOut: {
    label: 'Sign out…',
    control: "Sign out… on each account's row of Settings › Accounts",
    group: 'Tabs and window',
    keys: [],
    bar: { menu: 'App', order: 40 },
  },
});
