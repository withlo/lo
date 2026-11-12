// Opening and closing the feature's dialogs, one at a time: closing one stops what it was doing,
// so a sign-in polls GitHub no more once its dialog is gone.

import { IpcError } from '../../../ipc/contract.ts';
import type { SignInState } from '../contract.ts';
import { main } from './main.ts';
import {
  accountsStore,
  type AccountQuestion,
  type OpenDialog,
  type SignInDialog,
  type SignInNote,
} from './store.ts';

let attempts = 0;

/** The sign-in dialog, if it's the one open. */
export function signInDialog(): SignInDialog | undefined {
  const { dialog } = accountsStore.getState();
  return dialog?.kind === 'signIn' ? dialog : undefined;
}

function log(what: string): (error: unknown) => void {
  return (error) => console.error(`Lo couldn't ${what}:`, error);
}

/** Ends what `dialog` was doing once it's closed. */
function finish(dialog: OpenDialog): void {
  switch (dialog.kind) {
    case 'signIn': {
      const { state } = dialog;
      if (state !== undefined) main().cancelSignIn({ id: state.id }).catch(log('stop signing in'));
      break;
    }
    case 'pick':
      dialog.answer(undefined);
      break;
    case 'import':
    case 'signOut':
      break;
    default:
      throw new Error(`A dialog Lo doesn't know: ${JSON.stringify(dialog satisfies never)}`);
  }
}

/** Shows `next` in place of whatever dialog is open, which stops what it was doing. */
function show(next: OpenDialog | undefined): void {
  const { dialog } = accountsStore.getState();
  accountsStore.setState({ dialog: next });
  if (dialog !== undefined && dialog !== next) finish(dialog);
}

/** Closes the dialog open, if any: a sign-in stops, and a picker answers that none was chosen. */
export function closeDialog(): void {
  show(undefined);
}

/** Changes the sign-in dialog, if it's still the opening `attempt`. */
function updateSignIn(attempt: number, change: (dialog: SignInDialog) => SignInDialog): void {
  const dialog = signInDialog();
  if (dialog?.attempt === attempt) accountsStore.setState({ dialog: change(dialog) });
}

/**
 * Opens the sign-in dialog and starts signing in with GitHub's device flow, stopping any other
 * sign-in. Closing the dialog stops it.
 */
export function openSignIn(): void {
  const attempt = ++attempts;
  const opening: SignInDialog = { kind: 'signIn', attempt, state: undefined };
  show(opening);
  main()
    .signIn()
    .then(
      (state) => {
        if (signInDialog()?.attempt === attempt) {
          updateSignIn(attempt, (dialog) => ({ ...dialog, state: newer(dialog.state, state) }));
        } else if (state.kind === 'waiting') {
          // Closed while main asked GitHub: it stops, as if it had been open.
          main().cancelSignIn({ id: state.id }).catch(log('stop signing in'));
        }
      },
      (error: unknown) => {
        log('start signing in')(error);
        updateSignIn(attempt, (dialog) => ({
          ...dialog,
          error: error instanceof IpcError ? error.message : "Lo couldn't start signing in.",
        }));
      },
    );
}

/** Of `known` and `told`, the one to show: a sign-in that ended stays ended. */
function newer(known: SignInState | undefined, told: SignInState): SignInState {
  if (known === undefined || known.id !== told.id) return told;
  return known.kind === 'waiting' ? told : known;
}

/** Takes what main pushed about a sign-in, if it's the one the dialog shows. */
export function heardSignIn(state: SignInState): void {
  const dialog = signInDialog();
  if (dialog?.state?.id !== state.id) return;
  accountsStore.setState({ dialog: { ...dialog, state, note: undefined } });
}

/** The sign-in the dialog shows waiting for its code, if any. */
export function waitingSignIn(): Extract<SignInState, { kind: 'waiting' }> | undefined {
  const state = signInDialog()?.state;
  return state?.kind === 'waiting' ? state : undefined;
}

/** Copies the code the sign-in waits for, and says so in the dialog. */
export async function copyCode(): Promise<void> {
  const dialog = signInDialog();
  const waiting = waitingSignIn();
  if (dialog === undefined || waiting === undefined) return;
  const note = await main()
    .copyCode({ id: waiting.id })
    .then(
      (): SignInNote => ({ tone: 'info', text: `Copied ${waiting.userCode}.` }),
      (error: unknown): SignInNote => ({
        tone: 'danger',
        text: error instanceof IpcError ? error.message : "Lo couldn't copy the code.",
      }),
    );
  updateSignIn(dialog.attempt, (open) => ({ ...open, note }));
}

/** Copies the code and opens GitHub's page to enter it on. */
export async function openGithub(): Promise<void> {
  const dialog = signInDialog();
  const waiting = waitingSignIn();
  if (dialog === undefined || waiting === undefined) return;
  const note = await main()
    .openGithub({ id: waiting.id })
    .then(
      (): SignInNote => ({
        tone: 'info',
        text: `Copied ${waiting.userCode}. Paste it on GitHub's page, then approve Lo.`,
      }),
      (error: unknown): SignInNote => ({
        tone: 'danger',
        text: error instanceof IpcError ? error.message : "Lo couldn't open GitHub's page.",
      }),
    );
  updateSignIn(dialog.attempt, (open) => ({ ...open, note }));
}

/** Opens the dialog for importing accounts from `gh`. */
export function openImport(): void {
  show({ kind: 'import' });
}

/**
 * Opens the dialog for signing out of one of `logins`: it asks which when there are several, and
 * confirms what signing out does either way.
 */
export function openSignOut(logins: readonly string[]): void {
  show({ kind: 'signOut', logins });
}

/**
 * Asks which account opens a pull request of `question.owner/name`, remembering the answer when the
 * person leaves the switch on. Resolves with the login, or nothing when the picker was cancelled or
 * another dialog took its place.
 */
export function pickAccount(question: AccountQuestion): Promise<string | undefined> {
  return new Promise((resolve) => {
    show({ kind: 'pick', question, answer: resolve });
  });
}
