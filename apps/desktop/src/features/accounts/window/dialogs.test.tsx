// @vitest-environment jsdom
// The feature's dialogs in a window of their own, with main answered by a stand-in bridge: what
// each shows, what it asks main, and that closing one stops what it was doing.

import { handlers } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { createRegistry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge as install } from '../../../window/test/bridge.ts';
import type { AccountSummary, GhListing, SignInState } from '../contract.ts';
import keys from '../keys.ts';
import { AccountDialogs } from './AccountDialogs.tsx';
import Accounts, { AccountsSection } from './Accounts.tsx';
import { closeDialog, openImport, openSignIn, pickAccount } from './dialogs.ts';
import feature from './index.ts';
import { accountsStore, showAccounts } from './store.ts';

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(handlers(keys, { copyCode: { run: () => undefined } }), 'mac');
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
        <AccountsSection />
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

function button(within: Element | null, text: string): HTMLButtonElement {
  const found = [...(within?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!(found instanceof HTMLButtonElement)) throw new Error(`No button "${text}".`);
  return found;
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
    });
    render();
    act(() => openSignIn());
    await settle();
    const shown = dialog('sign-in');
    expect(shown?.textContent).toContain('FAKE-1234');
    expect(shown?.textContent).toContain('Enter this code at github.com/login/device');
    expect(shown?.textContent).toContain('The code expires in 14:59.');
    // The main button copies the code and opens GitHub's page, through main.
    expect(document.activeElement?.textContent).toContain('Copy and open GitHub');
    click(button(shown, 'Copy and open GitHub'));
    await settle();
    expect(bridge.calls).toContainEqual(['accounts.openGithub', { id: 7 }]);
    expect(dialog('sign-in')?.textContent).toContain('Copied FAKE-1234.');
    act(() => bridge.push('accounts.signingIn', { kind: 'checking', id: 7 }));
    expect(dialog('sign-in')?.textContent).toContain('Checking your account');
    act(() =>
      bridge.push('accounts.signingIn', {
        kind: 'signedIn',
        id: 7,
        login: 'rozed-bot',
        name: null,
      }),
    );
    expect(dialog('sign-in')?.textContent).toContain('Signed in as rozed-bot');
    // Another sign-in's news isn't this one's.
    act(() =>
      bridge.push('accounts.signingIn', { kind: 'failed', id: 6, why: 'denied', message: 'No.' }),
    );
    expect(dialog('sign-in')?.textContent).toContain('Signed in as rozed-bot');
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
    expect(shown?.textContent).toContain('Signed in as rozed-bot');
    expect(shown?.textContent).not.toMatch(/keychain/i);
    // A button's own `⏎` is left to it.
    const key = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    act(() => {
      button(shown, 'Done').dispatchEvent(key);
    });
    expect(key.defaultPrevented).toBe(false);
    // On the dialog's text, which a click there left focus on, `⏎` presses Done.
    press(shown?.querySelector('p') ?? document.body, 'Enter');
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
    expect(shown?.textContent).toContain("Lo can't keep your token safely");
    expect(shown?.querySelector('[role="alert"]')?.textContent).toBe(
      'Lo keeps your GitHub token in a keyring, and none answered.',
    );
    expect(button(shown, 'Quit Lo')).toBeDefined();
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
    expect(dialog('sign-in')?.textContent).toContain('accounts.signIn failed.');
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
        { ok: false, login: 'someone-else', message: "gh's token is rozed-bot's." },
      ],
    });
    render();
    act(() => openImport());
    await settle();
    const shown = dialog('import-gh');
    expect(shown?.textContent).toContain(
      'gh 2.103.3 at /opt/homebrew/bin/gh is signed in to 3 accounts',
    );
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
    click(switches[1] ?? document.body);
    expect(dialog('import-gh')?.textContent).toContain(
      "someone-else's token can't merge PRs that change workflows.",
    );
    // `⏎` on a switch imports.
    press(switches[1] ?? document.body, 'Enter');
    await settle();
    expect(bridge.calls).toContainEqual([
      'accounts.importGh',
      { logins: ['rozed-bot', 'someone-else'] },
    ]);
    expect(dialog('import-gh')?.textContent).toContain('Imported 1 account');
    expect(dialog('import-gh')?.querySelector('[role="alert"]')?.textContent).toBe(
      "someone-else: gh's token is rozed-bot's.",
    );
  });

  it('imports nothing without a keyring, and says why there is nothing to import', async () => {
    installBridge({
      'accounts.keyring': () => 'No keyring answered.',
      'accounts.ghAccounts': () => listing,
    });
    render();
    act(() => openImport());
    await settle();
    expect(dialog('import-gh')?.textContent).toContain("Lo can't keep your tokens safely");
    expect(dialog('import-gh')?.querySelectorAll('[role="switch"]')).toHaveLength(0);
    act(() => closeDialog());
    installBridge({
      'accounts.keyring': () => null,
      'accounts.ghAccounts': () => ({
        kind: 'missing',
        message: "Lo can't find gh, GitHub's command-line tool.",
      }),
    });
    act(() => openImport());
    await settle();
    expect(dialog('import-gh')?.textContent).toContain(
      "Lo can't find gh, GitHub's command-line tool.",
    );
  });
});

describe('the account picker', () => {
  it('chooses among the accounts that can see the repository, with j and k, and remembers it', async () => {
    const bridge = installBridge({ 'accounts.choose': () => undefined });
    showAccounts([
      account('tess-o', { name: 'Tess' }),
      account('tess-okafor', { source: 'gh' }),
      account('fieldwork-bot', { signedOut: 'refused' }),
      account('locked', { needsKeyring: true }),
    ]);
    render();
    let answered: string | undefined = 'none yet';
    act(() => {
      void pickAccount({
        owner: 'lumen-ui',
        name: 'lumen',
        number: 1182,
        logins: ['tess-o', 'tess-okafor'],
        remember: 'owner',
      }).then((login) => {
        answered = login;
      });
    });
    const shown = dialog('account-picker');
    expect(shown?.textContent).toContain('Which account for lumen-ui?');
    expect(shown?.textContent).toContain(
      'Opening lumen-ui/lumen#1182. 2 of your accounts can see it.',
    );
    const radios = () => [...(shown?.querySelectorAll('[role="radio"]') ?? [])];
    expect(radios().map((each) => each.getAttribute('aria-checked'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    // Accounts that can't open it say why, and can't be chosen.
    expect(radios()[2]?.getAttribute('aria-disabled')).toBe('true');
    expect(radios()[2]?.textContent).toContain('Signed out. Sign in again to use it here.');
    expect(radios()[3]?.textContent).toContain("Lo can't read its token without a keyring");
    press(radios()[0] ?? document.body, 'j');
    expect(radios().map((each) => each.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    // `j` again goes round, past those that can't be chosen.
    press(radios()[1] ?? document.body, 'j');
    expect(radios()[0]?.getAttribute('aria-checked')).toBe('true');
    press(radios()[0] ?? document.body, 'k');
    expect(button(shown, 'Open as').textContent).toContain('Open as tess-okafor');
    expect(shown?.textContent).toContain('Remember for every lumen-ui repo');
    press(radios()[1] ?? document.body, 'Enter');
    await settle();
    expect(bridge.calls).toContainEqual([
      'accounts.choose',
      { owner: 'lumen-ui', name: 'lumen', login: 'tess-okafor', remember: 'owner' },
    ]);
    expect(answered).toBe('tess-okafor');
    expect(dialog('account-picker')).toBeNull();
  });

  it('answers nothing when cancelled, or when another dialog takes its place', async () => {
    installBridge({ 'accounts.signIn': () => waiting, 'accounts.cancelSignIn': () => undefined });
    showAccounts([account('a'), account('b')]);
    render();
    const question = { owner: 'o', name: 'r', logins: ['a', 'b'], remember: 'repo' as const };
    let first: string | undefined = 'none yet';
    act(() => {
      void pickAccount(question).then((login) => {
        first = login;
      });
    });
    expect(dialog('account-picker')?.textContent).toContain('Remember for o/r');
    act(() => openSignIn());
    await settle();
    expect(first).toBeUndefined();
    let second: string | undefined = 'none yet';
    act(() => {
      void pickAccount(question).then((login) => {
        second = login;
      });
    });
    click(button(dialog('account-picker'), 'Cancel'));
    await settle();
    expect(second).toBeUndefined();
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
    const rows = [...page.querySelectorAll('ul[aria-label="Accounts"] > li')];
    expect(rows.map((row) => row.querySelector('span span')?.textContent)).toEqual([
      'rozed-bot',
      'fieldwork-bot',
      'locked',
    ]);
    expect(rows[0]?.textContent).toContain('Signed in');
    expect(rows[1]?.textContent).toContain('Signed out');
    expect(rows[1]?.textContent).toContain('Import again');
    expect(rows[2]?.textContent).toContain('Needs a keyring');
    expect(page.textContent).toContain('Install or unlock GNOME Keyring or KWallet');
  });
});
