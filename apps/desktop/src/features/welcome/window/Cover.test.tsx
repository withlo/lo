// @vitest-environment jsdom
// The welcome screen in a window of its own, with main answered by a stand-in bridge: when it
// covers the Recent tab, what it offers, and what each control asks of main and of other features.

import { handlers } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry, focusMiddle } from '../../../window/commands/registry.ts';
import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge as install, type FakeBridge } from '../../../window/test/bridge.ts';
import type { AccountSummary, GhAccount } from '../../accounts/contract.ts';
import type { GitInfo } from '../../app/contract.ts';
import { cover, dialogs, type Tab } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { enter, setScreen } from './actions.ts';
import feature from './index.ts';
import { routers } from './routers.ts';
import { welcomeStore } from './store.ts';

const recent: Tab = { id: 'recent', kind: 'recent' };

// The accounts feature's window side is another feature's: the screen reads the accounts and opens
// its dialogs only through `window/shared.ts`, which this stands in for.
const accounts = vi.hoisted(() => {
  let value: readonly AccountSummary[] | undefined;
  const listeners = new Set<() => void>();
  return {
    get: (): readonly AccountSummary[] | undefined => value,
    set(next: readonly AccountSummary[] | undefined) {
      value = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    signIn: vi.fn<() => void>(),
    importFromGh: vi.fn<() => void>(),
  };
});

vi.mock('../../accounts/window/shared.ts', async () => {
  const { useSyncExternalStore } = await import('react');
  return {
    useAccounts: () => useSyncExternalStore(accounts.subscribe, () => accounts.get()),
    signIn: accounts.signIn,
    importFromGh: accounts.importFromGh,
  };
});

/** Tells the screen what accounts Lo has, as the accounts feature does. */
function showAccounts(list: readonly AccountSummary[] | undefined): void {
  accounts.set(list);
}

/** What main answers each channel with now: the bridge reads it as it is asked. */
const answers: Record<string, (input: unknown) => unknown> = {};
let shared: FakeBridge;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(handlers(keys, { signIn: { run: enter } }), 'mac');
  // The features' clients keep the bridge they were made with, so there is one for the file.
  shared = install(answers);
});

afterEach(() => {
  accounts.set(undefined);
  accounts.signIn.mockClear();
  accounts.importFromGh.mockClear();
  welcomeStore.setState({
    shown: false,
    git: undefined,
    checking: false,
    checked: false,
    gh: undefined,
    rules: false,
  });
  setScreen(undefined);
});

const account = (login: string, changes: Partial<AccountSummary> = {}): AccountSummary => ({
  login,
  name: null,
  source: 'deviceFlow',
  signedOut: null,
  cantSave: false,
  needsKeyring: false,
  ...changes,
});

const ghAccount = (login: string): GhAccount => ({
  login,
  active: true,
  usable: true,
  state: 'success',
  scopes: ['repo', 'read:org', 'workflow'],
  missing: [],
  shortLived: false,
  inLo: false,
});

/** What gh has to import, without a version it would say. */
const listing = (list: GhAccount[]) => ({
  kind: 'found',
  program: '/usr/bin/gh',
  version: null,
  accounts: list,
});

const missing: GitInfo = {
  status: 'missing',
  message: "Lo can't find git.",
  install:
    'Install or update the Xcode Command Line Tools: run `xcode-select --install` in Terminal.',
};

/** Main as the screen finds it: no gh, git found, nothing installed, and no account. */
function main(given: Readonly<Record<string, (input: unknown) => unknown>> = {}): FakeBridge {
  for (const channel of Object.keys(answers)) delete answers[channel];
  Object.assign(
    answers,
    {
      'accounts.ghAccounts': () => ({ kind: 'missing', message: 'Lo found no gh.' }),
      'open.command': () => ({ installed: [] }),
      'app.info': () => ({ git: { status: 'found', version: '2.54.0' } }),
    },
    given,
  );
  shared.calls.length = 0;
  return shared;
}

/** Lets every answer main gave, and what follows from it, happen. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  });
}

interface Shown {
  /** What the screen covers: the page under it. */
  under: HTMLElement;
  /** Draws the screen again over `tab`. */
  show(tab: Tab): void;
}

/** The screen over a page, in the window's middle, with its dialog, once the feature has started. */
function render(tab: Tab = recent): Shown {
  feature.start?.();
  const host = document.createElement('div');
  host.id = 'root';
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  const draw = (current: Tab) =>
    act(() =>
      root.render(
        <Slots views={feature.views ?? []}>
          <main data-lo-middle tabIndex={-1}>
            <div id="under" tabIndex={0}>
              Recent pull requests
            </div>
            <Slot slot={cover} props={{ tab: current }} />
          </main>
          <Slot slot={dialogs} props={{}} />
        </Slots>,
      ),
    );
  draw(tab);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { under: document.getElementById('under') ?? host, show: draw };
}

const screen = () => document.querySelector<HTMLElement>('[data-lo-scope="welcome"]');

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}".`);
  return found;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Types `text` in the link field, as a person does. */
function type(text: string): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>('input[aria-label="Pull request link"]');
  if (!field) throw new Error('No link field.');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
  return field;
}

describe('when it shows', () => {
  it('covers the Recent tab while no account is signed in', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    expect(screen()).not.toBeNull();
    expect(document.querySelector('h1')?.textContent).toBe(
      'Review pull requests from the keyboard.',
    );
    expect(screen()?.textContent).toContain(
      'Lo reads whole stacks, shows the overviews your coding agent writes, and has a key for every action.',
    );
    expect(screen()?.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe('Lo');
  });

  it('shows again when every account has been signed out', async () => {
    main();
    act(() => showAccounts([account('rozed-bot', { signedOut: 'refused' })]));
    render();
    await settle();
    expect(screen()).not.toBeNull();
  });

  it('stays away while an account is signed in, before Lo has heard of its accounts, and from other tabs', async () => {
    main();
    const shown = render();
    await settle();
    expect(screen()).toBeNull();
    act(() => showAccounts([account('rozed-bot')]));
    expect(screen()).toBeNull();
    act(() => showAccounts([]));
    expect(screen()).not.toBeNull();
    for (const tab of [
      { id: 'settings', kind: 'settings' },
      { id: 'one', kind: 'pull', owner: 'o', repo: 'r', number: 1 },
    ] satisfies Tab[]) {
      shown.show(tab);
      expect(screen()).toBeNull();
    }
    expect(shown.under.hasAttribute('inert')).toBe(false);
  });

  it('goes once an account signs in, and gives the page under it back its keys', async () => {
    main();
    act(() => showAccounts([]));
    const shown = render();
    await settle();
    expect(shown.under.hasAttribute('inert')).toBe(true);
    expect(welcomeStore.getState().shown).toBe(true);
    act(() => showAccounts([account('rozed-bot')]));
    await settle();
    expect(screen()).toBeNull();
    expect(shown.under.hasAttribute('inert')).toBe(false);
    expect(welcomeStore.getState().shown).toBe(false);
    // Focus the screen had comes back to the page, which is the middle again.
    expect(document.activeElement).toBe(document.querySelector('main'));
  });
});

describe('signing in', () => {
  it('has focus on "Sign in with GitHub", with its key, and starts the device flow', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    const signIn = button('Sign in with GitHub');
    expect(signIn.textContent).toBe('Sign in with GitHub⏎');
    expect(document.activeElement).toBe(signIn);
    click(signIn);
    await settle();
    expect(accounts.signIn).toHaveBeenCalledOnce();
  });

  it('is what ⏎ does with focus on the screen itself', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    act(() => screen()?.focus());
    act(() => enter());
    await settle();
    expect(accounts.signIn).toHaveBeenCalledOnce();
  });

  it('is a command only while the screen is up', async () => {
    main();
    const signIn = feature.commands?.find((command) => command.id === 'welcome.signIn');
    expect(signIn?.handler?.enabled?.({ kind: 'none' })).toBe('Lo is signed in to GitHub.');
    act(() => showAccounts([]));
    render();
    await settle();
    expect(signIn?.handler?.enabled?.({ kind: 'none' })).toBe(true);
    act(() => showAccounts([account('rozed-bot')]));
    await settle();
    expect(signIn?.handler?.enabled?.({ kind: 'none' })).toBe('Lo is signed in to GitHub.');
  });
});

describe('⏎', () => {
  it('presses the button with focus instead of signing in', async () => {
    main({
      'accounts.ghAccounts': () => ({
        kind: 'found',
        program: '/usr/bin/gh',
        version: '2.62.0',
        accounts: [ghAccount('a'), ghAccount('b')],
      }),
    });
    act(() => showAccounts([]));
    render();
    await settle();
    const importing = button('Import from gh');
    act(() => importing.focus());
    act(() => enter());
    await settle();
    expect(accounts.importFromGh).toHaveBeenCalledOnce();
    expect(accounts.signIn).not.toHaveBeenCalled();
  });

  it('opens the link in the field, and signs in nowhere else', async () => {
    const bridge = main({ 'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }) });
    act(() => showAccounts([]));
    render();
    await settle();
    const field = type('https://github.com/rozed-dev/e2e/pull/78');
    act(() => field.focus());
    act(() => enter());
    await settle();
    expect(bridge.calls).toContainEqual([
      'open.open',
      { text: 'https://github.com/rozed-dev/e2e/pull/78' },
    ]);
    expect(accounts.signIn).not.toHaveBeenCalled();
  });
});

describe('importing from gh', () => {
  it('is offered with gh’s account count when gh is found, and opens the import dialog', async () => {
    main({
      'accounts.ghAccounts': () => ({
        kind: 'found',
        program: '/usr/bin/gh',
        version: '2.62.0',
        accounts: [ghAccount('a'), ghAccount('b')],
      }),
    });
    act(() => showAccounts([]));
    render();
    await settle();
    expect(screen()?.textContent).toContain('gh 2.62.0 is signed in to 2 accounts');
    click(button('Import from gh'));
    expect(accounts.importFromGh).toHaveBeenCalledOnce();
  });

  it('says so when gh has one account, or none', async () => {
    main({ 'accounts.ghAccounts': () => listing([ghAccount('a')]) });
    act(() => showAccounts([]));
    render();
    await settle();
    expect(screen()?.textContent).toContain('gh is signed in to 1 account');
    expect(screen()?.textContent).not.toContain('1 accounts');
  });

  it('is left out when Lo finds no gh, or can’t run it', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    expect([...document.querySelectorAll('button')].map((each) => each.textContent)).not.toContain(
      'Import from gh',
    );
  });
});

describe('the public pull request box', () => {
  it('opens a link through the open feature, and clears the box', async () => {
    const bridge = main({ 'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }) });
    act(() => showAccounts([]));
    render();
    await settle();
    expect(button('Open').disabled).toBe(true);
    const field = type('  https://github.com/rozed-dev/e2e/pull/78 ');
    expect(button('Open').disabled).toBe(false);
    click(button('Open'));
    await settle();
    expect(bridge.calls).toContainEqual([
      'open.open',
      { text: 'https://github.com/rozed-dev/e2e/pull/78' },
    ]);
    expect(field.value).toBe('');
  });

  it('says why a link did not open, and keeps it', async () => {
    main({ 'open.open': () => ({ kind: 'refused', message: 'That isn’t a link Lo opens.' }) });
    act(() => showAccounts([]));
    render();
    await settle();
    const field = type('owner/repo#1');
    click(button('Open'));
    await settle();
    expect(screen()?.querySelector('[role="alert"]')?.textContent).toBe(
      'That isn’t a link Lo opens.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.value).toBe('owner/repo#1');
    // Changing the text takes the note away.
    type('owner/repo#12');
    expect(screen()?.querySelector('[role="alert"]')).toBeNull();
  });

  it('says so when main could not be asked', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    type('https://github.com/rozed-dev/e2e/pull/78');
    click(button('Open'));
    await settle();
    expect(screen()?.querySelector('[role="alert"]')?.textContent).toBe(
      "Lo couldn't open the link.",
    );
  });
});

describe('git’s notice', () => {
  it('says what Lo needs and how to get it, with "Check again", when git is missing', async () => {
    main({ 'app.info': () => ({ git: missing }) });
    act(() => showAccounts([]));
    render();
    await settle();
    const notice = screen()?.textContent ?? '';
    expect(notice).toContain("Lo can't find git.");
    expect(notice).toContain('xcode-select --install');
    const code = [...(screen()?.querySelectorAll('.code-small') ?? [])].map(
      (each) => each.textContent,
    );
    expect(code).toContain('xcode-select --install');
    expect(button('Check again')).toBeDefined();
  });

  it('is left out while Lo looks, and when it has found git', async () => {
    main({ 'app.info': () => ({ git: { status: 'checking' } }) });
    act(() => showAccounts([]));
    render();
    await settle();
    expect(screen()?.textContent).not.toContain('Check again');
    act(() => welcomeStore.setState({ git: { status: 'found', version: '2.54.0' } }));
    expect(screen()?.textContent).not.toContain('Check again');
  });

  it('is shown for a git that is too old, with what Lo said of it', async () => {
    main({
      'app.info': () => ({
        git: {
          status: 'tooOld',
          version: '2.30.0',
          check: 'version',
          message: 'Lo needs git 2.41.0 or newer.',
          install: 'Install a newer git.',
        },
      }),
    });
    act(() => showAccounts([]));
    render();
    await settle();
    expect(screen()?.textContent).toContain('Lo needs git 2.41.0 or newer. Install a newer git.');
  });

  it('looks again through main, and goes once git is found', async () => {
    let found = false;
    const bridge = main({
      'app.info': () => ({ git: missing }),
      'welcome.checkGit': () => {
        found = true;
      },
    });
    act(() => showAccounts([]));
    render();
    await settle();
    click(button('Check again'));
    expect(button('Check again').disabled).toBe(true);
    await settle();
    expect(found).toBe(true);
    expect(bridge.calls).toContainEqual(['welcome.checkGit', undefined]);
    expect(screen()?.querySelector('[role="status"]')?.textContent).toBe(
      'Lo looked again and still can’t find a git it can use.',
    );
    expect(button('Check again').disabled).toBe(false);
    // What Lo finds reaches the window on `app.git`.
    act(() => bridge.push('app.git', { status: 'found', version: '2.54.0' }));
    expect(screen()?.textContent).not.toContain('Check again');
  });

  it('follows what Lo finds on its own', async () => {
    const bridge = main({ 'app.info': () => ({ git: { status: 'checking' } }) });
    act(() => showAccounts([]));
    render();
    await settle();
    act(() => bridge.push('app.git', missing));
    expect(screen()?.textContent).toContain("Lo can't find git.");
  });
});

describe('the optional steps', () => {
  it('lists installing the lo command, and sending PR links to Lo, in the slot', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    const steps = [...document.querySelectorAll('[aria-label="Optional steps"] > li')];
    expect(steps.map((each) => each.querySelector('.text-ui-strong')?.textContent)).toEqual([
      'Install the lo command',
      'Send PR links to Lo',
    ]);
    expect(steps[0]?.textContent).toContain(
      'Review a pull request from a terminal with lo <link>.',
    );
    expect(steps[1]?.textContent).toContain('Your browser stays the default.');
    expect(screen()?.textContent).not.toContain('overview skill');
  });

  it('installs the lo command through the open feature', async () => {
    let installed = false;
    const bridge = main({
      'open.command': () => ({
        installed: installed ? [{ path: '/usr/local/bin/lo', current: true }] : [],
      }),
      'open.installCommand': () => {
        installed = true;
        return { kind: 'installed', path: '/usr/local/bin/lo', onPath: true };
      },
    });
    act(() => showAccounts([]));
    render();
    await settle();
    click(button('Install'));
    await settle();
    expect(bridge.calls).toContainEqual(['open.installCommand', undefined]);
    expect(button('Installed').disabled).toBe(true);
  });

  it('opens the rules for Finicky, Velja and Choosy, and copies one', async () => {
    const bridge = main({ 'tab.copy': () => undefined, 'tab.openExternal': () => undefined });
    act(() => showAccounts([]));
    render();
    await settle();
    click(button('Set up'));
    await settle();
    const rules = document.querySelector('[data-testid="link-rules"]');
    expect(rules?.getAttribute('data-lo-scope')).toBe('dialog');
    expect(
      [...(rules?.querySelectorAll('section h3') ?? [])].map((each) => each.textContent),
    ).toEqual(['Finicky', 'Velja', 'Choosy']);
    expect(rules?.textContent).toContain('~/.finicky.js');
    const copy = rules?.querySelector<HTMLButtonElement>('[aria-label="Copy the rule for Velja"]');
    if (!copy) throw new Error('No copy button.');
    click(copy);
    await settle();
    expect(bridge.calls).toContainEqual(['tab.copy', { text: routers[1]?.rule }]);
    // The dialog says it, since a note under its scrim can't be seen or heard.
    expect(copy.textContent).toBe('Copied');
    expect(rules?.querySelector('[role="status"]')?.textContent).toBe('Copied the rule for Velja.');
    click(button('Read the docs'));
    await settle();
    expect(bridge.calls).toContainEqual([
      'tab.openExternal',
      { url: 'https://github.com/withlo/lo/blob/main/docs/link-routers.md' },
    ]);
    click(button('Done'));
    await settle();
    expect(document.querySelector('[data-testid="link-rules"]')).toBeNull();
  });
});

describe('Esc', () => {
  it('gives focus back to the screen’s default action, not to the page under it', async () => {
    main();
    act(() => showAccounts([]));
    render();
    await settle();
    act(() => type('x').focus());
    act(() => focusMiddle());
    expect(document.activeElement).toBe(button('Sign in with GitHub'));
  });
});
