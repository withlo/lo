// What the accounts feature shares with other features' window code: the accounts as the window
// knows them, and its dialogs, to sign in, import from gh or choose which account opens a pull
// request. No token ever reaches the window.

import { useStore } from 'zustand';

import type { AccountSummary } from '../contract.ts';
import { openImport, openSignIn, pickAccount } from './dialogs.ts';
import { accountsStore, type AccountQuestion } from './store.ts';

export type { AccountSummary } from '../contract.ts';
export type { AccountQuestion } from './store.ts';

/** Every account, oldest first, once main has said, re-rendering when they change. */
export function useAccounts(): readonly AccountSummary[] | undefined {
  return useStore(accountsStore, (state) => state.accounts);
}

/** Opens the sign-in dialog and starts signing in with GitHub, as the welcome screen's `⏎` does. */
export function signIn(): void {
  openSignIn();
}

/** Opens the dialog for importing accounts from `gh`. */
export function importFromGh(): void {
  openImport();
}

/**
 * Asks which account opens a pull request of a repository that several accounts can see,
 * remembering the answer if the person keeps the switch on. Resolves with the login chosen, or
 * nothing when the person cancelled.
 */
export function chooseAccount(question: AccountQuestion): Promise<string | undefined> {
  return pickAccount(question);
}
