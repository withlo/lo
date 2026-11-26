// The welcome's first step: what Lo is for, under the mark as it unmelds, and getting an account,
// by signing in with GitHub or importing from GitHub CLI. A missing Git is said here too.

import {
  Button,
  Callout,
  Collapse,
  CopyButton,
  Icon,
  Key,
  LogoMotion,
  Mark,
  Problem,
  SetupDone,
  useCopy,
  useDetails,
} from '@lo/ui';
import type { ReactNode } from 'react';
import { useStore } from 'zustand';

import { gitWords } from '../../../window/explain.ts';
import { importFromGh, signIn, useAccounts } from '../../accounts/window/shared.ts';
import { checkGit, goTo } from './actions.ts';
import { keyOf } from './labels.ts';
import { usePlayOnce } from './played.ts';
import { gitProblem, welcomeStore } from './store.ts';

/** Looks for Git again. */
function look(): void {
  void checkGit();
}

/** A command to run, as code, with Copy. */
function Command({ command }: { command: string }) {
  const copy = useCopy();
  return (
    <div className="flex items-center gap-8 rounded-sm bg-bg-well py-6 ps-8 pe-6 text-fg inset-ring inset-ring-border">
      <code className="min-w-0 flex-1 break-all code-small select-text">{command}</code>
      <CopyButton size="sm" onCopy={() => copy(command)} />
    </div>
  );
}

/**
 * What Lo needs of Git and how to get it, when it can't find one it can run, as the guide's Error:
 * the title on the line with "Check again", the reason under it, the commands that install one,
 * each with Copy, and Git's path behind Details, in room the step already holds, so the mark and
 * the foot stay where they are. A look that failed says so under it, with main's words behind
 * Details, and "Check again" looks once more.
 */
function GitNotice() {
  const { git, checking, checkFailed, checks } = useStore(welcomeStore);
  const words = gitProblem(git) ? gitWords(git) : undefined;
  const { more, shown } = useDetails(words?.details);
  if (words === undefined) return null;
  return (
    <div className="flex flex-col gap-8">
      <Callout tone="warning">
        <div className="flex flex-col gap-2">
          <div className="flex items-start gap-12">
            <p className="m-0 min-w-0 flex-1 font-semibold text-fg">{words.title}</p>
            {/* On the first line, and no taller than it, so the box is as deep under its words
                as over them. */}
            <div className="flex h-1lh flex-none items-center gap-4">
              {more}
              <Button size="sm" busy={checking} working="Checking…" onClick={look}>
                Check again
              </Button>
            </div>
          </div>
          {words.reason !== undefined && <p className="m-0 text-fg-muted">{words.reason}</p>}
          <div className="mt-6 flex flex-col gap-4">
            {words.commands.map((command) => (
              <Command key={command} command={command} />
            ))}
          </div>
          {/* Lo opens no page off GitHub, so the page is shown to copy. */}
          {words.page !== undefined && <Command command={words.page} />}
          {shown}
        </div>
      </Callout>
      <Collapse open={checkFailed !== undefined}>
        {checkFailed !== undefined && (
          <Problem title="Couldn’t check for Git" details={checkFailed} />
        )}
      </Collapse>
      {/* A look that found nothing new says what the notice says again, to a screen reader. */}
      <span key={checks} role="status" className="sr-only">
        {checks > 0 && !checking && checkFailed === undefined ? words.title : ''}
      </span>
    </div>
  );
}

/** Who is signed in, said where the sign-in button was. */
function signedInAs(logins: readonly string[]): ReactNode {
  const [first] = logins;
  if (logins.length > 1) return `Signed in to ${logins.length} accounts`;
  return `Signed in as ${first ?? ''}`;
}

export function AccountStep({ shown }: { shown: boolean }): ReactNode {
  const accounts = useAccounts();
  const gh = useStore(welcomeStore, (state) => state.gh);
  const logins = (accounts ?? [])
    .filter((account) => account.signedOut === null)
    .map((account) => account.login);
  const key = keyOf('welcome.continue');
  const unmeld = usePlayOnce('unmeld', shown);
  // GitHub CLI is there but has no account to import: the button says why it's dimmed.
  const nothing = gh?.kind === 'found' && gh.accounts.length === 0;
  return (
    <>
      {/* It unmelds as the welcome opens, and rests when the reader comes back to this step. */}
      {unmeld ? (
        <LogoMotion play="unmeld" className="size-mark-lg" decorative />
      ) : (
        <span className="flex" aria-hidden="true">
          <Mark className="size-mark-lg" />
        </span>
      )}
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
              <Icon name="user-round" size={14} />
              Sign in with GitHub…
              {key && <Key keys={key} decorative className="text-on-accent" />}
            </Button>
            {gh?.kind === 'found' && (
              <Button
                disabled={nothing}
                hint={nothing ? 'GitHub CLI isn’t signed in' : null}
                onClick={importFromGh}
              >
                <Icon name="terminal" size={14} />
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
