// The sign-in dialog: GitHub's device flow, from the code to type on GitHub's page to the account
// it signed in, or why it didn't and what to do about it.

import { Button, Callout, Dialog, DialogSpacer, Key, Spinner } from '@lo/ui';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import type { SignInFailure, SignInState } from '../contract.ts';
import { closeDialog, copyCode, openGithub, openSignIn } from './dialogs.ts';
import { keyOf, labels } from './labels.ts';
import type { SignInDialog } from './store.ts';

/** What each of Lo's scopes lets it do, as the sign-in lists them. */
const SCOPES: readonly (readonly [string, string])[] = [
  ['repo', 'Read and review private repos, and merge'],
  ['read:org', 'Team review requests and code owner teams'],
  ['workflow', 'Merging PRs that change .github/workflows'],
];

/** Each failure's title. */
const FAILED: Readonly<Record<SignInFailure, string>> = {
  noKeyring: "Lo can't keep your token safely",
  expired: 'The code expired',
  denied: 'The sign-in was cancelled on GitHub',
  refused: 'GitHub refused the sign-in',
  missingScopes: "The token can't do what Lo needs",
  offline: "Lo couldn't reach GitHub",
  failed: "Lo couldn't sign you in",
};

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

/** `ms` as minutes and seconds: `14:12`. */
function minutes(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The sign-in dialog, open while `dialog` is the dialog open. */
export function SignInView({
  dialog,
  container,
}: {
  dialog: SignInDialog | undefined;
  container: HTMLElement | null;
}) {
  const state = dialog?.state;
  const primary = useRef<HTMLButtonElement>(null);
  // Focus follows the main button as the dialog changes from one step to the next.
  useEffect(() => {
    primary.current?.focus();
  }, [state?.kind, dialog?.error]);
  const content = dialog === undefined ? undefined : view(dialog, primary);
  return (
    <Dialog
      open={dialog !== undefined}
      onOpenChange={(open) => {
        if (!open) closeDialog();
      }}
      title={content?.title ?? 'Sign in with GitHub'}
      description={content?.description}
      foot={content?.foot}
      initialFocus={primary}
      container={container}
      testId="sign-in"
    >
      {content?.body}
    </Dialog>
  );
}

interface Shown {
  title: string;
  description?: ReactNode;
  body: ReactNode;
  foot: ReactNode;
}

/** The dialog's title, body and foot for where the sign-in is. */
function view(dialog: SignInDialog, primary: RefObject<HTMLButtonElement | null>): Shown {
  const { state, error } = dialog;
  const cancel = (
    <Button onClick={closeDialog}>
      Cancel
      <Key keys={labels('esc')} decorative />
    </Button>
  );
  if (error !== undefined) return failure("Lo couldn't sign you in", error, 'failed', primary);
  if (state === undefined) {
    return {
      title: 'Sign in with GitHub',
      body: <Waiting>Asking GitHub for a code…</Waiting>,
      foot: (
        <>
          <DialogSpacer />
          {cancel}
        </>
      ),
    };
  }
  switch (state.kind) {
    case 'waiting':
      return {
        title: 'Sign in with GitHub',
        description: `Enter this code at ${state.page}`,
        body: <Code state={state} note={dialog.note} primary={primary} />,
        foot: (
          <>
            <span>Lo never sees your password.</span>
            <DialogSpacer />
            {cancel}
          </>
        ),
      };
    case 'checking':
      return {
        title: 'Sign in with GitHub',
        body: <Waiting>GitHub approved Lo. Checking your account…</Waiting>,
        foot: (
          <>
            <DialogSpacer />
            {cancel}
          </>
        ),
      };
    case 'signedIn':
      return {
        title: `Signed in as ${state.login}`,
        body: (
          <p className="m-0">
            Lo is signed in to GitHub as <strong className="font-semibold">{state.login}</strong>
            {state.name === null ? '' : ` (${state.name})`}. Its token is kept in your system's
            keychain.
          </p>
        ),
        foot: (
          <>
            <DialogSpacer />
            <Button ref={primary} variant="primary" onClick={closeDialog}>
              Done
              <Key keys={labels('enter')} decorative className="text-on-accent" />
            </Button>
          </>
        ),
      };
    case 'failed':
      return failure(FAILED[state.why], state.message, state.why, primary);
    case 'cancelled':
      return failure("Lo couldn't sign you in", 'The sign-in stopped.', 'failed', primary);
    default:
      throw new Error(`A sign-in state Lo doesn't know: ${JSON.stringify(state satisfies never)}`);
  }
}

/**
 * Why the sign-in ended without an account, and the way on: with no keyring, quitting to start Lo
 * again once one answers; otherwise, trying again.
 */
function failure(
  title: string,
  message: string,
  why: SignInFailure,
  primary: RefObject<HTMLButtonElement | null>,
): Shown {
  const close = (
    <Button onClick={closeDialog}>
      Close
      <Key keys={labels('esc')} decorative />
    </Button>
  );
  if (why === 'noKeyring') {
    return {
      title,
      body: (
        <>
          <Callout tone="danger" role="alert">
            {message}
          </Callout>
          <p className="m-0 text-fg-muted text-small">
            Without a keyring, your token would be kept where any program could read it, so Lo
            doesn't sign in.
          </p>
        </>
      ),
      foot: (
        <>
          <DialogSpacer />
          {close}
          <Button
            ref={primary}
            variant="primary"
            onClick={() => {
              client(app)
                .quit()
                .catch((error: unknown) => console.error("Lo couldn't quit:", error));
            }}
          >
            Quit Lo
            <Key keys={labels('enter')} decorative className="text-on-accent" />
          </Button>
        </>
      ),
    };
  }
  return {
    title,
    body: (
      <Callout tone="danger" role="alert">
        {message}
      </Callout>
    ),
    foot: (
      <>
        <DialogSpacer />
        {close}
        <Button ref={primary} variant="primary" onClick={openSignIn}>
          Try again
          <Key keys={labels('enter')} decorative className="text-on-accent" />
        </Button>
      </>
    ),
  };
}

function Waiting({ children }: { children: ReactNode }) {
  return (
    <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
      <Spinner />
      {children}
    </div>
  );
}

/** The code to type on GitHub, how to get there, how long it lasts and what Lo asks for. */
function Code({
  state,
  note,
  primary,
}: {
  state: Extract<SignInState, { kind: 'waiting' }>;
  note: SignInDialog['note'];
  primary: RefObject<HTMLButtonElement | null>;
}) {
  const now = useNow(true);
  const copy = keyOf('accounts.copyCode');
  const left = state.expiresAt - now;
  return (
    <>
      <div
        aria-label={`Code ${state.userCode.split('').join(' ')}`}
        role="img"
        className="flex items-center justify-center rounded-md border border-border bg-bg-well px-16 py-16 device-code text-fg select-all"
      >
        {state.userCode}
      </div>
      <div className="flex gap-8">
        <div className="flex flex-1 flex-col">
          <Button
            ref={primary}
            variant="primary"
            aria-keyshortcuts="Enter"
            onClick={() => void openGithub()}
          >
            Copy and open GitHub
            <Key keys={labels('enter')} decorative className="text-on-accent" />
          </Button>
        </div>
        <Button onClick={() => void copyCode()}>
          Copy
          {copy !== undefined && <Key keys={copy} decorative />}
        </Button>
      </div>
      <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
        {left > 0 ? (
          <>
            <Spinner />
            <span>
              Waiting for you to approve. The code expires in{' '}
              <span className="lo-num">{minutes(left)}</span>.
            </span>
          </>
        ) : (
          <span>The code has expired.</span>
        )}
      </div>
      {note !== undefined &&
        (note.tone === 'danger' ? (
          <Callout tone="danger" role="alert">
            {note.text}
          </Callout>
        ) : (
          <p className="m-0 text-fg-muted text-small">{note.text}</p>
        ))}
      <div className="border-t border-border-subtle" />
      <dl className="m-0 flex flex-col gap-6 text-fg-muted text-small">
        {SCOPES.map(([scope, what]) => (
          <div key={scope} className="flex gap-12">
            <dt className="w-64 flex-none text-fg code-small">{scope}</dt>
            <dd className="m-0">{what}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}
