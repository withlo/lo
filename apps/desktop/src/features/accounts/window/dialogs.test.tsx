// @vitest-environment jsdom
// The feature's dialogs in a window of their own, with main answered by a stand-in bridge: what
// each shows, what it asks main, and that closing one stops what it was doing.

import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge as install } from '../../../window/test/bridge.ts';
import type { AccountSummary, GhListing, SignInState } from '../contract.ts';
import { AccountDialogs } from './AccountDialogs.tsx';
import Accounts, { AccountsSection } from './Accounts.tsx';
import { closeDialog, openImport, openSignIn, openSignOut } from './dialogs.ts';
import feature from './index.ts';
import { pressCopyCode } from './SignIn.tsx';
import { accountsStore, showAccounts } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands, 'mac');
});

afterEach(() => {
  act(() => closeDialog());
  accountsStore.setState({ accounts: undefined, dialog: undefined });
});

/**
 * The dialogs, as the window draws them, with Settings' Accounts section beside them, once the
 * feature has started listening to main.
 */
function render() {
  feature.start?.();
  const host = document.createElement('div');
  host.id = 'root';
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={[Accounts]}>
        <AccountDialogs />
        <AccountsSection label="Accounts" description="" />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/**
 * A stand-in for main that answers `answers`, and lists the accounts the test showed and stops any
 * sign-in unless told otherwise.
 */
function installBridge(answers: Readonly<Record<string, (input: unknown) => unknown>>) {
  return install({
    'accounts.list': () => accountsStore.getState().accounts ?? [],
    'accounts.cancelSignIn': () => undefined,
    ...answers,
  });
}

/** Lets every answer main gave, and what follows from it, happen. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  });
}

function dialog(name: string): HTMLElement | null {
  return document.querySelector(`[data-testid="${name}"]`);
}

/** What the sign-in dialog's one line says of where the sign-in is. */
function status(): string | undefined {
  // The first in it: a button that copies has one of its own.
  return dialog('sign-in')?.querySelector('div[role="status"]')?.textContent;
}

function button(within: Element | null, text: string): HTMLButtonElement {
  const found = [...(within?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`No button "${text}".`);
  return found;
}

/** The choices of the sign-out dialog, if it's open. */
function choices(): Element[] {
  return [...(dialog('sign-out')?.querySelectorAll('[role="radio"]') ?? [])];
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function press(target: Element, key: string): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

const account = (login: string, changes: Partial<AccountSummary> = {}): AccountSummary => ({
  login,
  name: null,
  source: 'deviceFlow',
  signedOut: null,
  cantSave: false,
  needsKeyring: false,
  ...changes,
});

const waiting: SignInState = {
  kind: 'waiting',
  id: 7,
  userCode: 'FAKE-1234',
  expiresAt: Date.now() + 899_000,
  page: 'github.com/login/device',
};

describe('the sign-in dialog', () => {
  it('shows the code to type on GitHub, then who signed in', async () => {
    const bridge = installBridge({
      'accounts.signIn': () => waiting,
      'accounts.openGithub': () => undefined,
      'accounts.copyCode': () => undefined,
    });
    render();
    act(() => openSignIn());
    await settle();
    const shown = dialog('sign-in');
    expect(shown?.textContent).toContain('FAKE-1234');
    expect(shown?.textContent).toContain('Enter this code at github.com/login/device');
    // How long the code has left is beside the line, not in what a screen reader has read out.
    expect(status()).toBe('Waiting for approval…');
    // 14 min 59 s, rounded down, as a deadline is: it never says more time than is left.
    expect(shown?.textContent).toContain('Code expires in 14 min');
    // The main button copies the code and opens GitHub's page, through main.
    expect(document.activeElement?.textContent).toContain('Copy and open GitHub');
    click(button(shown, 'Copy and open GitHub'));
    await settle();
    expect(bridge.calls).toContainEqual(['accounts.openGithub', { id: 7 }]);
    // Its own button copies the code alone, and says so itself.
    click(button(shown, 'Copy'));
    await settle();
    expect(bridge.calls).toContainEqual(['accounts.copyCode', { id: 7 }]);
    expect(
      button(shown, 'Copy').querySelector('.inline-grid > span:not(.invisible)')?.firstChild
        ?.textContent,
    ).toBe('Copied');
    // The body stays as the account is checked: the code keeps its place, and the button is busy.
    act(() => bridge.push('accounts.signingIn', { kind: 'checking', id: 7 }));
    expect(dialog('sign-in')?.textContent).toContain('FAKE-1234');
    expect(button(shown, 'Copy and open GitHub').getAttribute('aria-busy')).toBe('true');
    // The check can't be stopped, and Cancel says so.
    expect(button(shown, 'Cancel').getAttribute('aria-description')).toBe(
      'The account check can’t be stopped',
    );
    expect(shown?.textContent).not.toContain('Enter this code');
    // The busy button is the one thing that shows the wait: no line with a ring of its own.
    expect(status()).toBe('');
    expect(shown?.querySelectorAll('.spinner')).toHaveLength(1);
    act(() =>
      bridge.push('accounts.signingIn', {
        kind: 'signedIn',
        id: 7,
        login: 'rozed-bot',
        name: null,
      }),
    );
    expect(status()).toBe('Signed in as rozed-bot');
    expect(button(dialog('sign-in'), 'Done')).toBeDefined();
    // Another sign-in's news isn't this one's.
    act(() =>
      bridge.push('accounts.signingIn', { kind: 'failed', id: 6, why: 'denied', message: 'No.' }),
    );
    expect(status()).toBe('Signed in as rozed-bot');
  });

  it('waits for the code with its place kept, and `Esc` still stops it', async () => {
    const answers: ((state: SignInState) => void)[] = [];
    const bridge = installBridge({
      'accounts.signIn': () => new Promise<SignInState>((resolve) => answers.push(resolve)),
      'accounts.copyCode': () => undefined,
    });
    render();
    act(() => openSignIn());
    await settle();
    const shown = dialog('sign-in');
    // The line says the code is coming, and is the one thing that shows the wait: the code's box
    // is empty, and the line under the title has nowhere to send the reader yet.
    expect(status()).toBe('Getting code…');
    expect(shown?.querySelectorAll('.spinner')).toHaveLength(1);
    expect(shown?.querySelector('[aria-busy="true"] .device-code')).not.toBeNull();
    expect(shown?.querySelector('[role="img"]')).toBeNull();
    expect(shown?.querySelector('.skeleton')).toBeNull();
    expect(shown?.textContent).not.toContain('Enter this code');
    // Nothing to run yet: the main button is dimmed, and says why to a screen reader.
    const main = button(shown, 'Copy and open GitHub');
    expect(main.getAttribute('aria-disabled')).toBe('true');
    expect(main.getAttribute('aria-description')).toBe('Getting code');
    click(main);
    await settle();
    expect(bridge.calls).not.toContainEqual(['accounts.openGithub', { id: 7 }]);
    await act(async () => {
      answers[0]?.(waiting);
      await Promise.resolve();
    });
    await settle();
    expect(button(shown, 'Copy and open GitHub')).toBe(main);
    expect(main.getAttribute('aria-disabled')).toBeNull();
    expect(shown?.querySelector('[aria-busy="true"]')).toBeNull();
    expect(shown?.textContent).toContain('Enter this code at github.com/login/device');
    // The key for the code presses its Copy button, which says so itself, in the dialog.
    act(() => pressCopyCode());
    await settle();
    expect(bridge.calls).toContainEqual(['accounts.copyCode', { id: 7 }]);
    expect(
      button(shown, 'Copy').querySelector('.inline-grid > span:not(.invisible)')?.firstChild
        ?.textContent,
    ).toBe('Copied');
    press(shown ?? document.body, 'Escape');
    await settle();
    expect(dialog('sign-in')).toBeNull();
  });

  it('presses Done on ⏎ off its buttons, and says nothing of the keychain', async () => {
    const bridge = installBridge({ 'accounts.signIn': () => waiting });
    render();
    act(() => openSignIn());
    await settle();
    act(() =>
      bridge.push('accounts.signingIn', {
        kind: 'signedIn',
        id: 7,
        login: 'rozed-bot',
        name: null,
      }),
    );
    const shown = dialog('sign-in');
    expect(status()).toBe('Signed in as rozed-bot');
    expect(shown?.textContent).not.toMatch(/keychain/i);
    // A button's own `⏎` is left to it.
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      button(shown, 'Done').dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(false);
    // On the dialog's text, which a click there left focus on, `⏎` presses Done.
    press(shown?.querySelector('div[role="status"]') ?? document.body, 'Enter');
    await settle();
    expect(dialog('sign-in')).toBeNull();
  });

  it('stops the sign-in when closed, even one main is still starting', async () => {
    const bridge = installBridge({
      'accounts.signIn': () => waiting,
      'accounts.cancelSignIn': () => undefined,
    });
    render();
    act(() => openSignIn());
    await settle();
    press(dialog('sign-in') ?? document.body, 'Escape');
    await settle();
    expect(dialog('sign-in')).toBeNull();
    expect(bridge.calls).toContainEqual(['accounts.cancelSignIn', { id: 7 }]);

    // Closed before main answered: the sign-in it then starts stops at once.
    bridge.calls.length = 0;
    act(() => {
      openSignIn();
      closeDialog();
    });
    await settle();
    expect(bridge.calls).toEqual([
      ['accounts.signIn', undefined],
      ['accounts.cancelSignIn', { id: 7 }],
    ]);
  });

  it('refuses without a keyring, and offers to quit so Lo can start again with one', async () => {
    installBridge({
      'accounts.signIn': () => ({
        kind: 'failed',
        id: 1,
        why: 'noKeyring',
        message: 'Lo keeps your GitHub token in a keyring, and none answered.',
      }),
    });
    render();
    act(() => openSignIn());
    await settle();
    const shown = dialog('sign-in');
    expect(shown?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t sign in Sign-ins are kept in the Keychain, and it isn’t available.',
    );
    // What main said is behind Details, as it came.
    click(button(shown, 'Details'));
    expect(shown?.querySelector('pre')?.textContent).toBe(
      'Lo keeps your GitHub token in a keyring, and none answered.',
    );
    expect(button(shown, 'Quit Lo')).toBeDefined();
    expect(button(shown, 'Close')).toBeDefined();
    // No code came, so there's no box for one, and no line saying where to type it.
    expect(shown?.querySelector('.device-code')?.closest('[inert]')).not.toBeNull();
    expect(shown?.textContent).not.toContain('Enter this code');
  });

  it('says why GitHub ended it, once, and offers the way on', async () => {
    const bridge = installBridge({ 'accounts.signIn': () => waiting });
    render();
    act(() => openSignIn());
    await settle();
    const shown = dialog('sign-in');
    const said = () => shown?.querySelector('[role="alert"]')?.textContent;
    act(() =>
      bridge.push('accounts.signingIn', {
        kind: 'failed',
        id: 7,
        why: 'expired',
        message: 'The code expired before it was entered on GitHub.',
      }),
    );
    expect(said()).toBe('Couldn’t sign in The code expired.');
    // The code stays where it was, dimmed, with nothing left to do with it: no Copy, and no line
    // saying where to type it.
    expect(shown?.querySelector('[role="img"]')?.className).toContain('text-fg-disabled');
    expect(button(shown, 'Copy').closest('.invisible')).not.toBeNull();
    expect(shown?.textContent).not.toContain('Enter this code');
    expect(status()).toBe('');
    expect(button(shown, 'Try again')).toBeDefined();
    click(button(shown, 'Try again'));
    await settle();
    expect(shown?.querySelector('[role="alert"]')).toBeNull();
    act(() =>
      bridge.push('accounts.signingIn', {
        kind: 'failed',
        id: 7,
        why: 'missingScopes',
        message: 'The token is missing the workflow scope.',
      }),
    );
    expect(said()).toBe('Couldn’t sign in GitHub granted less access than the sign-in asked for.');
    // The sign-in is what failed, so the way on is to try it again.
    expect(button(shown, 'Try again')).toBeDefined();
  });

  it('says why it ended, and tries again', async () => {
    let asked = 0;
    installBridge({
      'accounts.signIn': () => {
        asked += 1;
        if (asked === 1) throw new IpcError('internal', 'accounts.signIn failed.');
        return waiting;
      },
    });
    render();
    act(() => openSignIn());
    await settle();
    expect(dialog('sign-in')?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t sign in',
    );
    click(button(dialog('sign-in'), 'Details'));
    expect(dialog('sign-in')?.querySelector('pre')?.textContent).toBe('accounts.signIn failed.');
    click(button(dialog('sign-in'), 'Try again'));
    await settle();
    expect(dialog('sign-in')?.textContent).toContain('FAKE-1234');
  });
});

const listing: GhListing = {
  kind: 'found',
  program: '/opt/homebrew/bin/gh',
  version: '2.103.3',
  accounts: [
    {
      login: 'rozed-bot',
      active: true,
      usable: true,
      state: 'success',
      scopes: ['read:org', 'repo', 'workflow'],
      missing: [],
      shortLived: false,
      inLo: false,
    },
    {
      login: 'someone-else',
      active: false,
      usable: true,
      state: 'success',
      scopes: ['gist', 'read:org', 'repo'],
      missing: ['workflow'],
      shortLived: false,
      inLo: true,
    },
    {
      login: 'broken',
      active: false,
      usable: false,
      state: 'error',
      scopes: [],
      missing: ['repo', 'read:org', 'workflow'],
      shortLived: false,
      inLo: false,
    },
  ],
};

describe('importing from gh', () => {
  it("lists gh's accounts, imports those chosen, and says how it went", async () => {
    const bridge = installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => listing,
      'accounts.importGh': () => [
        { ok: true, login: 'rozed-bot' },
        { ok: false, login: 'someone-else', why: { kind: 'otherAccount', other: 'rozed-bot' } },
      ],
    });
    render();
    act(() => openImport());
    await settle();
    const shown = dialog('import-gh');
    expect(shown?.textContent).toContain('Import from GitHub CLI');
    expect(shown?.textContent).toContain('GitHub CLI 2.103.3 · 3 accounts');
    // Where gh is lives behind no line of the dialog's: GitHub CLI is named, never its path.
    expect(shown?.textContent).not.toContain('/opt/homebrew/bin/gh');
    const switches = [...(shown?.querySelectorAll('[role="switch"]') ?? [])];
    expect(switches.map((each) => each.getAttribute('aria-label'))).toEqual([
      'Import rozed-bot',
      'Import someone-else',
      'Import broken',
    ]);
    // Those gh can use and Lo doesn't have yet start chosen; one gh can't use can't be.
    expect(switches.map((each) => each.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    expect(switches[2]?.hasAttribute('data-disabled')).toBe(true);
    expect(shown?.textContent).toContain('status error');
    click(switches[1] ?? document.body);
    expect(dialog('import-gh')?.textContent).toContain(
      'someone-else’s sign-in can’t merge pull requests that change workflows.',
    );
    // The way to a sign-in that can is beside it.
    expect(button(dialog('import-gh'), 'Sign in with GitHub…')).toBeDefined();
    expect(button(dialog('import-gh'), 'Import 2 accounts')).toBeDefined();
    // `⏎` on a switch imports.
    press(switches[1] ?? document.body, 'Enter');
    await settle();
    expect(bridge.calls).toContainEqual([
      'accounts.importGh',
      { logins: ['rozed-bot', 'someone-else'] },
    ]);
    const done = dialog('import-gh');
    expect(done?.textContent).toContain('Imported 1 account');
    expect(done?.textContent).toContain('Signed in as rozed-bot');
    expect(done?.textContent).toContain('Couldn’t import someone-else');
    expect(done?.textContent).toContain(
      'GitHub CLI’s sign-in for someone-else belongs to rozed-bot.',
    );
    // The title is the dialog's throughout; the foot says it's done.
    expect(done?.textContent).toContain('Import from GitHub CLI');
    expect(button(dialog('import-gh'), 'Done')).toBeDefined();
  });

  it('imports nothing without a keyring, and says why there is nothing to import', async () => {
    installBridge({
      'accounts.keyring': () => 'No keyring answered.',
      'accounts.ghAccounts': () => listing,
    });
    render();
    act(() => openImport());
    await settle();
    expect(dialog('import-gh')?.textContent).toContain('Can’t import accounts');
    expect(dialog('import-gh')?.textContent).toContain(
      'Sign-ins are kept in the Keychain, and it isn’t available.',
    );
    expect(button(dialog('import-gh'), 'Quit Lo')).toBeDefined();
    expect(dialog('import-gh')?.querySelectorAll('[role="switch"]')).toHaveLength(0);
    act(() => closeDialog());
    installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => ({ kind: 'missing' }),
    });
    act(() => openImport());
    await settle();
    expect(dialog('import-gh')?.textContent).toContain('Can’t find GitHub CLI');
    expect(button(dialog('import-gh'), 'Check again')).toBeDefined();
    // Something missing has failed, though "Check again" looks for it: red.
    expect(
      dialog('import-gh')?.querySelector('svg[class*="text-"]')?.getAttribute('class'),
    ).toContain('text-danger');
    act(() => closeDialog());
    // One too old to list its accounts says its version, and what gh said is behind Details.
    installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => ({
        kind: 'failed',
        program: '/usr/bin/gh',
        why: 'tooOld',
        version: '2.20.0',
        details: 'unknown flag: --json',
      }),
    });
    act(() => openImport());
    await settle();
    const old = dialog('import-gh')?.textContent ?? '';
    expect(old).toContain('Can’t use GitHub CLI 2.20.0');
    expect(old).toContain('A newer version is required.');
    expect(old).not.toContain('unknown flag');
    expect(button(dialog('import-gh'), 'Check again')).toBeDefined();
    act(() => closeDialog());
    // One passed over says why, as Git's does, with where it is behind Details.
    installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => ({
        kind: 'distrusted',
        program: '/opt/shared/gh',
        why: 'folderWritable',
        details: '/opt/shared/gh\nother users can change /opt/shared',
      }),
    });
    act(() => openImport());
    await settle();
    const passed = dialog('import-gh')?.textContent ?? '';
    expect(passed).toContain('Can’t use GitHub CLI');
    expect(passed).toContain('Other users can change its folder.');
    expect(passed).not.toContain('/opt/shared');
    expect(button(dialog('import-gh'), 'Check again')).toBeDefined();
  });

  it('says GitHub CLI isn’t signed in, with the command that signs it in', async () => {
    installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => ({ ...listing, accounts: [] }),
    });
    render();
    act(() => openImport());
    await settle();
    const shown = dialog('import-gh');
    expect(shown?.textContent).toContain('Can’t import accounts');
    expect(shown?.textContent).toContain('GitHub CLI isn’t signed in.');
    expect(shown?.querySelector('code')?.textContent).toBe('gh auth login');
    // The command that fixes it reads after what's wrong.
    const alert = shown?.querySelector('[role="alert"]');
    const well = shown?.querySelector('code');
    expect(
      alert && well ? alert.compareDocumentPosition(well) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
    expect(button(dialog('import-gh'), 'Check again')).toBeDefined();
  });

  it('goes back to choosing when the only account refused would refuse again, saying why', async () => {
    const bridge = installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => listing,
      'accounts.importGh': () => [
        { ok: false, login: 'rozed-bot', why: { kind: 'otherAccount', other: 'someone-else' } },
      ],
    });
    render();
    act(() => openImport());
    await settle();
    click(button(dialog('import-gh'), 'Import 1 account'));
    await settle();
    const shown = dialog('import-gh');
    // No failure to try again: the account is out of the choice, with why in its place, said
    // as it comes by a region that was there while it imported.
    expect(shown?.querySelector('[role="alert"]')).toBeNull();
    expect(shown?.querySelector('[role="status"]')?.textContent).toBe(
      'GitHub CLI’s sign-in for rozed-bot belongs to someone-else.',
    );
    const switches = [...(shown?.querySelectorAll('[role="switch"]') ?? [])];
    expect(switches[0]?.getAttribute('aria-checked')).toBe('false');
    expect(switches[0]?.hasAttribute('data-disabled')).toBe(true);
    expect(switches[1]?.hasAttribute('data-disabled')).toBe(false);
    const main = button(shown, 'Import');
    expect(main.textContent).toMatch(/^Import(?! \d)/);
    expect(main.getAttribute('aria-disabled')).toBe('true');
    expect(main.getAttribute('aria-description')).toBe('Choose an account');
    expect(() => button(shown, 'Try again')).toThrow('No button "Try again".');
    // Another can still be chosen and imported.
    click(switches[1] ?? document.body);
    expect(
      button(dialog('import-gh'), 'Import 1 account').getAttribute('aria-disabled'),
    ).toBeNull();
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.importGh')).toHaveLength(1);
  });

  it('tries again only what a second try could change', async () => {
    const bridge = installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => listing,
      // Each account asked for fails as it did before.
      'accounts.importGh': (input) =>
        [
          {
            ok: false,
            login: 'rozed-bot',
            why: { kind: 'failed', cause: { kind: 'offline' }, details: 'fetch failed' },
          },
          { ok: false, login: 'someone-else', why: { kind: 'otherAccount', other: 'rozed-bot' } },
        ].filter(({ login }) => JSON.stringify(input).includes(`"${login}"`)),
    });
    render();
    act(() => openImport());
    await settle();
    const region = () => dialog('import-gh')?.querySelector('[role="status"]');
    click(dialog('import-gh')?.querySelectorAll('[role="switch"]')[1] ?? document.body);
    click(button(dialog('import-gh'), 'Import 2 accounts'));
    await settle();
    // Each failure is its own error while this import's failures show.
    expect(region()?.textContent).toBe('');
    click(button(dialog('import-gh'), 'Try again'));
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.importGh')).toEqual([
      ['accounts.importGh', { logins: ['rozed-bot', 'someone-else'] }],
      ['accounts.importGh', { logins: ['rozed-bot'] }],
    ]);
    // The one refused for good before is still out of the choice, with why.
    expect(region()?.textContent).toBe(
      'GitHub CLI’s sign-in for someone-else belongs to rozed-bot.',
    );
    const switches = [...(dialog('import-gh')?.querySelectorAll('[role="switch"]') ?? [])];
    expect(switches[1]?.getAttribute('aria-checked')).toBe('false');
  });
});

describe('signing out', () => {
  it('asks once, then signs out the account, and says if it could not', async () => {
    let refuse = true;
    const bridge = installBridge({
      'accounts.remove': () => {
        if (refuse) throw new IpcError('failed', 'database is locked');
        return undefined;
      },
    });
    showAccounts([account('rozed-bot')]);
    render();
    act(() => openSignOut(['rozed-bot']));
    await settle();
    const shown = dialog('sign-out');
    expect(shown?.textContent).toContain('Sign out of rozed-bot?');
    expect(shown?.textContent).toContain('Its sign-in is deleted from this computer.');
    expect(choices()).toHaveLength(0);
    expect(document.activeElement).toBe(button(shown, 'Sign out'));
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.remove')).toEqual([]);

    click(button(shown, 'Sign out'));
    await settle();
    expect(dialog('sign-out')?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t sign out of rozed-bot',
    );
    // Main's words are behind Details, and the main button tries again.
    expect(button(dialog('sign-out'), 'Details')).toBeDefined();
    expect(button(dialog('sign-out'), 'Try again')).toBeDefined();

    // Pressing `⏎` where focus has no control of its own tries again.
    refuse = false;
    press(dialog('sign-out')?.querySelector('p') ?? document.body, 'Enter');
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.remove')).toEqual([
      ['accounts.remove', { login: 'rozed-bot' }],
      ['accounts.remove', { login: 'rozed-bot' }],
    ]);
    expect(dialog('sign-out')).toBeNull();
  });

  it('counts an account already gone as signed out when it tries again', async () => {
    let gone = false;
    const bridge = installBridge({
      'accounts.remove': () => {
        if (gone) throw new IpcError('missing', 'Lo isn’t signed in to rozed-bot.');
        gone = true;
        throw new IpcError('failed', 'database is locked');
      },
    });
    showAccounts([account('rozed-bot')]);
    render();
    act(() => openSignOut(['rozed-bot']));
    await settle();
    click(button(dialog('sign-out'), 'Sign out'));
    await settle();
    expect(dialog('sign-out')?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t sign out of rozed-bot',
    );
    // The first try took the account and failed after: trying again finds it gone, which is done.
    click(button(dialog('sign-out'), 'Try again'));
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.remove')).toHaveLength(2);
    expect(dialog('sign-out')).toBeNull();
  });

  it('says a sign-in it couldn’t delete is still kept, with nothing to try again', async () => {
    installBridge({
      'accounts.remove': () => {
        throw new IpcError('leftover', 'The keychain is locked.');
      },
    });
    showAccounts([account('rozed-bot')]);
    render();
    act(() => openSignOut(['rozed-bot']));
    await settle();
    click(button(dialog('sign-out'), 'Sign out'));
    await settle();
    const alert = dialog('sign-out')?.querySelector('[role="alert"]')?.textContent;
    expect(alert).toContain('Couldn’t delete rozed-bot’s sign-in');
    expect(alert).toMatch(/It’s still in the (Keychain|keyring)\./);
    expect(() => button(dialog('sign-out'), 'Try again')).toThrow('No button "Try again".');
    expect(button(dialog('sign-out'), 'Close')).toBeDefined();
  });

  it('asks which account when there are several, and picks none for the person', async () => {
    const bridge = installBridge({ 'accounts.remove': () => undefined });
    showAccounts([account('rozed-bot'), account('tess-okafor', { source: 'gh' })]);
    render();
    act(() => openSignOut(['rozed-bot', 'tess-okafor']));
    const shown = dialog('sign-out');
    expect(shown?.querySelector('h2, [id]')?.textContent).toBe('Sign out');
    expect(choices().map((each) => each.textContent)).toEqual([
      'rozed-bot',
      'tess-okaforFrom GitHub CLI',
    ]);
    expect(choices().map((each) => each.getAttribute('aria-checked'))).toEqual(['false', 'false']);
    // Nothing can be signed out of until one is picked.
    expect(button(shown, 'Sign out').getAttribute('aria-disabled')).toBe('true');
    expect(button(shown, 'Sign out').getAttribute('aria-description')).toBe('Choose an account');
    // Until one is picked, what's deleted is the account's sign-in, whichever it is.
    expect(shown?.textContent).toContain('The account’s sign-in is deleted from this computer.');
    press(shown ?? document.body, 'Enter');
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'accounts.remove')).toEqual([]);

    click(choices()[1] ?? document.body);
    expect(button(shown, 'Sign out of tess-okafor').getAttribute('aria-disabled')).toBeNull();
    expect(shown?.textContent).toContain('tess-okafor’s sign-in is deleted from this computer.');
    click(button(shown, 'Sign out of tess-okafor'));
    await settle();
    expect(bridge.calls).toContainEqual(['accounts.remove', { login: 'tess-okafor' }]);
    expect(dialog('sign-out')).toBeNull();
  });

  it('has commands for the palette and the app menu, which say when no account is left', async () => {
    installBridge({ 'accounts.signIn': () => waiting });
    render();
    const signOut = registry().command('accounts.signOut')?.handler;
    expect(signOut?.enabled?.(NO_TARGET)).toBe('No account is signed in');
    showAccounts([account('rozed-bot'), account('tess-okafor')]);
    expect(signOut?.enabled?.(NO_TARGET)).toBe(true);
    act(() => {
      void signOut?.run(NO_TARGET);
    });
    expect(choices()).toHaveLength(2);
    // Adding an account starts signing in, in place of the dialog before it.
    act(() => {
      void registry().command('accounts.addAccount')?.handler?.run(NO_TARGET);
    });
    await settle();
    expect(dialog('sign-out')).toBeNull();
    expect(dialog('sign-in')?.textContent).toContain('FAKE-1234');
  });
});

describe('Accounts in Settings', () => {
  it('shows each account and how it is, a missing keyring above all', () => {
    installBridge({});
    showAccounts([
      account('rozed-bot'),
      account('fieldwork-bot', { signedOut: 'refused', source: 'gh' }),
      account('locked', { needsKeyring: true }),
    ]);
    const page = render();
    const rows = [...page.querySelectorAll('[role="list"][aria-label="Accounts"] > *')];
    expect(rows.map((row) => row.querySelector('.text-ui-strong')?.textContent)).toEqual([
      'rozed-bot',
      'fieldwork-bot',
      'locked',
    ]);
    expect(rows[0]?.textContent).toContain('Signed in');
    expect(rows[1]?.textContent).toContain('Signed out');
    expect(rows[1]?.textContent).toContain('Import again');
    expect(rows[2]?.textContent).toContain('Sign-in can’t be read');
    expect(page.textContent).toContain('Can’t read the sign-ins');
  });

  it('signs an account out after the dialog asks', () => {
    installBridge({});
    showAccounts([account('rozed-bot'), account('tess-okafor')]);
    const page = render();
    const rows = [...page.querySelectorAll('[role="list"][aria-label="Accounts"] > *')];
    click(button(rows[1] ?? null, 'Sign out'));
    expect(dialog('sign-out')?.textContent).toContain('Sign out of tess-okafor?');
    expect(page.textContent).not.toContain('Remove');
  });
});
