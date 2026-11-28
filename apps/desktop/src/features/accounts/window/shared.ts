// What the accounts feature shares with other features' window code: the accounts as the window
// knows them, and its dialogs, to sign in or import from gh. No token ever reaches the window.

import { useStore } from 'zustand';

import type { AccountSummary } from '../contract.ts';
import { openImport, openSignIn } from './dialogs.ts';
import { accountsStore, signedInOf, type SignedIn } from './store.ts';

export type { AccountSummary } from '../contract.ts';
export type { SignedIn } from './store.ts';

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
 * How the accounts stand for what needs one, as {@link SignedIn} says. Re-renders as they change.
 */
export function useSignedIn(): SignedIn {
  return useStore(accountsStore, (state) => signedInOf(state.accounts));
}

/** What a state that needs an account asks for: its words, and the command its button runs. */
export interface SignInAsk {
  /** "Sign in to see threads", or "Add an account to see threads". */
  readonly title: string;
  readonly command: 'accounts.addAccount' | 'accounts.signInAgain';
}

/**
 * What a state that needs an account to show `what` asks for, as a pull request read as no one
 * does, with the accounts as they stand (`signed`). While one is signed in, it asks for another to
 * be added: "Add an account to see threads", with "Add account…". While none is, as the header's
 * "Not signed in" says, it asks to sign in, plainly: "Sign in to see threads", with "Sign in with
 * GitHub…", or "Sign in again" where those listed are all signed out.
 */
export function signInAsk(what: string, signed: SignedIn): SignInAsk {
  switch (signed) {
    case 'signedIn':
      return { title: `Add an account to ${what}`, command: 'accounts.addAccount' };
    case 'signedOut':
      return { title: `Sign in to ${what}`, command: 'accounts.signInAgain' };
    case 'none':
      return { title: `Sign in to ${what}`, command: 'accounts.addAccount' };
    default:
      throw new Error(
        `A standing of accounts Lo doesn’t know: ${JSON.stringify(signed satisfies never)}`,
      );
  }
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
