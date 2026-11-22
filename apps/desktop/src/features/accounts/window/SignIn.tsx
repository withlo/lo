// The sign-in dialog: GitHub's device flow, from the code to type on GitHub's page to the account
// it signed in, or why it didn't and what to do about it.
//
// It's the example of a dialog that does something. Its body is the same from asking to done: the
// code's box, one line that says where the sign-in is, and what the sign-in asks GitHub for. Only
// the foot changes, so nothing jumps: the main button is dimmed until there's a code, busy while
// the account is checked, and "Done" once it's signed in. What went wrong shows once, above the
// foot, with GitHub's own words behind Details.
//
// Each wait shows once, where it is: the code's box holds a skeleton until there's a code, the line
// says the sign-in waits for GitHub's page, and the button is busy while the account is checked.
// No line says a wait that the box or the button already shows.

import {
  CopyButton,
  Dialog,
  Key,
  Problem,
  Skeleton,
  Spinner,
  Swap,
  type DialogAction,
  type DialogProps,
  type DialogState,
} from '@lo/ui';
import { Fragment, useEffect, useState, type KeyboardEvent, type ReactNode } from 'react';

import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import type { SignInFailure } from '../contract.ts';
import { closeDialog, copyCode, openGithub, openSignIn } from './dialogs.ts';
import { enterOffControls } from './focus.ts';
import { keyOf, labels } from './labels.ts';
import type { SignInDialog } from './store.ts';

/** What the sign-in asks GitHub for, as GitHub's page names each, and what it's for. */
const SCOPES: readonly (readonly [string, ReactNode])[] = [
  ['repo', 'Read and review private repos, and merge'],
  ['read:org', 'Team review requests and code owner teams'],
  [
    'workflow',
    <>
      Merge pull requests that change <code className="code-small">.github/workflows</code>
    </>,
  ],
];

/** Marks the code's Copy button, for its key to press. */
const COPY = 'data-lo-copy-code';

/**
 * Presses the dialog's Copy button, as its key does. The button says how it went itself, in the
 * dialog, where a reader looks and a screen reader listens: a toast outside an open dialog is
 * heard by nobody.
 */
export function pressCopyCode(): void {
  document.querySelector<HTMLButtonElement>(`[${COPY}] button`)?.click();
}

/** Why each failure ended the sign-in, in a sentence. The ones with none have only their details. */
function reasonOf(why: SignInFailure | 'cancelled'): string | undefined {
  switch (why) {
    case 'noKeyring':
      return registry().system === 'mac'
        ? 'Sign-ins are kept in the Keychain, and it isn’t available.'
        : 'Sign-ins are kept in the keyring, and none is running.';
    case 'expired':
      return 'The code expired.';
    case 'denied':
      return 'The sign-in was cancelled on GitHub.';
    case 'refused':
      return 'GitHub returned an error.';
    case 'missingScopes':
      return 'GitHub granted less access than the sign-in asked for.';
    case 'offline':
      return 'Offline.';
    case 'cancelled':
      return 'The sign-in was stopped.';
    case 'failed':
      return undefined;
    default:
      throw new Error(`A sign-in failure Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/** Milliseconds since the Unix epoch, now, again each second while `on`. */
function useNow(on: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!on) return undefined;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [on]);
  return now;
}

/** How far ahead `ms` is, in its largest whole unit: `14 min`, `40 s`. */
function ahead(ms: number): string {
  const seconds = Math.max(1, Math.ceil(ms / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`;
}

function quit(): void {
  client(app)
    .quit()
    .catch((error: unknown) => console.error("Lo couldn't quit:", error));
}

/** Where the sign-in is: the dialog's state, its main button, and what went wrong, if it did. */
interface Step {
  state: DialogState;
  action: DialogAction;
  problem?: DialogProps['problem'];
}

/** A sign-in that ended without an account: why, and the main button as the way on. */
function failed(why: SignInFailure | 'cancelled', details: string | undefined): Step {
  const way: Pick<DialogAction, 'again' | 'onRun'> =
    why === 'noKeyring'
      ? // Lo looks for one as it starts, so it's started again once one answers.
        { again: 'Quit Lo', onRun: quit }
      : why === 'missingScopes'
        ? { again: 'Sign in again', onRun: openSignIn }
        : { onRun: openSignIn };
  return {
    state: 'failed',
    action: { label: 'Copy and open GitHub', keys: labels('enter'), ...way },
    problem: { title: 'Couldn’t sign in', reason: reasonOf(why), details },
  };
}

function stepOf(dialog: SignInDialog): Step {
  const { state, error } = dialog;
  const action: DialogAction = {
    label: 'Copy and open GitHub',
    working: 'Checking…',
    keys: labels('enter'),
    onRun: () => void openGithub(),
  };
  if (error !== undefined) return failed('failed', error);
  // Nothing is sent that `Esc` can't stop, so it's still asking: the button waits for the code.
  if (state === undefined) return { state: 'ask', action: { ...action, disabled: 'Getting code' } };
  switch (state.kind) {
    case 'waiting':
      return { state: 'ask', action };
    case 'checking':
      return { state: 'working', action };
    case 'signedIn':
      return { state: 'done', action };
    case 'failed':
      return failed(state.why, state.message);
    case 'cancelled':
      return failed('cancelled', undefined);
    default:
      throw new Error(`A sign-in state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/** The sign-in dialog, open while `dialog` is the dialog open. */
export function SignInView({
  dialog,
  container,
}: {
  dialog: SignInDialog | undefined;
  container: HTMLElement | null;
}) {
  const step = dialog === undefined ? undefined : stepOf(dialog);
  // `⏎` presses the main button wherever focus is in the dialog but on a control of its own: a
  // click on its text, coming back from GitHub's page, takes focus off the button.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!enterOffControls(event) || step === undefined) return;
    event.preventDefault();
    if (step.state === 'done') closeDialog();
    else if (step.state !== 'working' && step.action.disabled === undefined) step.action.onRun();
  };
  const page = dialog?.code?.page;
  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title="Sign in with GitHub"
      description={page === undefined ? 'Enter this code on GitHub' : `Enter this code at ${page}`}
      state={step?.state}
      action={step?.action}
      problem={step?.problem}
      leaveKeys={labels('esc')}
      onKeyDown={onKeyDown}
      container={container}
      testId="sign-in"
    >
      {dialog !== undefined && <Body dialog={dialog} />}
    </Dialog>
  );
}

/** The dialog's body, the same at every step: the code, where the sign-in is, what it asks for. */
function Body({ dialog }: { dialog: SignInDialog }) {
  const { state, code, unopened, error } = dialog;
  const copy = keyOf('accounts.copyCode');
  const waiting = state?.kind === 'waiting';
  // The code is of no more use once the sign-in ended without an account.
  const ended = error !== undefined || state?.kind === 'failed' || state?.kind === 'cancelled';
  const shown = ended ? undefined : code?.userCode;
  return (
    <>
      <div
        className="flex items-center gap-8 rounded-md border border-border bg-bg-well py-12 ps-16 pe-12"
        // The skeleton in it is how the wait for a code shows, and this is how it's heard.
        aria-busy={shown === undefined && !ended ? true : undefined}
      >
        <Swap id={shown === undefined ? 'none' : 'code'} className="grid min-w-0 flex-1">
          {/* The room a code takes, before there's one and after it's gone. */}
          <span aria-hidden="true" className="invisible col-start-1 row-start-1 device-code">
            XXXX-XXXX
          </span>
          {shown !== undefined ? (
            <span
              role="img"
              aria-label={`Code ${shown.split('').join(' ')}`}
              className={
                waiting
                  ? 'col-start-1 row-start-1 device-code text-fg select-all'
                  : 'col-start-1 row-start-1 device-code text-fg-muted select-all'
              }
            >
              {shown}
            </span>
          ) : (
            !ended && (
              <span className="col-start-1 row-start-1 flex items-center">
                <Skeleton className="w-1/2" />
              </span>
            )
          )}
        </Swap>
        {/* Its room is kept while there's nothing to copy. */}
        <span className={waiting ? 'flex-none' : 'invisible flex-none'} {...{ [COPY]: '' }}>
          <CopyButton variant="secondary" onCopy={copyCode}>
            Copy
            {copy !== undefined && <Key keys={copy} decorative />}
          </CopyButton>
        </span>
      </div>
      <Status dialog={dialog} />
      {waiting && unopened !== undefined && (
        <Problem title="Couldn’t open GitHub" details={unopened} />
      )}
      <div className="border-t border-border-subtle" />
      <dl className="m-0 facts text-fg-muted text-small">
        {SCOPES.map(([scope, what]) => (
          <Fragment key={scope}>
            <dt className="text-fg code-small">{scope}</dt>
            <dd className="m-0">{what}</dd>
          </Fragment>
        ))}
      </dl>
    </>
  );
}

/**
 * The one line that says where the sign-in is. Its room stays when there's nothing to say. How
 * long the code has left sits beside what's announced, not in it: read out, it would repeat the
 * line each time it counts down.
 */
function Status({ dialog }: { dialog: SignInDialog }) {
  const { state } = dialog;
  const now = useNow(state?.kind === 'waiting');
  const left = state?.kind === 'waiting' ? state.expiresAt - now : undefined;
  return (
    <div className="flex min-h-1lh items-center gap-8 text-fg-muted text-small">
      <div role="status" className="flex min-w-0 flex-1 items-center gap-8">
        {statusOf(dialog, left !== undefined && left <= 0)}
      </div>
      {left !== undefined && left > 0 && (
        <span className="lo-num flex-none">Code expires in {ahead(left)}</span>
      )}
    </div>
  );
}

function statusOf({ state, error }: SignInDialog, expired: boolean): ReactNode {
  // Before there's a code, its box waits as a skeleton, and that's the wait shown.
  if (error !== undefined || state === undefined) return null;
  switch (state.kind) {
    case 'waiting':
      return expired ? 'The code expired.' : <Wait>Waiting for approval…</Wait>;
    case 'checking':
      // The main button is busy, and says so.
      return null;
    case 'signedIn':
      return (
        <>
          <svg
            className="lo-i lo-i--sm flex-none text-success"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6.25" />
            <path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
          </svg>
          <span className="text-fg">
            Signed in as <strong className="font-semibold">{state.login}</strong>
            {state.name === null ? '' : ` (${state.name})`}
          </span>
        </>
      );
    case 'failed':
    case 'cancelled':
      return null;
    default:
      throw new Error(`A sign-in state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

function Wait({ children }: { children: ReactNode }) {
  return (
    <>
      <Spinner />
      <span>{children}</span>
    </>
  );
}
