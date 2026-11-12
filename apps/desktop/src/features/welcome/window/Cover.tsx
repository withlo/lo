// The welcome screen, over the Recent tab while no account is signed in: what Lo is, how to sign in
// or import accounts from gh, a box to review a public pull request, the optional steps, and a
// notice when Lo can't find git. It is a form like Settings, so `Tab` walks its controls.

import { Button, Callout, Input, Key, Mark, SetupList, Spinner } from '@lo/ui';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useStore } from 'zustand';

import { focusMiddle, setMiddle, useKeys } from '../../../window/commands/registry.ts';
import { Slot, useViews } from '../../../window/slots.tsx';
import { importFromGh, signIn, useAccounts } from '../../accounts/window/shared.ts';
import type { GhListing } from '../../accounts/contract.ts';
import type { Tab } from '../../tab/window/shared.ts';
import { checkGit, loadGh, openPublic, setScreen } from './actions.ts';
import { keyOf } from './labels.ts';
import { setup } from './shared.ts';
import { gitProblem, welcomeStore } from './store.ts';
import { Ticks } from './Ticks.tsx';

/** What gh has, in a line under the sign-in: its version and how many accounts it's signed in to. */
function ghNote(listing: Extract<GhListing, { kind: 'found' }>): string {
  const gh = listing.version === null ? 'gh' : `gh ${listing.version}`;
  const { length } = listing.accounts;
  if (length === 0) return `${gh} isn't signed in to an account`;
  return `${gh} is signed in to ${length} ${length === 1 ? 'account' : 'accounts'}`;
}

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

/** The box to review a public pull request without signing in. */
function OpenField() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const why = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy || text.trim() === '') return;
    setBusy(true);
    setProblem(undefined);
    openPublic(text).then(
      (refused) => {
        setBusy(false);
        setProblem(refused);
        if (refused === undefined) setText('');
      },
      (error: unknown) => {
        console.error("Lo couldn't open the link:", error);
        setBusy(false);
        setProblem("Lo couldn't open the link.");
      },
    );
  };

  return (
    <form className="flex flex-col gap-6" onSubmit={submit}>
      <div className="flex gap-8">
        <Input
          mono
          aria-label="Pull request link"
          aria-describedby={problem === undefined ? undefined : why}
          placeholder="https://github.com/owner/repo/pull/123"
          value={text}
          invalid={problem !== undefined}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(undefined);
          }}
        />
        <Button type="submit" disabled={busy || text.trim() === ''}>
          Open
        </Button>
      </div>
      {problem !== undefined && (
        <p id={why} role="alert" className="m-0 text-danger text-small">
          {problem}
        </p>
      )}
    </form>
  );
}

/** The optional steps, while any feature has put one in the slot. */
function Steps() {
  const steps = useViews(setup);
  if (steps.length === 0) return null;
  return (
    <section className="flex flex-col gap-8" aria-label="Set up, if you like">
      <h2 className="m-0 text-fg-muted text-label" aria-hidden="true">
        Set up, if you like
      </h2>
      <SetupList label="Optional steps">
        <Slot slot={setup} props={{}} />
      </SetupList>
    </section>
  );
}

/** What Lo needs of git and how to get it, when it can't find one it can run. */
function GitNotice() {
  const { git, checking, checked } = useStore(welcomeStore);
  if (!gitProblem(git)) return null;
  return (
    <Callout tone="warning">
      <div className="flex items-center gap-12">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <span>
            <Ticks text={`${git.message} ${git.install}`} />
          </span>
          {checked && !checking && (
            <span role="status" className="text-fg-muted">
              Lo looked again and still can’t find a git it can use.
            </span>
          )}
        </div>
        <Button size="sm" disabled={checking} onClick={() => void checkGit()}>
          {checking && <Spinner size="xs" />}
          Check again
        </Button>
      </div>
    </Callout>
  );
}

/** Whether focus is nowhere in particular: on the window, or on the middle itself. */
function lost(): boolean {
  const now = document.activeElement;
  return !now || now === document.body || now.hasAttribute('data-lo-middle');
}

/**
 * Gives focus to the view the screen covered, once the screen is gone, if focus was on it. A dialog
 * over the screen, such as the sign-in that just signed in, keeps focus until it closes, so this
 * waits for that.
 */
function giveFocusBack(): void {
  if (document.querySelector('[data-lo-scope="dialog"]') === null) {
    if (lost()) focusMiddle();
    return;
  }
  const watch = new MutationObserver(() => {
    if (document.querySelector('[data-lo-scope="dialog"]') !== null) return;
    watch.disconnect();
    if (lost()) focusMiddle();
  });
  watch.observe(document.body, { childList: true, subtree: true });
}

/** The screen. It covers what's under it, so nothing there is reached by key or by reader. */
function Welcome(): ReactNode {
  useKeys();
  const root = useRef<HTMLDivElement>(null);
  const primary = useRef<HTMLButtonElement>(null);
  const gh = useStore(welcomeStore, (state) => state.gh);

  // Under the screen sits the Recent list, which takes focus and keys of its own: put it out of
  // reach while the screen is up.
  useLayoutEffect(() => {
    const screen = root.current;
    const under = screen?.parentElement;
    if (!screen || !under) return undefined;
    const covered = [...under.children].filter(
      (each) => each !== screen && !each.hasAttribute('inert'),
    );
    for (const each of covered) each.setAttribute('inert', '');
    setScreen(screen);
    welcomeStore.setState({ shown: true });
    return () => {
      for (const each of covered) each.removeAttribute('inert');
      setScreen(undefined);
      welcomeStore.setState({ shown: false });
    };
  }, []);

  useEffect(() => {
    // Focus starts on the default action, unless it's somewhere that matters already.
    if (lost()) primary.current?.focus();
    const takeBack = setMiddle({ focus: () => primary.current?.focus(), here: () => undefined });
    void loadGh();
    return () => {
      takeBack();
      giveFocusBack();
    };
  }, []);

  const key = keyOf('welcome.signIn');
  return (
    <div
      ref={root}
      tabIndex={-1}
      data-lo-scope="welcome"
      data-lo-tab="browser"
      className="absolute inset-0 flex overflow-auto bg-bg px-24 py-40 focus-visible:shadow-none"
    >
      <div className="m-auto flex w-palette-w max-w-full flex-col gap-24">
        <Mark className="size-48" />
        <div className="flex flex-col gap-8">
          <h1 className="m-0 text-balance text-display">Review pull requests from the keyboard.</h1>
          <p className="m-0 text-fg-muted read-lead">
            Lo reads whole stacks, shows the overviews your coding agent writes, and has a key for
            every action.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-12">
          <Button ref={primary} variant="primary" data-welcome-default onClick={signIn}>
            <PersonIcon />
            Sign in with GitHub
            {key && <Key keys={key} decorative className="text-on-accent" />}
          </Button>
          {gh?.kind === 'found' && (
            <>
              <Button onClick={importFromGh}>
                <TerminalIcon />
                Import from gh
              </Button>
              <span className="text-fg-muted text-small">{ghNote(gh)}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-12 text-fg-muted text-small">
          <span className="h-0 flex-1 border-t border-border" aria-hidden="true" />
          or review a public pull request without signing in
          <span className="h-0 flex-1 border-t border-border" aria-hidden="true" />
        </div>
        <OpenField />
        <Steps />
        <GitNotice />
      </div>
    </div>
  );
}

/**
 * The welcome screen, for the Recent tab while no account is signed in: none is, or every one
 * GitHub refused. Other tabs, a pull request opened without signing in and Settings among them,
 * are drawn as they are.
 */
export function Cover({ tab }: { tab: Tab }): ReactNode {
  const accounts = useAccounts();
  if (tab.kind !== 'recent' || accounts === undefined) return null;
  return accounts.some((account) => account.signedOut === null) ? null : <Welcome />;
}
