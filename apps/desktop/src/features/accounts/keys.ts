// The accounts feature's keys: copying the code in the sign-in dialog, and adding, signing in again
// and signing out of accounts, which are done once in a while, so they have no key: the app menu and
// the command palette reach them. The dialogs' other keys are their widgets' own: `⏎` on the main
// button, `Esc` to cancel, `Space` on a switch, and `j`, `k` or the arrows among the sign-out
// dialog's choices.

import { defineCommands } from '@lo/ui/commands';

export default defineCommands('accounts', {
  /** In the sign-in dialog, copies the code to type on GitHub's page. */
  copyCode: {
    label: 'Copy sign-in code',
    control: 'Copy beside the code, in Sign in with GitHub',
    group: 'App',
    keys: ['y y'],
    when: { scope: 'dialog' },
  },
  /**
   * Starts signing in with GitHub, with an account to add to those Lo has: "Add account…" once one
   * is listed.
   */
  addAccount: {
    label: 'Sign in with GitHub…',
    control: 'Sign in with GitHub…, or Add account…, on the GitHub row of Settings › Accounts',
    group: 'App',
    keys: [],
  },
  /**
   * Signs in with GitHub, saying only that it signs in, as an account GitHub signed out asks:
   * offered while one is, and where a pull request read as no one needs an account while those
   * listed are all signed out.
   */
  signInAgain: {
    label: 'Sign in again',
    control: 'Sign in again on a signed-out account’s row of Settings › Accounts',
    group: 'App',
    keys: [],
  },
  /**
   * Opens the dialog for signing out: it asks which account when Lo has several, and what signing
   * out does either way.
   */
  signOut: {
    label: 'Sign out…',
    control: 'Sign out… on each account’s row of Settings › Accounts',
    group: 'App',
    keys: [],
  },
});
