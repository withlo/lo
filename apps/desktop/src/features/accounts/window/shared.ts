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
 * Whether signing in now adds an account: one is listed, signed in or not. Words that ask for a
 * sign-in then ask for an account to be added, as the command that does it is then named "Add
 * account…". Re-renders as the accounts change.
 */
export function useAdding(): boolean {
  return useStore(accountsStore, (state) => (state.accounts?.length ?? 0) > 0);
}

/**
 * How words that ask for an account say what it's for, as the command they lead to is named:
 * "Sign in to see threads", or, once one is listed (`adding`), "Add an account to see threads".
 */
export function signInTo(what: string, adding: boolean): string {
  return `${adding ? 'Add an account' : 'Sign in'} to ${what}`;
}

/**
 * Opens the sign-in dialog and starts signing in with GitHub, as `accounts.addAccount` does: to add
 * an account to those listed, where there are any, and saying so.
 */
export function addAccount(): void {
  openSignIn();
}

/**
 * Opens the sign-in dialog for a sign-in that says only that it signs in: the welcome screen's
 * "Sign in with GitHub…", which shows while no account is signed in.
 */
export function signIn(): void {
  openSignIn({ adds: false });
}

/** Opens the sign-in dialog for signing in an account GitHub signed out, as "Sign in again" asks. */
export function signInAgain(): void {
  openSignIn({ adds: false });
}

/** Opens the dialog for importing accounts from `gh`. */
export function importFromGh(): void {
  openImport();
}
