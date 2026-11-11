// The dialog for importing accounts from `gh`: what gh is signed in to, which of them to import,
// what each one's token can't do, and how the import went. Lo copies the tokens; gh keeps its own.

import { Avatar, Button, Callout, Dialog, DialogSpacer, Key, Spinner, Switch } from '@lo/ui';
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';

import { IpcError } from '../../../ipc/contract.ts';
import { client } from '../../../window/ipc.ts';
import { contract as app } from '../../app/contract.ts';
import type { GhAccount, GhListing, Imported } from '../contract.ts';
import { closeDialog } from './dialogs.ts';
import { useFocusOnStep } from './focus.ts';
import { labels } from './labels.ts';
import { main } from './main.ts';

type Found = Extract<GhListing, { kind: 'found' }>;

/** Where the import is. */
type Step =
  | { readonly kind: 'loading' }
  /** Lo can't keep a token, so it imports nothing. */
  | { readonly kind: 'noKeyring'; readonly message: string }
  /** gh can't be found or run, or main couldn't be asked. */
  | { readonly kind: 'unavailable'; readonly message: string }
  | { readonly kind: 'choosing'; readonly found: Found }
  | { readonly kind: 'importing'; readonly found: Found }
  | { readonly kind: 'done'; readonly results: readonly Imported[] };

/** What went wrong asking main, in words to show. */
function whyNot(error: unknown, otherwise: string): string {
  return error instanceof IpcError ? error.message : otherwise;
}

/** `n` of `what`, as a person writes it: "1 account", "2 accounts". */
function count(n: number, what: string): string {
  return `${n} ${what}${n === 1 ? '' : 's'}`;
}

/** What gh's account can't do for want of a scope, if anything. */
function lacking(account: GhAccount): string | undefined {
  if (!account.usable || account.missing.length === 0) return undefined;
  if (account.scopes.length === 0) {
    return `${account.login}'s token has no OAuth scopes, so what Lo can do with it depends on its permissions.`;
  }
  if (account.missing.length === 1 && account.missing[0] === 'workflow') {
    return `${account.login}'s token can't merge PRs that change workflows. Sign in with GitHub instead for a token that can.`;
  }
  return `${account.login}'s token lacks ${account.missing.join(', ')}, so Lo can't do everything with it. Sign in with GitHub instead for a token that can.`;
}

/** What to say about gh's account beside its login. */
function notes(account: GhAccount): string {
  const said = [account.scopes.length > 0 ? account.scopes.join(', ') : 'no scopes'];
  if (account.active) said.push('active in gh');
  if (!account.usable) said.push(`gh says ${account.state}`);
  if (account.shortLived) said.push('a short-lived token gh renews');
  if (account.inLo) said.push('in Lo already; importing replaces its token');
  return said.join(' · ');
}

/** The dialog for importing accounts from gh, open while `open` is. */
export function ImportView({ open, container }: { open: boolean; container: HTMLElement | null }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const primary = useRef<HTMLButtonElement>(null);
  const opened = useRef(0);

  const load = () => {
    const turn = ++opened.current;
    setStep({ kind: 'loading' });
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
          setStep({ kind: 'unavailable', message: listing.message });
        }
      },
      (error: unknown) => {
        if (turn !== opened.current) return;
        setStep({ kind: 'unavailable', message: whyNot(error, "Lo couldn't ask gh.") });
      },
    );
  };

  useEffect(() => {
    if (open) load();
    else opened.current += 1;
  }, [open]);

  useFocusOnStep(primary, step.kind);

  const importChosen = () => {
    if (step.kind !== 'choosing' || chosen.size === 0) return;
    const turn = opened.current;
    const logins = step.found.accounts.map(loginOf).filter((login) => chosen.has(login));
    setStep({ kind: 'importing', found: step.found });
    main()
      .importGh({ logins })
      .then(
        (results) => {
          if (turn === opened.current) setStep({ kind: 'done', results });
        },
        (error: unknown) => {
          if (turn !== opened.current) return;
          if (error instanceof IpcError && error.code === 'noKeyring') {
            setStep({ kind: 'noKeyring', message: error.message });
          } else {
            setStep({ kind: 'unavailable', message: whyNot(error, "Lo couldn't import from gh.") });
          }
        },
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

  const shown = view(step, chosen, setChosen, importChosen, load, primary);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
      }}
      title={shown.title}
      description={shown.description}
      foot={shown.foot}
      initialFocus={primary}
      onKeyDown={onKeyDown}
      container={container}
      testId="import-gh"
    >
      {shown.body}
    </Dialog>
  );
}

function loginOf(account: GhAccount): string {
  return account.login;
}

interface Shown {
  title: string;
  description?: ReactNode;
  body: ReactNode;
  foot: ReactNode;
}

/** A button that closes the dialog, labelled `label`, with `Esc`. */
function cancel(label: string) {
  return (
    <Button onClick={closeDialog}>
      {label}
      <Key keys={labels('esc')} decorative />
    </Button>
  );
}

function view(
  step: Step,
  chosen: ReadonlySet<string>,
  choose: (chosen: ReadonlySet<string>) => void,
  importChosen: () => void,
  load: () => void,
  primary: RefObject<HTMLButtonElement | null>,
): Shown {
  const title = 'Import accounts from gh';
  switch (step.kind) {
    case 'loading':
      return {
        title,
        body: (
          <div role="status" className="flex items-center gap-8 text-fg-muted text-small">
            <Spinner />
            Asking gh for its accounts…
          </div>
        ),
        foot: (
          <>
            <DialogSpacer />
            {cancel('Cancel')}
          </>
        ),
      };
    case 'noKeyring':
      return {
        title: "Lo can't keep your tokens safely",
        body: (
          <>
            <Callout tone="danger" role="alert">
              {step.message}
            </Callout>
            <p className="m-0 text-fg-muted text-small">
              Without a keyring, the tokens would be kept where any program could read them, so Lo
              imports nothing.
            </p>
          </>
        ),
        foot: (
          <>
            <DialogSpacer />
            {cancel('Close')}
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
    case 'unavailable':
      return {
        title,
        body: (
          <Callout tone="warning" role="alert">
            {step.message}
          </Callout>
        ),
        foot: (
          <>
            <DialogSpacer />
            {cancel('Close')}
            <Button ref={primary} variant="primary" onClick={load}>
              Try again
              <Key keys={labels('enter')} decorative className="text-on-accent" />
            </Button>
          </>
        ),
      };
    case 'choosing':
    case 'importing': {
      const { found } = step;
      const busy = step.kind === 'importing';
      const { accounts } = found;
      const where = `gh${found.version === null ? '' : ` ${found.version}`} at ${found.program}`;
      if (accounts.length === 0) {
        return {
          title,
          description: `${where} isn't signed in to any github.com account.`,
          body: (
            <p className="m-0 text-fg-muted">
              Sign in with <span className="code-small">gh auth login</span>, then try again.
            </p>
          ),
          foot: (
            <>
              <DialogSpacer />
              {cancel('Close')}
              <Button ref={primary} variant="primary" onClick={load}>
                Try again
                <Key keys={labels('enter')} decorative className="text-on-accent" />
              </Button>
            </>
          ),
        };
      }
      const warnings = accounts
        .filter((account) => chosen.has(account.login))
        .flatMap((account) => lacking(account) ?? []);
      return {
        title,
        description: `${where} is signed in to ${count(accounts.length, 'account')}`,
        body: (
          <>
            <ul className="m-0 flex list-none flex-col p-0" aria-label="gh's accounts">
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
                    disabled={!account.usable || busy}
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
            {warnings.map((warning) => (
              <Callout key={warning} tone="warning">
                {warning}
              </Callout>
            ))}
            <p className="m-0 text-fg-muted text-small">
              Lo copies the tokens. gh stays signed in, and signing out of one doesn't sign out the
              other.
            </p>
          </>
        ),
        foot: (
          <>
            {busy && (
              <span role="status" className="flex items-center gap-8">
                <Spinner />
                Importing…
              </span>
            )}
            <DialogSpacer />
            {cancel('Cancel')}
            <Button
              ref={primary}
              variant="primary"
              disabled={busy || chosen.size === 0}
              onClick={importChosen}
            >
              {chosen.size === 0 ? 'Import' : `Import ${count(chosen.size, 'account')}`}
              <Key keys={labels('enter')} decorative className="text-on-accent" />
            </Button>
          </>
        ),
      };
    }
    case 'done': {
      const imported = step.results.filter((result) => result.ok).map(({ login }) => login);
      const failed = step.results.flatMap((result) => (result.ok ? [] : [result]));
      return {
        title: imported.length > 0 ? `Imported ${count(imported.length, 'account')}` : title,
        body: (
          <>
            {imported.length > 0 && (
              <p className="m-0">Lo is signed in to GitHub as {imported.join(', ')}.</p>
            )}
            {failed.map((result) => (
              <Callout key={result.login} tone="danger" role="alert">
                <span className="font-semibold">{result.login}</span>: {result.message}
              </Callout>
            ))}
          </>
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
    }
    default:
      throw new Error(`An import step Lo doesn't know: ${JSON.stringify(step satisfies never)}`);
  }
}
