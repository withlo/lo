// The welcome's first step: what Lo is for, under the mark as it unmelds, and getting an account,
// by signing in with GitHub or importing from GitHub CLI. A missing Git is said here too.

import { Button, Callout, Collapse, Key, LogoMotion, SetupDone } from '@lo/ui';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { importFromGh, signIn, useAccounts } from '../../accounts/window/shared.ts';
import { checkGit, goTo } from './actions.ts';
import { keyOf } from './labels.ts';
import { gitProblem, welcomeStore } from './store.ts';
import { Ticks } from './Ticks.tsx';

function PersonIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M3 13.5c.5-2.5 2.5-4 5-4s4.5 1.5 5 4" />
    </svg>
  );
}

function TerminalIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5 6 8l-3 3.5M8 12h5" />
    </svg>
  );
}

/** What Lo needs of Git and how to get it, when it can't find one it can run. */
function GitNotice() {
  const { git, checking, checkFailed, checks } = useStore(welcomeStore);
  if (!gitProblem(git)) return null;
  return (
    <Callout tone="warning">
      <div className="flex items-center gap-12">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span>
            <Ticks text={`${git.message} ${git.install}`} />
          </span>
          <Collapse open={checkFailed}>
            <span role="alert" className="text-danger">
              Couldn’t check for Git
            </span>
          </Collapse>
        </div>
        <Button size="sm" busy={checking} working="Checking…" onClick={() => void checkGit()}>
          Check again
        </Button>
      </div>
      {/* A look that found nothing new says what the notice says again, to a screen reader. */}
      <span key={checks} role="status" className="sr-only">
        {checks > 0 && !checking && !checkFailed ? git.message : ''}
      </span>
    </Callout>
  );
}

/** Who is signed in, said where the sign-in button was. */
function signedInAs(logins: readonly string[]): ReactNode {
  const [first] = logins;
  if (logins.length > 1) return `Signed in to ${logins.length} accounts`;
  return (
    <>
      Signed in as <strong className="font-semibold text-fg">{first}</strong>
    </>
  );
}

export function AccountStep({ shown }: { shown: boolean }): ReactNode {
  const accounts = useAccounts();
  const gh = useStore(welcomeStore, (state) => state.gh);
  const logins = (accounts ?? [])
    .filter((account) => account.signedOut === null)
    .map((account) => account.login);
  const key = keyOf('welcome.continue');
  // GitHub CLI is there but has no account to import: the button says why it's dimmed.
  const nothing = gh?.kind === 'found' && gh.accounts.length === 0;
  return (
    <>
      <LogoMotion play="unmeld" className="size-mark-lg" decorative />
      <div className="flex flex-col gap-8">
        <h1 className="m-0 text-balance text-display">Review pull requests from the keyboard</h1>
        <p className="m-0 text-fg-muted read-lead">Every action has a key.</p>
      </div>
      <div className="flex min-h-control-h flex-wrap items-center gap-8">
        {logins.length > 0 ? (
          <SetupDone size="md">{signedInAs(logins)}</SetupDone>
        ) : (
          <>
            {/* The step's main button only while the step is the one on screen. */}
            <Button
              variant="primary"
              {...(shown ? { 'data-welcome-default': true } : {})}
              data-welcome-focus
              onClick={signIn}
            >
              <PersonIcon />
              Sign in with GitHub…
              {key && <Key keys={key} decorative className="text-on-accent" />}
            </Button>
            {gh?.kind === 'found' && (
              <Button
                disabled={nothing}
                hint={nothing ? 'GitHub CLI isn’t signed in' : null}
                onClick={importFromGh}
              >
                <TerminalIcon />
                Import from GitHub CLI
              </Button>
            )}
            <Button variant="ghost" onClick={() => goTo('open')}>
              Open public pull request…
            </Button>
          </>
        )}
      </div>
      <GitNotice />
    </>
  );
}
