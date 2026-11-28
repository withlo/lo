// What the accounts feature shares with other features' window code: the accounts as the window
// knows them, and its dialogs, to sign in or import from gh. No token ever reaches the window.

import { useStore } from 'zustand';

import type { AccountSummary } from '../contract.ts';
import { openImport, openSignIn } from './dialogs.ts';
import { accountsStore } from './store.ts';

export type { AccountSummary } from '../contract.ts';

/** Every account, oldest first, once main has said, re-rendering when they change. */
export function useAccounts(): readonly AccountSummary[] | undefined {
  return useStore(accountsStore, (state) => state.accounts);
}

/**
 * Whether the window has heard all it will about the accounts for now: what they are, or that main
 * couldn't be asked, in which case `useAccounts` stays undefined until main next says.
 */
export function useAccountsHeard(): boolean {
  return useStore(accountsStore, (state) => state.accounts !== undefined || state.unlisted);
}

/**
 * Opens the sign-in dialog and starts signing in with GitHub, as the welcome screen's `⏎` does: to
 * add an account to those listed, where there are any, as `accounts.addAccount` does.
 */
export function signIn(): void {
  openSignIn();
}

/** Opens the sign-in dialog for signing in an account GitHub signed out, as "Sign in again" asks. */
export function signInAgain(): void {
  openSignIn({ adds: false });
}

/** Opens the dialog for importing accounts from `gh`. */
export function importFromGh(): void {
  openImport();
}
