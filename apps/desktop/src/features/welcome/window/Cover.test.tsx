// @vitest-environment jsdom
// The welcome in a window of its own, with main answered by a stand-in bridge: when it opens and
// over which tab, how its steps are walked, and what each control asks of main and of other
// features.

import { CopyRoute, SegmentedControl, SetupItem, Switch } from '@lo/ui';
import { holdRegistry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notices } from '../../../window/commands/notices.tsx';
import { createRegistry, focusMiddle } from '../../../window/commands/registry.ts';
import { defineView, Slot, Slots } from '../../../window/slots.tsx';
import { installBridge as install, type FakeBridge } from '../../../window/test/bridge.ts';
import type { AccountSummary, GhAccount } from '../../accounts/contract.ts';
import type { GitInfo } from '../../app/contract.ts';
import type * as OverviewShared from '../../overview/window/shared.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import { cover, dialogs, type Tab } from '../../tab/window/shared.ts';
import { enter, setScreen, show } from './actions.ts';
import feature from './index.ts';
import { SAMPLE } from './Open.tsx';
import { practiceEscape } from './practice.ts';
import { routers } from './routers.ts';
import { overviewRows } from './shared.ts';
import { welcomeStore, type Step } from './store.ts';

const recent: Tab = { id: 'recent', kind: 'recent' };
const pull: Tab = { id: 'one', kind: 'pull', owner: 'o', repo: 'r', number: 1 };

// The accounts feature's window side is another feature's: the welcome reads the accounts and
// opens its dialogs only through `window/shared.ts`, which this stands in for.
const accounts = vi.hoisted(() => {
  let value: readonly AccountSummary[] | undefined;
  let failed = false;
  const listeners = new Set<() => void>();
  return {
    get: (): readonly AccountSummary[] | undefined => value,
    set(next: readonly AccountSummary[] | undefined) {
      value = next;
      failed = false;
      for (const listener of listeners) listener();
    },
    /** Main couldn't be asked for the accounts. */
    fail() {
      failed = true;
      for (const listener of listeners) listener();
    },
    unlisted: (): boolean => failed,
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
    useAccountsHeard: () =>
      useSyncExternalStore(
        accounts.subscribe,
        () => accounts.get() !== undefined || accounts.unlisted(),
      ),
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

// Whether there are overviews is the overview feature's, which the last step's sample follows.
const overviewsOn = vi.hoisted(() => {
  let on = true;
  const listeners = new Set<() => void>();
  return {
    now: () => on,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next: boolean) {
      on = next;
      for (const listener of listeners) listener();
    },
  };
});

vi.mock('../../overview/window/shared.ts', async (actual) => ({
  ...(await actual<typeof OverviewShared>()),
  overviews: { now: overviewsOn.now, subscribe: overviewsOn.subscribe },
}));

// The overviews step's rows are the overview feature's and the tab feature's, each its own
// setting's: stand-ins here, with the controls each has, in the slot as each puts its row there.
const pressedRows = { toggled: [] as boolean[], chosen: [] as string[] };
const ROWS = [
  defineView(overviewRows, {
    id: 'overview.onRow',
    order: 10,
    render: () => (
      <SetupItem title="Show overviews" description="Turn off to take them out.">
        <Switch
          checked
          aria-label="Show overviews"
          onCheckedChange={(next) => pressedRows.toggled.push(next)}
        />
      </SetupItem>
    ),
  }),
  defineView(overviewRows, {
    id: 'tab.openOnRow',
    order: 20,
    render: () => (
      <SetupItem title="Open pull requests on" description="Where a tab opens.">
        <SegmentedControl
          label="Open pull requests on"
          kind="choice"
          size="sm"
          items={[
            { value: 'overview', label: 'Overview' },
            { value: 'timeline', label: 'Timeline' },
          ]}
          value="overview"
          onChange={(next) => pressedRows.chosen.push(next)}
        />
      </SetupItem>
    ),
  }),
];

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
  // jsdom has no fonts, no resize observer and no layout: the practice's comment box needs only
  // that they exist.
  if (!('fonts' in document)) {
    Object.defineProperty(document, 'fonts', {
      value: { addEventListener() {}, removeEventListener() {} },
    });
  }
  if (!('getClientRects' in Range.prototype)) {
    Object.defineProperty(Range.prototype, 'getClientRects', { value: () => [] });
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { value: () => new DOMRect() });
  }
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
  // The foot's Back is its command's control, as the window holds the registry for controls.
  holdRegistry(createRegistry(feature.commands ?? [], 'mac'));
  // The features' clients keep the bridge they were made with, so there is one for the file.
  shared = install(answers);
});

afterEach(() => {
  accounts.set(undefined);
  accounts.signIn.mockClear();
  accounts.importFromGh.mockClear();
  strip.set([], undefined);
  overviewsOn.set(true);
  welcomeStore.setState({
    shown: false,
    open: false,
    over: undefined,
    touched: false,
    step: 'account',
    finished: undefined,
    git: undefined,
    checking: false,
    checkFailed: undefined,
    checks: 0,
    gh: undefined,
    rules: false,
    linked: false,
    played: [],
    choosing: {},
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
  install: { commands: ['xcode-select --install'], page: null },
};

/** Main as the welcome finds it: not finished, no gh, git found, nothing installed. */
function main(given: Readonly<Record<string, (input: unknown) => unknown>> = {}): FakeBridge {
  for (const channel of Object.keys(answers)) delete answers[channel];
  Object.assign(
    answers,
    {
      'welcome.state': () => ({ finished: false }),
      'welcome.finish': () => undefined,
      'accounts.ghAccounts': () => ({ kind: 'missing' }),
      'open.command': () => ({ installed: [] }),
      'app.info': () => ({ git: { status: 'found', version: '2.54.0' }, nonce: '' }),
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
          <Slots views={[...(feature.views ?? []), ...ROWS]}>
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

  it('opens all the same when main couldn’t list the accounts', async () => {
    main();
    render();
    await settle();
    expect(screen()).toBeNull();
    act(() => accounts.fail());
    await settle();
    expect(stepOnScreen()).toBe('account');
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
    // The reader pressed ⏎ on the button, which is how the account came.
    act(() => {
      button('Sign in with GitHub').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
      );
    });
    act(() => showAccounts([account('rozed-bot')]));
    await settle();
    expect(stepOnScreen()).toBe('account');
    expect(onScreen().textContent).toContain('Signed in as rozed-bot');
    expect(onScreen().textContent).not.toContain('Sign in with GitHub');
    // With nothing left to do here, Continue is the step's main button.
    expect(button('Continue').hasAttribute('data-welcome-default')).toBe(true);
  });

  it('goes when an account signs in before the reader has touched it', async () => {
    const { bridge, shown } = await first();
    act(() => showAccounts([account('rozed-bot')]));
    await settle();
    expect(screen()).toBeNull();
    expect(shown.under.hasAttribute('inert')).toBe(false);
    // It wasn't finished: nothing was kept.
    expect(bridge.calls).not.toContainEqual(['welcome.finish', undefined]);
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
    // Back is dimmed on the first step, with nothing to say: there's no step before.
    expect(button('Back').getAttribute('aria-disabled')).toBe('true');
    click(button('Continue'));
    expect(stepOnScreen()).toBe('look');
    // The dots' own region, beside them.
    expect(screen()?.querySelector('[role="img"] + [role="status"].sr-only')?.textContent).toBe(
      'Step 2 of 6',
    );
    click(button('Back'));
    expect(stepOnScreen()).toBe('account');
  });

  it('goes back with ⇧⏎, which has nothing to do on the first step', async () => {
    await first();
    const back = feature.commands?.find((command) => command.id === 'welcome.back');
    expect(back?.handler?.enabled?.({ kind: 'none' })).toBe('');
    await goTo('keys');
    expect(back?.handler?.enabled?.({ kind: 'none' })).toBe(true);
    act(() => {
      void back?.handler?.run({ kind: 'none' });
    });
    expect(stepOnScreen()).toBe('look');
  });

  it('starts each step at its top, wherever the step before was scrolled to', async () => {
    await first();
    await goTo('look');
    const pane = screen()?.firstElementChild;
    if (!(pane instanceof HTMLElement)) throw new Error('No steps pane.');
    pane.scrollTop = 120;
    click(button('Continue'));
    expect(stepOnScreen()).toBe('keys');
    expect(pane.scrollTop).toBe(0);
  });

  it('marks the steps done, the one on screen and the rest, each drawn as its own', async () => {
    await first();
    await goTo('setup');
    const balls = [
      ...(screen()?.querySelectorAll('[role="img"][aria-label^="Step"] > span') ?? []),
    ];
    expect(balls.map((ball) => ball.getAttribute('data-ball'))).toEqual([
      'done',
      'done',
      'done',
      'done',
      'here',
      'ahead',
    ]);
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
    await goTo('look');
    // The theme's chosen card, so the arrows choose at once.
    expect(document.activeElement?.getAttribute('role')).toBe('radio');
    expect(document.activeElement?.closest('[role="radiogroup"]')?.getAttribute('aria-label')).toBe(
      'Theme',
    );
    expect(document.activeElement?.getAttribute('aria-checked')).toBe('true');
    await goTo('keys');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Practice diff');
    // Not the switch, so ⏎ never turns overviews off.
    await goTo('overviews');
    expect(document.activeElement).toBe(button('Continue'));
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
    await goTo('look');
    act(() => enter());
    expect(stepOnScreen()).toBe('keys');
    act(() => enter());
    expect(stepOnScreen()).toBe('overviews');
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

  it('continues from a card with focus, which the arrows and Space choose', async () => {
    const { bridge } = await first();
    await goTo('look');
    const card = document.activeElement;
    expect(card?.getAttribute('role')).toBe('radio');
    act(() => enter());
    expect(stepOnScreen()).toBe('keys');
    await settle();
    expect(bridge.calls.some(([channel]) => channel === 'settings.set')).toBe(false);
  });

  it('presses the switch or the segment with focus, and goes on from neither', async () => {
    pressedRows.toggled.length = 0;
    pressedRows.chosen.length = 0;
    await first();
    await goTo('overviews');
    const toggle = onScreen().querySelector<HTMLElement>('[role="switch"]');
    act(() => toggle?.focus());
    expect(document.activeElement).toBe(toggle);
    act(() => enter());
    expect(pressedRows.toggled).toEqual([false]);
    expect(stepOnScreen()).toBe('overviews');
    const timeline = [...onScreen().querySelectorAll<HTMLElement>('[role="radio"]')].find(
      (each) => each.textContent === 'Timeline',
    );
    act(() => timeline?.focus());
    act(() => enter());
    expect(pressedRows.chosen).toEqual(['timeline']);
    expect(stepOnScreen()).toBe('overviews');
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
    expect(onScreen().textContent).toContain('Can’t find Git');
    const code = [...onScreen().querySelectorAll('.code-small')].map((each) => each.textContent);
    expect(code).toContain('xcode-select --install');
    click(button('Check again'));
    await settle();
    expect(looked).toBe(true);
    // Nothing new: a screen reader hears the notice again.
    const said = [...onScreen().querySelectorAll('[role="status"]')].map(
      (each) => each.textContent,
    );
    expect(said).toContain('Can’t find Git');
    // What Lo finds reaches the window on `app.git`, and the notice goes.
    act(() => bridge.push('app.git', { status: 'found', version: '2.54.0' }));
    expect(onScreen().textContent).not.toContain('Check again');
  });

  it('says under the notice when it couldn’t look for Git, with main’s words', async () => {
    let fails = true;
    await first({
      'app.info': () => ({ git: missing }),
      'welcome.checkGit': () => {
        if (fails) throw new Error('No answer');
      },
    });
    click(button('Check again'));
    await settle();
    const alert = onScreen().querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('Couldn’t check for Git');
    // How to get Git stays, and so does the button that looks again.
    expect(onScreen().textContent).toContain('Can’t find Git');
    const code = [...onScreen().querySelectorAll('.code-small')].map((each) => each.textContent);
    expect(code).toContain('xcode-select --install');
    const buttons = [...onScreen().querySelectorAll('button')].map((each) => each.textContent);
    expect(buttons.some((each) => each.startsWith('Try again'))).toBe(false);
    fails = false;
    click(button('Check again'));
    await settle();
    expect(onScreen().querySelector('[role="alert"]')).toBeNull();
    expect(onScreen().textContent).toContain('Can’t find Git');
  });

  it('unmelds the mark as it opens, and draws it at rest when the reader comes back', async () => {
    await first();
    // The mark at rest is the one a screen reader would name, kept from it here.
    expect(onScreen().querySelector('svg[aria-label="Lo"]')).toBeNull();
    click(button('Continue'));
    click(button('Back'));
    await settle();
    expect(stepOnScreen()).toBe('account');
    expect(onScreen().querySelector('svg[aria-label="Lo"]')).not.toBeNull();
  });
});

/** The look step's groups of cards, by name, each with its cards' names and which is chosen. */
function groups(): { name: string | null; cards: string[]; chosen: string | undefined }[] {
  return [...onScreen().querySelectorAll('[role="radiogroup"]')].map((group) => {
    const cards = [...group.querySelectorAll('[role="radio"]')];
    return {
      name: group.getAttribute('aria-label'),
      cards: cards.map((card) => card.textContent),
      chosen: cards.find((card) => card.getAttribute('aria-checked') === 'true')?.textContent,
    };
  });
}

/** Presses `key` where focus is, as a person does. */
function pressKey(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

/** The card with focus: its group's name and its own. */
const focused = () => ({
  group: document.activeElement?.closest('[role="radiogroup"]')?.getAttribute('aria-label'),
  card: document.activeElement?.textContent,
});

/** What the window asked main to write to the settings file, in order. */
const writes = (bridge: FakeBridge) =>
  bridge.calls.filter(([channel]) => channel === 'settings.set').map(([, input]) => input);

describe('the look step', () => {
  it('offers the theme and the diff’s layout as cards, named by their settings, with their places', async () => {
    await first();
    await goTo('look');
    expect(onScreen().querySelector('h1')?.textContent).toBe('Choose how Lo looks');
    expect(onScreen().textContent).toContain('Each choice takes effect at once.');
    // Nothing on file: each setting's default is chosen.
    expect(groups()).toEqual([
      { name: 'Theme', cards: ['Dark', 'Light', 'System'], chosen: 'System' },
      { name: 'Diff layout', cards: ['Side by side', 'Inline'], chosen: 'Side by side' },
    ]);
    expect(onScreen().textContent).toContain('Settings › Appearance');
    expect(onScreen().textContent).toContain('Settings › Pull requests');
    // Each card has its picture, which a screen reader skips.
    const pictures = onScreen().querySelectorAll('[role="radio"] [aria-hidden="true"].rounded-sm');
    expect(pictures).toHaveLength(5);
  });

  it('writes a card as it’s pressed, showing it until the file has it', async () => {
    const landing: (() => void)[] = [];
    const { bridge } = await first({
      'settings.set': () =>
        new Promise<void>((resolve) => {
          landing.push(resolve);
        }),
    });
    await goTo('look');
    const light = [...onScreen().querySelectorAll('[role="radio"]')][1];
    click(light ?? document.body);
    expect(groups()[0]?.chosen).toBe('Light');
    await settle();
    expect(writes(bridge)).toEqual([{ key: 'theme', value: 'light' }]);
    expect(welcomeStore.getState().choosing).toEqual({ theme: 'light' });
    for (const land of landing) land();
    await settle();
    expect(welcomeStore.getState().choosing).toEqual({});
  });

  it('chooses along a group with ← and →, and goes between groups with ↑ and ↓, choosing nothing', async () => {
    const { bridge } = await first({ 'settings.set': () => undefined });
    await goTo('look');
    expect(focused()).toEqual({ group: 'Theme', card: 'System' });
    // Round the end, to the first.
    pressKey('l');
    expect(focused()).toEqual({ group: 'Theme', card: 'Dark' });
    expect(groups()[0]?.chosen).toBe('Dark');
    pressKey('ArrowLeft');
    expect(focused()).toEqual({ group: 'Theme', card: 'System' });
    await settle();
    pressKey('j');
    expect(focused()).toEqual({ group: 'Diff layout', card: 'Side by side' });
    // Nothing past the last group.
    pressKey('ArrowDown');
    expect(focused()).toEqual({ group: 'Diff layout', card: 'Side by side' });
    pressKey('k');
    expect(focused()).toEqual({ group: 'Theme', card: 'System' });
    pressKey('ArrowUp');
    expect(focused()).toEqual({ group: 'Theme', card: 'System' });
    await settle();
    expect(writes(bridge)).toEqual([
      { key: 'theme', value: 'dark' },
      { key: 'theme', value: 'system' },
    ]);
  });

  it('writes the default’s card as it’s pressed while the file holds no theme Lo knows', async () => {
    // Main hasn't said what the file holds: System is shown, but nothing is on file.
    const { bridge } = await first({ 'settings.set': () => undefined });
    await goTo('look');
    const system = [...onScreen().querySelectorAll('[role="radio"]')][2];
    expect(system?.getAttribute('aria-checked')).toBe('true');
    click(system ?? document.body);
    await settle();
    expect(writes(bridge)).toEqual([{ key: 'theme', value: 'system' }]);
  });

  it('says under the group why the file refused a card, with no toast, and shows what’s on file', async () => {
    await first({
      'settings.set': () => {
        throw new IpcError('settingsFile', 'The settings file isn’t valid JSON.');
      },
    });
    await goTo('look');
    const inline = [...onScreen().querySelectorAll('[role="radio"]')][4];
    click(inline ?? document.body);
    await settle();
    const alert = onScreen().querySelector('[role="alert"]');
    expect(alert?.querySelector('p')?.textContent).toBe('Couldn’t change the diff layout');
    expect(alert?.textContent).toContain('The settings file isn’t valid JSON.');
    expect(button('Open settings.json', onScreen())).toBeDefined();
    // Under the diff's layout, not the theme.
    expect(alert?.closest('[role="radiogroup"]')).toBeNull();
    expect(groups()[1]?.chosen).toBe('Side by side');
    expect(notices()).toEqual([]);
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

  it('keeps the last card pressed while the setting is being written, and writes each in turn', async () => {
    const written: unknown[] = [];
    const landing: (() => void)[] = [];
    await first({
      'settings.set': (input) =>
        new Promise<void>((resolve) => {
          written.push(Reflect.get(Object(input), 'value'));
          landing.push(resolve);
        }),
    });
    await goTo('keys');
    const checked = () =>
      [...onScreen().querySelectorAll('[role="radio"]')].map((card) =>
        card.getAttribute('aria-checked'),
      );
    const [standard, vim] = onScreen().querySelectorAll('[role="radio"]');
    click(vim ?? document.body);
    expect(checked()).toEqual(['false', 'true']);
    // Standard, while Vim keys are on their way to the file.
    click(standard ?? document.body);
    expect(checked()).toEqual(['true', 'false']);
    await settle();
    expect(written).toEqual([true, false]);
    for (const land of landing) land();
    await settle();
    await settle();
    expect(welcomeStore.getState().choosing).toEqual({});
    expect(checked()).toEqual(['true', 'false']);
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
    click(button('Next line', onScreen()));
    expect(rows[1]?.getAttribute('aria-selected')).toBe('true');
  });

  it('opens a comment box with c that sends nothing, and Esc closes it', async () => {
    const { bridge } = await first();
    await goTo('keys');
    const before = bridge.calls.length;
    // The box is drawn from the start, out of reach, so opening it moves nothing.
    const box = onScreen().querySelector<HTMLElement>('[data-lo-scope="box"]');
    expect(box?.closest('[inert]')).not.toBeNull();
    // It's no part of the lines' list.
    expect(box?.closest('[role="listbox"]')).toBeNull();
    press('c');
    await settle();
    expect(box?.closest('[inert]')).toBeNull();
    expect(box?.textContent).toContain('Line 42');
    expect(box?.contains(document.activeElement)).toBe(true);
    // The line keeps its tint, and gives the one ring to the box.
    const cursor = onScreen().querySelector('[role="option"][aria-selected="true"]');
    expect(cursor?.className).not.toContain('shadow-ring-inset');
    expect(cursor?.querySelector('.bg-on-screen')).not.toBeNull();
    // ⏎ in it is the box's own, not Continue.
    act(() => enter());
    expect(stepOnScreen()).toBe('keys');
    const close = practiceEscape();
    expect(close).toBeDefined();
    act(() => {
      close?.();
    });
    expect(box?.closest('[inert]')).not.toBeNull();
    expect(document.activeElement?.getAttribute('role')).toBe('listbox');
    expect(bridge.calls).toHaveLength(before);
    // With no box open, Esc is the window's again.
    expect(practiceEscape()).toBeUndefined();
  });
});

describe('the overviews step', () => {
  it('says what an overview is in two lines, over the top of one and the rows of its settings', async () => {
    const { bridge } = await first();
    await goTo('overviews');
    const heading = onScreen().querySelector('h1');
    expect(heading?.textContent).toBe('An overview explains a pull request');
    const said = heading?.parentElement?.nextElementSibling;
    expect(said?.textContent).toBe(
      'A document that comes with a pull request. It says what changed and where to look.' +
        'A coding agent writes it. The overview skill teaches Claude Code and Codex how.',
    );
    expect(said?.querySelectorAll('br')).toHaveLength(1);
    // The example: heard as what it shows, and nothing in it reached.
    const example = onScreen().querySelector('[role="img"]');
    expect(example?.getAttribute('aria-label')).toBe(
      'An overview: a heading, a sentence about the change with a link into the code, and the lines that changed in parser.ts',
    );
    expect(example?.firstElementChild?.hasAttribute('inert')).toBe(true);
    expect(example?.querySelector('h2')?.textContent).toBe('tl;dr');
    expect(example?.querySelector('.lo-lead')?.textContent).toBe(
      String.raw`The parser now splits on \r\n as well as \n, so a file saved on Windows reads as the same lines.`,
    );
    expect(example?.querySelector('.lo-lead a')?.textContent).toBe('The parser');
    expect(example?.querySelector('.lo-codeblock__head')?.textContent).toBe('src/parser.ts:9');
    const code = [...(example?.querySelectorAll('.whitespace-pre') ?? [])];
    expect(code.map((each) => each.textContent)).toEqual([
      String.raw`  return input.split('\n').map(toLine);`,
      String.raw`  return input.split(/\r?\n/).map(toLine);`,
      '}',
    ]);
    // Each feature's row, in its order, in a list the heading names.
    const list = onScreen().querySelector('ul');
    expect(list?.getAttribute('aria-labelledby')).toBe(heading?.id);
    expect(
      [...(list?.querySelectorAll('li') ?? [])].map(
        (row) => row.querySelector('.text-ui-strong')?.textContent,
      ),
    ).toEqual(['Show overviews', 'Open pull requests on']);
    expect(list?.nextElementSibling?.textContent).toBe(
      'Both are also in Settings › Pull requests.',
    );
    expect(bridge.calls.some(([channel]) => channel === 'settings.set')).toBe(false);
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
    // Said on the row, and nowhere else.
    expect(notices()).toEqual([]);
  });

  it('says on the row which folder to add to PATH, and why an install failed', async () => {
    let answer: unknown = { kind: 'installed', path: '/opt/lo/bin/lo', onPath: false };
    await first({ 'open.installCommand': () => answer });
    await goTo('setup');
    const row = () => onScreen().querySelector('ul > li');
    click(button('Install', onScreen()));
    await settle();
    expect(row()?.textContent).toContain('Add /opt/lo/bin to PATH.');
    const code = [...(row()?.querySelectorAll('.code-small') ?? [])].map(
      (each) => each.textContent,
    );
    expect(code).toContain('/opt/lo/bin');
    answer = { kind: 'failed', why: 'unwritable', details: '/opt/lo/bin/lo\nEACCES' };
    click(button('Install', row() ?? document));
    await settle();
    const alert = row()?.querySelector('[role="alert"]');
    expect(alert?.querySelector('p')?.textContent).toBe('Couldn’t install the lo command');
    expect(alert?.textContent).toContain('The lo file can’t be written.');
    expect(button('Try again', row() ?? document)).toBeDefined();
    expect(notices()).toEqual([]);
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

  it('says text isn’t a pull request link as the open box does, keeps it, and stays', async () => {
    await first({
      'open.open': () => ({ kind: 'refused', why: 'link' }),
    });
    await goTo('open');
    const field = type('owner/repo#1');
    const region = () => field.form?.querySelector(':scope > [role="status"]');
    expect(region()?.textContent).toBe('');
    click(button('Open', onScreen()));
    await settle();
    // A warning, not a failure: the box's note, with what a link looks like.
    expect(onScreen().querySelector('[role="alert"]')).toBeNull();
    const note = document.getElementById(field.getAttribute('aria-describedby') ?? '');
    expect(note?.querySelector('svg.text-warning')).not.toBeNull();
    expect(note?.textContent).toBe(
      'Not a pull request linkA pull request link looks like https://github.com/owner/repo/pull/123.',
    );
    // Said by a region that was there before it, so a screen reader reads it as it comes.
    expect(region()?.textContent).toBe(
      'Not a pull request link. A pull request link looks like https://github.com/owner/repo/pull/123.',
    );
    expect(note?.querySelector('.code-small')?.textContent).toBe(
      'https://github.com/owner/repo/pull/123',
    );
    expect(field.getAttribute('aria-invalid')).not.toBe('true');
    expect(field.value).toBe('owner/repo#1');
    expect(stepOnScreen()).toBe('open');
    // Changing the text takes the note away.
    type('owner/repo#12');
    expect(onScreen().textContent).not.toContain('Not a pull request link');
  });

  it('says why a link that is one didn’t open, and stays', async () => {
    await first({
      'open.open': () => ({ kind: 'refused', why: 'cameBack' }),
    });
    await goTo('open');
    const field = type('https://github.com/rozed-dev/e2e/issues/1');
    click(button('Open', onScreen()));
    await settle();
    const alert = onScreen().querySelector('[role="alert"]');
    expect(alert?.querySelector('p')?.textContent).toBe('Couldn’t open the link');
    expect(alert?.textContent).toContain('The browser sent it straight back.');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(stepOnScreen()).toBe('open');
  });

  it('makes Open the main button, with ⏎, once the field holds a link', async () => {
    const { bridge } = await first({
      'open.open': () => ({ kind: 'tab', id: 't', choice: 'none' }),
    });
    await goTo('open');
    const done = button('Done');
    const open = button('Open', onScreen());
    expect(done.hasAttribute('data-welcome-default')).toBe(true);
    expect(open.hasAttribute('data-welcome-default')).toBe(false);
    type('https://github.com/rozed-dev/e2e/pull/78');
    expect(done.hasAttribute('data-welcome-default')).toBe(false);
    expect(done.querySelector('.text-on-accent')).toBeNull();
    expect(open.hasAttribute('data-welcome-default')).toBe(true);
    expect(open.querySelector('.text-on-accent')).not.toBeNull();
    // With focus off the field, ⏎ opens the link, as Open's chip says.
    act(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    });
    act(() => enter());
    await settle();
    expect(bridge.calls).toContainEqual([
      'open.open',
      { text: 'https://github.com/rozed-dev/e2e/pull/78' },
    ]);
  });

  it('kisses as the last step first shows, and rests when the reader comes back', async () => {
    await first();
    await goTo('open');
    expect(onScreen().querySelector('svg[aria-label="Lo"]')).toBeNull();
    click(button('Back'));
    await goTo('open');
    expect(onScreen().querySelector('svg[aria-label="Lo"]')).not.toBeNull();
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
    // Nothing happened, and a refusal says why.
    expect(notices().map((note) => note.title)).toContain('No pull request link on the clipboard');
    expect(onScreen().querySelector('[role="alert"]')).toBeNull();
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
    expect(sample?.querySelector('.text-small')?.textContent).toBe(
      'withlo/lo#182 · has an overview',
    );
    click(button('Open', sample ?? document));
    await settle();
    expect(bridge.calls).toContainEqual(['open.open', { text: SAMPLE.link }]);
  });

  it('leaves out that the sample has an overview while overviews are off', async () => {
    await first();
    await goTo('open');
    act(() => overviewsOn.set(false));
    const sample = onScreen().querySelector('ul[aria-label="Sample pull request"] > li');
    expect(sample?.querySelector('.text-small')?.textContent).toBe('withlo/lo#182');
  });
});
