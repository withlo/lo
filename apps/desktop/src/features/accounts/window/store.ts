// The accounts as the window knows them, what main last said, and the one dialog of the feature's
// that's open, if any. Only the accounts feature writes here; other features read the accounts and
// open the dialogs through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import type { AccountSummary, SignInState } from '../contract.ts';

/** The sign-in dialog: how the sign-in is going, once main has said, and what else it says. */
export interface SignInDialog {
  readonly kind: 'signIn';
  /** Which opening of the dialog it is, so an answer for an earlier one is told apart. */
  readonly attempt: number;
  readonly state: SignInState | undefined;
  /** The code this sign-in waits for, or waited for, and GitHub's page for it. */
  readonly code?: { readonly userCode: string; readonly page: string } | undefined;
  /** Why main couldn't be asked to sign in at all. */
  readonly error?: string | undefined;
  /** What main said when it couldn't open GitHub's page, as it came. */
  readonly unopened?: string | undefined;
  /**
   * The accounts listed as it opened, when it adds one to them: it then says so, and whether the
   * account GitHub's page signed in is new. Not for signing in a given account, as "Sign in again"
   * does.
   */
  readonly adding?: readonly Listed[] | undefined;
}

/** The dialog open. Lo never stacks two. */
export type OpenDialog =
  | SignInDialog
  | { readonly kind: 'import' }
  /** Signing out: of the one account in `logins`, or of the one chosen from several. */
  | { readonly kind: 'signOut'; readonly logins: readonly string[] };

export interface AccountsState {
  /** Every account, oldest first: undefined only until main first says. */
  readonly accounts: readonly AccountSummary[] | undefined;
  /** Whether main couldn't be asked for them, so they're not known until it next says. */
  readonly unlisted: boolean;
  readonly dialog: OpenDialog | undefined;
}

export const accountsStore = createStore<AccountsState>()(() => ({
  accounts: undefined,
  unlisted: false,
  dialog: undefined,
}));

/** Shows the accounts main sent. */
export function showAccounts(accounts: readonly AccountSummary[]): void {
  accountsStore.setState({ accounts, unlisted: false });
}

/** An account listed: its login in lower case, and whether GitHub signed it out. */
export interface Listed {
  readonly login: string;
  readonly signedOut: boolean;
}

/**
 * The accounts listed, signed in or not. While there are some, a sign-in adds one to them, and
 * Settings, the palette and the sign-in dialog say "Add account".
 */
export function listedAccounts(): Listed[] {
  return (accountsStore.getState().accounts ?? []).map(({ login, signedOut }) => ({
    login: login.toLowerCase(),
    signedOut: signedOut !== null,
  }));
}

/** Main couldn't be asked for the accounts. */
export function unlistedAccounts(): void {
  accountsStore.setState({ unlisted: true });
}
