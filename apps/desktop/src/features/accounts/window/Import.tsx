// The dialog for importing accounts from GitHub CLI: which accounts it's signed in to, which of them
// to import, what each one's sign-in can't do, and how the import went. Lo copies the sign-ins; gh
// keeps its own.
//
// Its title is the command's from start to end, and its body stays put: the list, once GitHub CLI
// has said what it's signed in to, with what's being read or what went wrong in its place before.
// The main button is dimmed until an account is chosen, busy while they're imported, and the foot
// reads "Done" once they are. What stopped it shows above the foot, with GitHub CLI's own words
// behind Details.

import {
  Avatar,
  Button,
  Callout,
  CopyButton,
  Dialog,
  Problem,
  SetupDone,
  Spinner,
  Switch,
  useCopy,
  type DialogAction,
  type DialogProps,
  type DialogState,
} from '@lo/ui';
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { IpcError } from '../../../ipc/contract.ts';
import { registry } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { explain } from '../../../window/explain.ts';
import { contract as app } from '../../app/contract.ts';
import type { GhAccount, GhListing, ImportFailure, Imported } from '../contract.ts';
import { closeDialog, openSignIn } from './dialogs.ts';
import { labels } from './labels.ts';
import { main } from './main.ts';

type Found = Extract<GhListing, { kind: 'found' }>;
type Unlisted = Exclude<GhListing, Found>;

/** Where the import is. */
type Step =
  | { readonly kind: 'loading' }
  /** Lo can't keep a sign-in, so it imports nothing: main's words, for Details. */
  | { readonly kind: 'noKeyring'; readonly message: string }
  /** gh can't be found or run, or main couldn't be asked: what main said, if it did. */
  | { readonly kind: 'unlisted'; readonly listing: Unlisted | undefined }
  | { readonly kind: 'choosing'; readonly found: Found }
  | { readonly kind: 'importing'; readonly found: Found; readonly logins: readonly string[] }
  /** Main couldn't be asked to import `logins`, for `details`. */
  | {
      readonly kind: 'failed';
      readonly found: Found;
      readonly logins: readonly string[];
      readonly details: string;
    }
  | { readonly kind: 'done'; readonly found: Found; readonly results: readonly Imported[] };

/** The command that signs GitHub CLI in, to type in a terminal. */
const GH_LOGIN = 'gh auth login';

/** `n` of `what`, as a person writes it: "1 account", "2 accounts". */
function count(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

/** What gh's account can't do for want of a scope, and whether signing in with GitHub would. */
function lacking(account: GhAccount): { line: ReactNode; signIn: boolean } | undefined {
  if (!account.usable || account.missing.length === 0) return undefined;
  if (account.scopes.length === 0) {
    return { line: `${account.login}’s sign-in doesn’t say what it can do.`, signIn: false };
  }
  if (account.missing.length === 1 && account.missing[0] === 'workflow') {
    return {
      line: `${account.login}’s sign-in can’t merge pull requests that change workflows.`,
      signIn: true,
    };
  }
  return {
    line: (
      <>
        {account.login}’s sign-in lacks{' '}
        {account.missing.map((scope, index) => (
          <span key={scope}>
            {index > 0 && ', '}
            <code className="code-small">{scope}</code>
          </span>
        ))}
        .
      </>
    ),
    signIn: true,
  };
}

/** What to say about gh's account beside its login. */
function notes(account: GhAccount): ReactNode {
  const said: ReactNode[] = [account.scopes.length > 0 ? account.scopes.join(', ') : 'no scopes'];
  if (account.active) said.push('active in GitHub CLI');
  if (!account.usable) {
    said.push(
      <>
        status <code className="code-small">{account.state}</code>
      </>,
    );
  }
  if (account.shortLived) said.push('short-lived sign-in');
  if (account.inLo) said.push('already signed in · importing replaces its sign-in');
  return said.map((each, index) => (
    <span key={index}>
      {index > 0 && ' · '}
      {each}
    </span>
  ));
}

/** Why one account wasn't imported, as an error's reason and details. */
function failureWords(
  login: string,
  why: ImportFailure,
): { reason: string | undefined; details: string | undefined } {
  switch (why.kind) {
    case 'notSignedIn':
      return { reason: `GitHub CLI isn’t signed in to ${login}.`, details: undefined };
    case 'unusable':
      return { reason: `GitHub CLI can’t use ${login}’s sign-in.`, details: why.state };
    case 'otherAccount':
      return {
        reason: `GitHub CLI’s sign-in for ${login} belongs to ${why.other}.`,
        details: undefined,
      };
    case 'failed':
      return { reason: explain(why.cause), details: why.details };
    default:
      throw new Error(`An import failure Lo doesn't know: ${JSON.stringify(why satisfies never)}`);
  }
}

/**
 * Whether importing the account again could go another way: it failed for want of an answer, or
 * GitHub's error, not for what GitHub CLI holds.
 */
function canRetry(why: ImportFailure): boolean {
  return why.kind === 'failed';
}

/** Sign-ins are kept in the system's keychain, which isn't there, as this system says it. */
function keyringReason(): string {
  return registry().system === 'mac'
    ? 'Sign-ins are kept in the Keychain, and it isn’t available.'
    : 'Sign-ins are kept in the keyring, and none is running.';
}

function quit(): void {
  client(app)
    .quit()
    .catch((error: unknown) => console.error("Lo couldn't quit:", error));
}

function loginOf(account: GhAccount): string {
  return account.login;
}

/** The dialog for importing accounts from gh, open while `open` is. */
export function ImportView({ open, container }: { open: boolean; container: HTMLElement | null }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  // The accounts an import refused for a reason a second try can't change, and why: they can't be
  // chosen again until GitHub CLI has been read again.
  const [refused, setRefused] = useState<ReadonlyMap<string, ImportFailure>>(new Map());
  const opened = useRef(0);

  const load = () => {
    const turn = ++opened.current;
    setStep({ kind: 'loading' });
    setRefused(new Map());
    const api = main();
    Promise.all([api.keyring(), api.ghAccounts()]).then(
      ([problem, listing]) => {
        if (turn !== opened.current) return;
        if (problem !== null) {
          setStep({ kind: 'noKeyring', message: problem });
        } else if (listing.kind === 'found') {
          setChosen(
            new Set(listing.accounts.filter((each) => each.usable && !each.inLo).map(loginOf)),
          );
          setStep({ kind: 'choosing', found: listing });
        } else {
          setStep({ kind: 'unlisted', listing });
        }
      },
      (error: unknown) => {
        if (turn !== opened.current) return;
        console.error("Lo couldn't ask gh for its accounts:", error);
        setStep({ kind: 'unlisted', listing: undefined });
      },
    );
  };

  useEffect(() => {
    if (open) load();
    else opened.current += 1;
  }, [open]);

  /** Imports `logins` of what gh `found`: importing them again only replaces their sign-ins. */
  const importAll = (found: Found, logins: readonly string[]) => {
    if (logins.length === 0) return;
    const turn = opened.current;
    setStep({ kind: 'importing', found, logins });
    main()
      .importGh({ logins: [...logins] })
      .then(
        (results) => {
          if (turn !== opened.current) return;
          const failures = results.flatMap((result) => (result.ok ? [] : [result]));
          // Those refused for good stay refused, with why, through every try after: none of them
          // can be chosen again until GitHub CLI is read again.
          const forGood = failures.filter(({ why }) => !canRetry(why));
          if (forGood.length > 0) {
            setRefused(
              (was) => new Map([...was, ...forGood.map(({ login, why }) => [login, why] as const)]),
            );
            setChosen(
              (was) => new Set([...was].filter((login) => !forGood.some((f) => f.login === login))),
            );
          }
          // Nothing imported, and trying again would only hear the same: back to choosing, with
          // those accounts out of it and why in their place.
          if (failures.length === results.length && forGood.length === failures.length) {
            setStep({ kind: 'choosing', found });
            return;
          }
          setStep({ kind: 'done', found, results });
        },
        (error: unknown) => {
          if (turn !== opened.current) return;
          if (error instanceof IpcError && error.code === 'noKeyring') {
            setStep({ kind: 'noKeyring', message: error.message });
          } else {
            const details = error instanceof IpcError ? error.message : String(error);
            setStep({ kind: 'failed', found, logins, details });
          }
        },
      );
  };

  const importChosen = () => {
    if (step.kind !== 'choosing') return;
    importAll(
      step.found,
      step.found.accounts.map(loginOf).filter((login) => chosen.has(login)),
    );
  };

  // `⏎` on a switch imports, as the main button would; a switch turns with `Space`.
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const { target } = event;
    if (event.key !== 'Enter' || event.metaKey || event.ctrlKey || event.altKey) return;
    if (target instanceof Element && target.getAttribute('role') === 'switch') {
      event.preventDefault();
      importChosen();
    }
  };

  const shown = view(step, { chosen, refused, choose: setChosen, importChosen, importAll, load });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
      title="Import from GitHub CLI"
      description={shown.description}
      state={shown.state}
      action={shown.action}
      problem={shown.problem}
      leaveKeys={labels('esc')}
      stays="The import can’t be stopped"
      onKeyDown={onKeyDown}
      container={container}
      testId="import-gh"
    >
      {shown.body}
    </Dialog>
  );
}

interface Shown {
  description?: ReactNode;
  body: ReactNode;
  state: DialogState;
  action: DialogAction;
  problem?: DialogProps['problem'];
}

interface Doing {
  chosen: ReadonlySet<string>;
  /** Accounts an import refused for good, and why. */
  refused: ReadonlyMap<string, ImportFailure>;
  choose: (chosen: ReadonlySet<string>) => void;
  importChosen: () => void;
  importAll: (found: Found, logins: readonly string[]) => void;
  load: () => void;
}

/**
 * What stopped the listing, as an error: GitHub CLI isn't there to run, or it failed. Where the fix
 * is outside Lo, the button only looks again.
 */
function unlisted(listing: Unlisted | undefined): {
  problem: NonNullable<DialogProps['problem']>;
  again: string;
} {
  const reading = 'Can’t read GitHub CLI’s accounts';
  if (listing === undefined) return { problem: { title: reading }, again: 'Try again' };
  switch (listing.kind) {
    case 'missing':
      return { problem: { title: 'Can’t find GitHub CLI' }, again: 'Check again' };
    case 'distrusted':
      return {
        problem: { title: 'Can’t use GitHub CLI', details: listing.details },
        again: 'Check again',
      };
    case 'failed':
      break;
    default:
      throw new Error(`A listing Lo doesn't know: ${JSON.stringify(listing satisfies never)}`);
  }
  const { details } = listing;
  switch (listing.why) {
    case 'run':
      return { problem: { title: 'Can’t use GitHub CLI', details }, again: 'Check again' };
    case 'tooOld': {
      const version = listing.version === null ? '' : ` ${listing.version}`;
      return {
        problem: {
          title: `Can’t use GitHub CLI${version}`,
          reason: 'A newer version is required.',
          details,
        },
        again: 'Check again',
      };
    }
    case 'tooSlow':
      return {
        problem: { title: reading, reason: explain({ kind: 'tooSlow' }), details },
        again: 'Try again',
      };
    case 'other':
      return { problem: { title: reading, details }, again: 'Try again' };
    default:
      throw new Error(`A failure Lo doesn't know: ${JSON.stringify(listing.why satisfies never)}`);
  }
}

function view(step: Step, doing: Doing): Shown {
  const { chosen, refused, choose, importChosen, importAll, load } = doing;
  const importing: DialogAction = {
    label: 'Import',
    working: 'Importing…',
    keys: labels('enter'),
    onRun: importChosen,
  };
  switch (step.kind) {
    case 'loading':
      return {
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Reading accounts…
          </div>
        ),
        state: 'ask',
        action: { ...importing, disabled: 'Reading accounts' },
      };
    case 'noKeyring':
      return {
        body: null,
        state: 'failed',
        action: { ...importing, again: 'Quit Lo', onRun: quit },
        problem: { title: 'Can’t import accounts', reason: keyringReason(), details: step.message },
      };
    case 'unlisted': {
      const { problem, again } = unlisted(step.listing);
      return { body: null, state: 'failed', action: { ...importing, again, onRun: load }, problem };
    }
    case 'choosing':
    case 'importing':
    case 'failed':
    case 'done':
      break;
    default:
      throw new Error(`An import step Lo doesn't know: ${JSON.stringify(step satisfies never)}`);
  }

  const { found } = step;
  const { accounts } = found;
  const version = found.version === null ? '' : ` ${found.version}`;
  const description = `GitHub CLI${version} · ${count(accounts.length, 'account')}`;
  if (accounts.length === 0) {
    // What's wrong, then the command that fixes it, under its reason.
    return {
      description,
      body: (
        <>
          <Problem title="Can’t import accounts" reason="GitHub CLI isn’t signed in." />
          <SignInFirst />
        </>
      ),
      state: 'failed',
      action: { ...importing, again: 'Check again', onRun: load },
    };
  }

  const settled = step.kind === 'done' || step.kind === 'failed';
  const results = step.kind === 'done' ? step.results : [];
  const imported = results.filter((result) => result.ok).map(({ login }) => login);
  const failed = results.flatMap((result) => (result.ok ? [] : [result]));
  // Why an import refused an account for good, in its place from then on, except where this
  // import's own failure says it.
  const refusals = accounts.flatMap((account) => {
    const why = refused.get(account.login);
    if (why === undefined || failed.some(({ login }) => login === account.login)) return [];
    const { reason } = failureWords(account.login, why);
    return reason === undefined ? [] : [{ login: account.login, line: reason }];
  });
  // What the accounts chosen can't do stays while they're imported, so the body holds still.
  const warnings =
    step.kind === 'choosing' || step.kind === 'importing'
      ? accounts.flatMap((account) => {
          if (!chosen.has(account.login) || refused.has(account.login)) return [];
          const lack = lacking(account);
          return lack === undefined ? [] : [{ login: account.login, ...lack }];
        })
      : [];
  const body = (
    <>
      <div className="flex flex-col">
        <ul className="m-0 flex list-none flex-col p-0" aria-label="GitHub CLI’s accounts">
          {accounts.map((account, index) => (
            <li
              key={account.login}
              className={
                index === 0
                  ? 'flex items-center gap-12 py-8'
                  : 'flex items-center gap-12 border-t border-border-subtle py-8'
              }
            >
              <Avatar login={account.login} />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui-strong">{account.login}</span>
                <span className="text-fg-muted text-small">github.com · {notes(account)}</span>
              </div>
              <Switch
                aria-label={`Import ${account.login}`}
                checked={chosen.has(account.login)}
                disabled={!account.usable || refused.has(account.login) || step.kind !== 'choosing'}
                onCheckedChange={(on) => {
                  const next = new Set(chosen);
                  if (on) next.add(account.login);
                  else next.delete(account.login);
                  choose(next);
                }}
              />
            </li>
          ))}
        </ul>
        {/* There through every step, so what an import refused is said as it comes, after
          "Importing…": a region drawn with its words already in it is read by nobody. */}
        <div role="status" className="flex flex-col gap-12 not-empty:mt-12">
          {refusals.map((refusal) => (
            <Callout key={refusal.login} tone="warning">
              {refusal.line}
            </Callout>
          ))}
        </div>
      </div>
      {warnings.map((warning) => (
        <Callout key={warning.login} tone="warning">
          <div className="flex items-center gap-8">
            <span className="min-w-0 flex-1">{warning.line}</span>
            {warning.signIn && (
              <Button size="sm" disabled={step.kind !== 'choosing'} onClick={openSignIn}>
                Sign in with GitHub…
              </Button>
            )}
          </div>
        </Callout>
      ))}
      {imported.length > 0 && <ImportedNote logins={imported} />}
      {(imported.length > 0 || failed.length > 1) &&
        failed.map((result) => (
          <Problem
            key={result.login}
            title={`Couldn’t import ${result.login}`}
            {...failureWords(result.login, result.why)}
          />
        ))}
    </>
  );

  if (step.kind === 'failed') {
    return {
      description,
      body,
      state: 'failed',
      action: { ...importing, onRun: () => importAll(found, step.logins) },
      problem: { title: 'Couldn’t import the accounts', details: step.details },
    };
  }
  // None imported: what failed is the problem above the foot, each account's in the body when
  // there are several, and the main button tries them again, which only replaces a sign-in that
  // did come through.
  if (step.kind === 'done' && imported.length === 0) {
    const [first] = failed;
    // Only those a second try could change are tried again.
    const logins = failed.filter(({ why }) => canRetry(why)).map(({ login }) => login);
    return {
      description,
      body,
      state: 'failed',
      action: { ...importing, onRun: () => importAll(found, logins) },
      problem:
        failed.length === 1 && first !== undefined
          ? { title: `Couldn’t import ${first.login}`, ...failureWords(first.login, first.why) }
          : { title: 'Couldn’t import the accounts' },
    };
  }
  return {
    description,
    body,
    state: step.kind === 'importing' ? 'working' : settled ? 'done' : 'ask',
    action: {
      ...importing,
      label: chosen.size === 0 ? 'Import' : `Import ${count(chosen.size, 'account')}`,
      disabled: chosen.size === 0 ? 'Choose an account' : undefined,
    },
  };
}

/** Which accounts were imported, as a done fact. */
function ImportedNote({ logins }: { logins: readonly string[] }) {
  return (
    <div role="status" className="flex flex-col">
      <SetupDone>Imported {count(logins.length, 'account')}</SetupDone>
      <span className="text-fg-muted text-small">Signed in as {logins.join(', ')}</span>
    </div>
  );
}

/** The command that signs GitHub CLI in, with Copy. */
function SignInFirst() {
  const copy = useCopy();
  return (
    <div className="flex items-center gap-8 rounded-md border border-border bg-bg-well py-6 ps-12 pe-6">
      <code className="min-w-0 flex-1 code-small select-text">{GH_LOGIN}</code>
      <CopyButton variant="ghost" size="sm" onCopy={() => copy(GH_LOGIN)} />
    </div>
  );
}
