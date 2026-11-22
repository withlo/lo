// @vitest-environment jsdom
// The welcome in a window of its own, with main answered by a stand-in bridge: when it opens and
// over which tab, how its steps are walked, and what each control asks of main and of other
// features.

import { CopyRoute } from '@lo/ui';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry, focusMiddle } from '../../../window/commands/registry.ts';
import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge as install, type FakeBridge } from '../../../window/test/bridge.ts';
import type { AccountSummary, GhAccount } from '../../accounts/contract.ts';
import type { GitInfo } from '../../app/contract.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import { cover, dialogs, type Tab } from '../../tab/window/shared.ts';
import { enter, setScreen, show } from './actions.ts';
import feature from './index.ts';
import { SAMPLE } from './Open.tsx';
import { escapePractice } from './practice.ts';
import { routers } from './routers.ts';
import { welcomeStore, type Step } from './store.ts';

const recent: Tab = { id: 'recent', kind: 'recent' };
const pull: Tab = { id: 'one', kind: 'pull', owner: 'o', repo: 'r', number: 1 };

// The accounts feature's window side is another feature's: the welcome reads the accounts and
// opens its dialogs only through `window/shared.ts`, which this stands in for.
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

// The strip is the tab feature's: the welcome asks it which tabs there are and which is on screen.
const strip = vi.hoisted(() => {
  let value: { tabs: readonly { id: string; kind: string }[]; active: string | undefined } = {
    tabs: [],
    active: undefined,
  };
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set(tabs: readonly { id: string; kind: string }[], active: string | undefined) {
      value = { tabs, active };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('../../tab/window/shared.ts', async (actual) => {
  const { useSyncExternalStore } = await import('react');
  return {
    ...(await actual<typeof TabShared>()),
    useTabs: () => useSyncExternalStore(strip.subscribe, () => strip.get()),
    activeTab: () => strip.get().tabs.find((tab) => tab.id === strip.get().active),
  };
});

/** Tells the welcome what accounts Lo has, as the accounts feature does. */
function showAccounts(list: readonly AccountSummary[] | undefined): void {
  accounts.set(list);
}

/** What the window was asked to copy, as its `CopyRoute` hears it. */
const copied: string[] = [];

/** What main answers each channel with now: the bridge reads it as it is asked. */
const answers: Record<string, (input: unknown) => unknown> = {};
let shared: FakeBridge;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands ?? [], 'mac');
  // The features' clients keep the bridge they were made with, so there is one for the file.
  shared = install(answers);
});

afterEach(() => {
  accounts.set(undefined);
  accounts.signIn.mockClear();
  accounts.importFromGh.mockClear();
  strip.set([], undefined);
  welcomeStore.setState({
    shown: false,
    open: false,
    over: undefined,
    step: 'account',
    finished: undefined,
    git: undefined,
    checking: false,
    checkFailed: false,
    checks: 0,
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

const missing: GitInfo = {
  status: 'missing',
  message: "Lo can't find git.",
  install:
    'Install or update the Xcode Command Line Tools: run `xcode-select --install` in Terminal.',
};

/** Main as the welcome finds it: not finished, no gh, git found, nothing installed. */
function main(given: Readonly<Record<string, (input: unknown) => unknown>> = {}): FakeBridge {
  for (const channel of Object.keys(answers)) delete answers[channel];
  Object.assign(
    answers,
    {
      'welcome.state': () => ({ finished: false }),
      'welcome.finish': () => undefined,
      'accounts.ghAccounts': () => ({ kind: 'missing', message: 'Lo found no gh.' }),
      'open.command': () => ({ installed: [] }),
      'app.info': () => ({ git: { status: 'found', version: '2.54.0' } }),
    },
    given,
  );
  shared.calls.length = 0;
  copied.length = 0;
  return shared;
}

/** Lets every answer main gave, and what follows from it, happen. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 5; turn++) await Promise.resolve();
  });
}

interface Shown {
  /** What the welcome covers: the page under it. */
  under: HTMLElement;
  /** Draws the page again, as `tab`'s. */
  show(tab: Tab): void;
}

/** The welcome's cover over a tab's page, with its dialog, once the feature has started. */
function render(tab: Tab = recent): Shown {
  strip.set([tab], tab.id);
  feature.start?.();
  const host = document.createElement('div');
  host.id = 'root';
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  const draw = (current: Tab) =>
    act(() =>
      root.render(
        <CopyRoute
          copy={(text) => {
            copied.push(text);
            return Promise.resolve();
          }}
        >
          <Slots views={feature.views ?? []}>
            <main data-lo-middle tabIndex={-1}>
              <div id="under" tabIndex={0}>
                Recent pull requests
              </div>
              <Slot slot={cover} props={{ tab: current }} />
            </main>
            <Slot slot={dialogs} props={{}} />
          </Slots>
        </CopyRoute>,
      ),
    );
  draw(tab);
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return { under: document.getElementById('under') ?? host, show: draw };
}

/** A first launch: no account, and the welcome over Recent once main has answered. */
async function first(
  given: Readonly<Record<string, (input: unknown) => unknown>> = {},
): Promise<{ bridge: FakeBridge; shown: Shown }> {
  const bridge = main(given);
  act(() => showAccounts([]));
  const shown = render();
  await settle();
  return { bridge, shown };
}

const screen = () => document.querySelector<HTMLElement>('[data-lo-scope="welcome"]');

/** The step on screen: the one a reader and a key can reach. */
function onScreen(): HTMLElement {
  const steps = screen()?.querySelectorAll<HTMLElement>('[data-welcome-step]') ?? [];
  const found = [...steps].find((each) => !each.hasAttribute('inert'));
  if (!found) throw new Error('No step on screen.');
  return found;
}

const stepOnScreen = () => onScreen().getAttribute('data-welcome-step');

function button(text: string, within: ParentNode = document): HTMLButtonElement {
  const found = [...within.querySelectorAll('button')].find((each) =>
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

async function goTo(step: Step): Promise<void> {
  act(() => welcomeStore.setState({ step }));
  await settle();
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

describe('when it opens', () => {
  it('opens by itself over Recent for a reader with no account, at its first step', async () => {
    const { shown } = await first();
    expect(stepOnScreen()).toBe('account');
    expect(onScreen().querySelector('h1')?.textContent).toBe(
      'Review pull requests from the keyboard',
    );
    expect(onScreen().textContent).toContain('Every action has a key.');
    expect(shown.under.hasAttribute('inert')).toBe(true);
    expect(welcomeStore.getState().shown).toBe(true);
  });

  it('covers Recent with plain ground until Lo knows its accounts and whether it was finished', async () => {
    main();
    render();
    await settle();
    expect(screen()).toBeNull();
    expect(document.querySelector('main > .bg-bg')).not.toBeNull();
    act(() => showAccounts([account('rozed-bot')]));
    expect(screen()).toBeNull();
    expect(document.querySelector('main > .bg-bg')).toBeNull();
  });

  it('stays away once it was finished, and from other tabs', async () => {
    main({ 'welcome.state': () => ({ finished: true }) });
    act(() => showAccounts([]));
    const shown = render();
    await settle();
    expect(screen()).toBeNull();
    expect(shown.under.hasAttribute('inert')).toBe(false);
    act(() => welcomeStore.setState({ finished: false }));
    expect(screen()).not.toBeNull();
    shown.show(pull);
    expect(screen()).toBeNull();
  });

  it('stays through signing in, and says who signed in where the button was', async () => {
    await first();
    act(() => showAccounts([account('rozed-bot')]));
    await settle();
    expect(stepOnScreen()).toBe('account');
    expect(onScreen().textContent).toContain('Signed in as rozed-bot');
    expect(onScreen().textContent).not.toContain('Sign in with GitHub');
    // With nothing left to do here, Continue is the step's main button.
    expect(button('Continue').hasAttribute('data-welcome-default')).toBe(true);
  });

  it('opens again over the tab on screen when asked, and goes with that tab', async () => {
    const bridge = main({ 'welcome.state': () => ({ finished: true }) });
    act(() => showAccounts([account('rozed-bot')]));
    const shown = render(pull);
    await settle();
    expect(screen()).toBeNull();
    act(() => welcomeStore.setState({ step: 'setup' }));
    act(() => show());
    await settle();
    expect(stepOnScreen()).toBe('account');
    expect(welcomeStore.getState().over).toBe('one');
    // Another tab comes to the front: the welcome is over, and isn't waiting under it.
    const other: Tab = { ...pull, id: 'two', number: 2 };
    strip.set([pull, other], 'two');
    shown.show(other);
    await settle();
    expect(screen()).toBeNull();
    expect(welcomeStore.getState().open).toBe(false);
    expect(bridge.calls).toContainEqual(['welcome.finish', undefined]);
  });

  it('is a command to continue only while it is on screen', async () => {
    main();
    const go = feature.commands?.find((command) => command.id === 'welcome.continue');
    expect(go?.handler?.enabled?.({ kind: 'none' })).toBe('The welcome isn’t open');
    act(() => showAccounts([]));
    render();
    await settle();
    expect(go?.handler?.enabled?.({ kind: 'none' })).toBe(true);
  });
});

describe('walking it', () => {
  it('goes on with Continue and back with Back, and says where it is to a screen reader', async () => {
    await first();
    expect(button('Back').disabled).toBe(true);
    click(button('Continue'));
    expect(stepOnScreen()).toBe('keys');
    expect(screen()?.querySelector('[role="status"].sr-only')?.textContent).toBe('Step 2 of 4');
    click(button('Back'));
    expect(stepOnScreen()).toBe('account');
  });

  it('leaves with Skip, keeps that it was finished, and gives the page back its keys', async () => {
    const { bridge, shown } = await first();
    click(button('Skip'));
    await settle();
    expect(screen()).toBeNull();
    expect(bridge.calls).toContainEqual(['welcome.finish', undefined]);
    expect(shown.under.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('ends with Done, and no Skip, on the last step', async () => {
    const { bridge } = await first();
    await goTo('open');
    expect(button('Skip').disabled).toBe(true);
    click(button('Done'));
    await settle();
    expect(screen()).toBeNull();
    expect(bridge.calls).toContainEqual(['welcome.finish', undefined]);
  });

  it('starts each step with focus on its own first control, where Esc brings it back', async () => {
    await first();
    const signIn = button('Sign in with GitHub');
    expect(signIn.textContent).toBe('Sign in with GitHub…⏎');
    expect(document.activeElement).toBe(signIn);
    await goTo('keys');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Practice diff');
    await goTo('setup');
    expect(document.activeElement).toBe(button('Continue'));
    await goTo('open');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pull request link');
    act(() => button('Back').focus());
    act(() => focusMiddle());
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Pull request link');
  });
});

describe('⏎', () => {
  it('signs in on the first step while no account is signed in', async () => {
    await first();
    act(() => screen()?.focus());
    act(() => enter());
    expect(accounts.signIn).toHaveBeenCalledOnce();
    expect(stepOnScreen()).toBe('account');
  });

  it('continues from the steps after, and is Done on the last with the link field empty', async () => {
    const { bridge } = await first();
    await goTo('keys');
    act(() => enter());
    expect(stepOnScreen()).toBe('setup');
    act(() => enter());
    await settle();
    expect(stepOnScreen()).toBe('open');
    act(() => enter());
    await settle();
    expect(screen()).toBeNull();
    expect(bridge.calls).toContainEqual(['welcome.finish', undefined]);
  });

  it('presses the button with focus instead', async () => {
    await first({
      'accounts.ghAccounts': () => ({
        kind: 'found',
        program: '/usr/bin/gh',
        version: '2.62.0',
        accounts: [ghAccount('a'), ghAccount('b')],
      }),
    });
    const importing = button('Import from GitHub CLI');
    act(() => importing.focus());
    act(() => enter());
    expect(accounts.importFromGh).toHaveBeenCalledOnce();
    expect(accounts.signIn).not.toHaveBeenCalled();
  });

  it('opens the link in the field once it holds one', async () => {
    const { bridge } = await first({
      'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }),
    });
    await goTo('open');
    type('https://github.com/rozed-dev/e2e/pull/78');
    act(() => enter());
    await settle();
    expect(bridge.calls).toContainEqual([
      'open.open',
      { text: 'https://github.com/rozed-dev/e2e/pull/78' },
    ]);
  });
});

describe('the first step', () => {
  it('offers GitHub CLI’s accounts when it has some, and says why not when it has none', async () => {
    await first({
      'accounts.ghAccounts': () => ({
        kind: 'found',
        program: '/usr/bin/gh',
        version: null,
        accounts: [],
      }),
    });
    const importing = button('Import from GitHub CLI');
    expect(importing.getAttribute('aria-disabled')).toBe('true');
    expect(importing.getAttribute('aria-description')).toBe('GitHub CLI isn’t signed in');
  });

  it('leaves GitHub CLI out when Lo finds none', async () => {
    await first();
    expect(onScreen().textContent).not.toContain('GitHub CLI');
  });

  it('goes straight to opening a pull request for a reader with no account', async () => {
    await first();
    click(button('Open public pull request'));
    expect(stepOnScreen()).toBe('open');
  });

  it('says what Lo needs of Git and how to get it, and looks again when asked', async () => {
    let looked = false;
    const { bridge } = await first({
      'app.info': () => ({ git: missing }),
      'welcome.checkGit': () => {
        looked = true;
      },
    });
    expect(onScreen().textContent).toContain("Lo can't find git.");
    const code = [...onScreen().querySelectorAll('.code-small')].map((each) => each.textContent);
    expect(code).toContain('xcode-select --install');
    click(button('Check again'));
    await settle();
    expect(looked).toBe(true);
    // Nothing new: a screen reader hears the notice again.
    expect(onScreen().querySelector('[role="status"]')?.textContent).toBe("Lo can't find git.");
    // What Lo finds reaches the window on `app.git`, and the notice goes.
    act(() => bridge.push('app.git', { status: 'found', version: '2.54.0' }));
    expect(onScreen().textContent).not.toContain('Check again');
  });

  it('says so by the button when it couldn’t look for Git', async () => {
    await first({ 'app.info': () => ({ git: missing }) });
    click(button('Check again'));
    await settle();
    expect(onScreen().querySelector('[role="alert"]')?.textContent).toBe('Couldn’t check for Git');
  });
});

/** Presses `key` on the practice diff. */
function press(key: string): void {
  const lines = onScreen().querySelector('[role="listbox"]');
  act(() => {
    lines?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** The practice diff's line the cursor is on. */
const line = () => onScreen().querySelector('[role="option"][aria-selected="true"]')?.textContent;

describe('the keys step', () => {
  it('offers standard keys and Vim keys as cards, standard first', async () => {
    await first();
    await goTo('keys');
    const cards = [...onScreen().querySelectorAll('[role="radio"]')];
    expect(cards.map((card) => card.textContent.slice(0, 8))).toEqual(['Standard', 'Vim keys']);
    expect(cards.map((card) => card.getAttribute('aria-checked'))).toEqual(['true', 'false']);
  });

  it('moves through a practice diff with j and k, and by a click', async () => {
    await first();
    await goTo('keys');
    const start = line();
    press('j');
    expect(line()).not.toBe(start);
    press('k');
    expect(line()).toBe(start);
    const rows = [...onScreen().querySelectorAll('[role="option"]')];
    click(rows[0] ?? document.body);
    expect(rows[0]?.getAttribute('aria-selected')).toBe('true');
    click(button('Line down', onScreen()));
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens a comment box with c that sends nothing, and Esc closes it', async () => {
    const { bridge } = await first();
    await goTo('keys');
    const before = bridge.calls.length;
    press('c');
    const box = onScreen().querySelector<HTMLInputElement>('input');
    expect(box?.placeholder).toBe('Write a comment. Nothing here is sent.');
    expect(document.activeElement).toBe(box);
    // ⏎ in it is the box's own, not Continue.
    act(() => enter());
    expect(stepOnScreen()).toBe('keys');
    let closed = false;
    act(() => {
      closed = escapePractice();
    });
    expect(closed).toBe(true);
    expect(onScreen().querySelector('input')).toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
    expect(bridge.calls).toHaveLength(before);
    // With no box open, Esc is the window's again.
    expect(escapePractice()).toBe(false);
  });
});

describe('the set-up step', () => {
  it('lists the lo command and sending links to Lo, in the slot other features add rows to', async () => {
    await first();
    await goTo('setup');
    const rows = [...onScreen().querySelectorAll('ul > li')];
    expect(rows.map((each) => each.querySelector('.text-ui-strong')?.textContent)).toEqual([
      'lo command',
      'Send pull request links to Lo',
    ]);
    expect(rows[0]?.textContent).toContain('Opens a pull request from a terminal with lo <link>.');
    expect(onScreen().textContent).toContain('Each of these is also in Settings › Integrations.');
  });

  it('installs the lo command through the open feature, and says so where the button was', async () => {
    let installed = false;
    const { bridge } = await first({
      'open.command': () => ({
        installed: installed ? [{ path: '/usr/local/bin/lo', current: true }] : [],
      }),
      'open.installCommand': () => {
        installed = true;
        return { kind: 'installed', path: '/usr/local/bin/lo', onPath: true };
      },
    });
    await goTo('setup');
    click(button('Install', onScreen()));
    await settle();
    expect(bridge.calls).toContainEqual(['open.installCommand', undefined]);
    const row = onScreen().querySelector('ul > li');
    expect(row?.textContent).toContain('Installed');
    expect(row?.querySelector('button')).toBeNull();
  });

  it('shows the rules for each app that opens links, copies one, and opens the documentation', async () => {
    const { bridge } = await first({ 'tab.openExternal': () => undefined });
    await goTo('setup');
    click(button('Show rules'));
    await settle();
    const rules = document.querySelector('[data-testid="link-rules"]');
    expect(rules?.getAttribute('data-lo-scope')).toBe('dialog');
    expect(
      [...(rules?.querySelectorAll('section h3') ?? [])].map((each) => each.textContent),
    ).toEqual(['Finicky 4', 'Velja', 'Choosy']);
    expect(rules?.querySelector('section p .code-small')?.textContent).toBe('handlers');
    expect(rules?.querySelectorAll('section ol > li')).toHaveLength(7);
    const velja = rules?.querySelector('section[aria-label="Velja"]');
    click(button('Copy', velja ?? document));
    await settle();
    expect(copied).toEqual([routers[1]?.rule]);
    expect(velja?.querySelector('[role="status"]')?.textContent).toBe('Copied');
    click(button('Open documentation'));
    await settle();
    expect(bridge.calls).toContainEqual([
      'tab.openExternal',
      { url: 'https://github.com/withlo/lo/blob/main/docs/link-routers.md' },
    ]);
    click(button('Done', rules ?? document));
    await settle();
    expect(document.querySelector('[data-testid="link-rules"]')).toBeNull();
  });
});

describe('opening a pull request', () => {
  it('opens the field’s link through the open feature, and the welcome is over', async () => {
    const { bridge } = await first({
      'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }),
    });
    await goTo('open');
    expect(button('Open', onScreen()).disabled).toBe(true);
    type('  https://github.com/rozed-dev/e2e/pull/78 ');
    click(button('Open', onScreen()));
    await settle();
    expect(bridge.calls).toContainEqual([
      'open.open',
      { text: 'https://github.com/rozed-dev/e2e/pull/78' },
    ]);
    expect(bridge.calls).toContainEqual(['welcome.finish', undefined]);
    expect(welcomeStore.getState().open).toBe(false);
  });

  it('says why a link didn’t open, keeps it, and stays', async () => {
    await first({
      'open.open': () => ({ kind: 'refused', message: 'That isn’t a link Lo opens.' }),
    });
    await goTo('open');
    const field = type('owner/repo#1');
    click(button('Open', onScreen()));
    await settle();
    expect(onScreen().querySelector('[role="alert"]')?.textContent).toBe(
      'That isn’t a link Lo opens.',
    );
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.value).toBe('owner/repo#1');
    expect(stepOnScreen()).toBe('open');
    // Changing the text takes the reason away.
    type('owner/repo#12');
    expect(onScreen().querySelector('[role="alert"]')).toBeNull();
  });

  it('says so when main couldn’t be asked', async () => {
    await first();
    await goTo('open');
    type('https://github.com/rozed-dev/e2e/pull/78');
    click(button('Open', onScreen()));
    await settle();
    expect(onScreen().querySelector('[role="alert"]')?.textContent).toBe('Couldn’t open the link');
  });

  it('pastes the pull request link on the clipboard and opens it, or says there’s none', async () => {
    let held: string | null = null;
    const { bridge } = await first({
      'open.clipboard': () => held,
      'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }),
    });
    await goTo('open');
    click(button('Paste link'));
    await settle();
    expect(onScreen().querySelector('[role="alert"]')?.textContent).toBe(
      'No pull request link on the clipboard',
    );
    held = 'https://github.com/rozed-dev/e2e/pull/78';
    click(button('Paste link'));
    await settle();
    expect(bridge.calls).toContainEqual(['open.open', { text: held }]);
  });

  it('opens a sample pull request of Lo’s own', async () => {
    const { bridge } = await first({
      'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }),
    });
    await goTo('open');
    const sample = onScreen().querySelector('ul[aria-label="Sample pull request"] > li');
    expect(sample?.textContent).toContain('withlo/lo #182');
    click(button('Open', sample ?? document));
    await settle();
    expect(bridge.calls).toContainEqual(['open.open', { text: SAMPLE.link }]);
  });
});
