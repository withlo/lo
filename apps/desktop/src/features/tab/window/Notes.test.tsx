// @vitest-environment jsdom
// What a pull request's tab says of itself, drawn: its banners in order of urgency, one held as it
// leaves, one arriving behind the one shown said to a screen reader; and a read that fails after
// the view was drawn, which leaves the view and says why in the header's chip.

import { Banner } from '@lo/ui';
import { holdRegistry } from '@lo/ui/commands';
import { act, createElement, useSyncExternalStore, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { defineView, Slots } from '../../../window/slots.tsx';
import type { PullView } from '../contract.ts';
import feature from './index.ts';
import { Banners, blocked, TabFailed, useHeaderConnection } from './Notes.tsx';
import { banners, type BannerSaid, type PullTab } from './shared.ts';

vi.mock('./main.ts', () => ({ main: () => ({ reload: () => Promise.resolve() }) }));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  holdRegistry(createRegistry(feature.commands ?? [], 'mac'));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const TAB: PullTab = { id: 't1', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 };

/** Draws `node` on the page, until the test ends. */
function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(node));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

/** What a feature's banner says, kept where its banner and its switch both read it. */
function store(said: BannerSaid | undefined) {
  let now = said;
  const listeners = new Set<() => void>();
  return {
    get: () => now,
    set(next: BannerSaid | undefined) {
      now = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** A feature's banner view, `order` in the slot, drawing what `kept` says while it says it. */
function bannerView(id: string, order: number, kept: ReturnType<typeof store>) {
  function Drawn() {
    const said = useSyncExternalStore(kept.subscribe, kept.get);
    return said ? createElement(Banner, { tone: said.tone, title: said.title }) : null;
  }
  return defineView(banners, {
    id,
    order,
    render: () => createElement(Drawn),
    said: () => kept.get(),
    subscribe: (_tab, listener) => {
      const stop = kept.subscribe(listener);
      return () => {
        stop();
      };
    },
  });
}

const titleOf = (host: HTMLElement) => host.querySelector('[data-lo-banners] strong')?.textContent;
const heard = (host: HTMLElement) => host.querySelector('[data-lo-banners-heard]')?.textContent;

describe('the tab’s banners', () => {
  it('show the most urgent first, then in the slot’s order, and say one arriving behind', () => {
    const watched = store({ tone: 'info', title: 'ravi-k pushed r5 after your approval' });
    const outcome = store(undefined);
    const start = store(undefined);
    const host = draw(
      <Slots
        views={[
          bannerView('merge.watched', 7, watched),
          bannerView('merge.outcome', 5, outcome),
          bannerView('stacks.start', 10, start),
        ]}
      >
        <Banners tab={TAB} view={undefined} />
      </Slots>,
    );
    expect(titleOf(host)).toBe('ravi-k pushed r5 after your approval');
    // A failure comes first, before the slot's earlier views.
    act(() => outcome.set({ tone: 'danger', title: 'Merge refused' }));
    expect(titleOf(host)).toBe('Merge refused');
    expect(host.querySelector('[aria-label="Next, 1 more"]')).not.toBeNull();
    // One that arrives behind the one shown is said, politely: the one shown says itself.
    act(() => start.set({ tone: 'info', title: 'This diff includes #83’s changes' }));
    expect(titleOf(host)).toBe('Merge refused');
    expect(heard(host)).toBe('This diff includes #83’s changes');
    expect(host.querySelector('[data-lo-banners-heard]')?.getAttribute('role')).toBe('status');
  });

  it('holds the last banner as its row closes, once its feature has none to draw', () => {
    // The row's move is under way, as it is in the window, so it holds what it held.
    Reflect.set(Element.prototype, 'getAnimations', () => []);
    onTestFinished(() => {
      Reflect.deleteProperty(Element.prototype, 'getAnimations');
    });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(0);
    const left = store({ tone: 'danger', title: '#80 left the merge queue' });
    const host = draw(
      <Slots views={[bannerView('merge.left', 6, left)]}>
        <Banners tab={TAB} view={undefined} />
      </Slots>,
    );
    act(() => left.set(undefined));
    expect(host.querySelector('[data-lo-banners] [data-closed]')).not.toBeNull();
    expect(titleOf(host)).toBe('#80 left the merge queue');
  });
});

/** A tab's view that was drawn, whose last read failed with GitHub's error. */
const failedRead: PullView = {
  id: 't1',
  loading: false,
  acting: { kind: 'account', login: 'rozed-bot' },
  header: null,
  connection: { kind: 'live' },
  problem: {
    kind: 'failed',
    cause: { kind: 'github' },
    details: '502 Bad Gateway',
    retryAt: Date.now() + 20_000,
  },
  shown: '5530830f535b2947f1b50a184dc58a9c7b2845ad',
  newer: null,
};

function Chip({ view }: { view: PullView }) {
  const chip = useHeaderConnection(TAB, view);
  return <p>{chip ? `${chip.tone} ${chip.label}` : 'none'}</p>;
}

describe('a read that fails after the view was drawn', () => {
  it('leaves the view, and says why in the header’s chip', () => {
    expect(blocked(failedRead)).toBe(false);
    expect(draw(<TabFailed tab={TAB} view={failedRead} />).textContent).toBe('');
    // Amber while it counts down to trying again.
    expect(draw(<Chip view={failedRead} />).textContent).toBe('warn Can’t check for changes');
    // Before anything was drawn, the failure takes the view's place, and the chip says nothing.
    const first = { ...failedRead, shown: null };
    expect(blocked(first)).toBe(true);
    expect(draw(<Chip view={first} />).textContent).toBe('none');
  });
});

/** The buttons of the account choice for a pull request `logins` can see. */
function buttons(logins: readonly string[]): string[] {
  const view: PullView = {
    ...failedRead,
    shown: null,
    problem: { kind: 'ask', logins: [...logins] },
  };
  const host = draw(<TabFailed tab={TAB} view={view} />);
  expect(host.querySelector('h2')?.textContent).toBe('Choose an account for #80');
  return [...host.querySelectorAll('button')].map((button) => button.textContent ?? '');
}

describe('a tab that needs an account chosen', () => {
  it('offers each of two accounts, or past two, the menu of them, each the command that takes one', () => {
    expect(buttons(['rozed-bot', 'mira-chen'])).toEqual(['Open as rozed-bot', 'Open as mira-chen']);
    expect(buttons(['rozed-bot', 'mira-chen', 'ravi-k'])).toEqual(['Choose account…']);
  });
});
