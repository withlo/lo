// The accounts as the window knows them, what main last said, and the one dialog of the feature's
// that's open, if any. Only the accounts feature writes here; other features read the accounts and
// open the dialogs through `shared.ts`.

import { createStore } from 'zustand/vanilla';

import type { AccountSummary, SignInState } from '../contract.ts';

/** A question for the account picker: which account opens a pull request of `owner/name`. */
export interface AccountQuestion {
  readonly owner: string;
  readonly name: string;
  /** The pull request being opened, if one is. */
  readonly number?: number | undefined;
  /** The accounts that can see the repository, any of which can open it. */
  readonly logins: readonly string[];
  /**
   * What the choice is remembered for when the person keeps the switch on: every repository of
   * the owner, or this one alone, when the owner's repositories open with another account.
   */
  readonly remember: 'owner' | 'repo';
}

/** What the sign-in dialog says besides how the sign-in goes: that the code was copied, say. */
export interface SignInNote {
  readonly tone: 'info' | 'danger';
  readonly text: string;
}

/** The sign-in dialog: how the sign-in is going, once main has said, and what else it says. */
export interface SignInDialog {
  readonly kind: 'signIn';
  /** Which opening of the dialog it is, so an answer for an earlier one is told apart. */
  readonly attempt: number;
  readonly state: SignInState | undefined;
  /** Why main couldn't be asked to sign in at all. */
  readonly error?: string | undefined;
  readonly note?: SignInNote | undefined;
}

/** The dialog open. Lo never stacks two. */
export type OpenDialog =
  | SignInDialog
  | { readonly kind: 'import' }
  | {
      readonly kind: 'pick';
      readonly question: AccountQuestion;
      /** Answers whoever asked: the account chosen, or nothing when the picker was cancelled. */
      readonly answer: (login: string | undefined) => void;
    };

export interface AccountsState {
  /** Every account, oldest first: undefined only until main first says. */
  readonly accounts: readonly AccountSummary[] | undefined;
  readonly dialog: OpenDialog | undefined;
}

export const accountsStore = createStore<AccountsState>()(() => ({
  accounts: undefined,
  dialog: undefined,
}));

/** Shows the accounts main sent. */
export function showAccounts(accounts: readonly AccountSummary[]): void {
  accountsStore.setState({ accounts });
}
