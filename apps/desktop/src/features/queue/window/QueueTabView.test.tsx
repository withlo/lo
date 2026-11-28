// @vitest-environment jsdom
// A merge queue's tab, drawn from what main said of it: the queue's settings and the branches it
// can show, its entries with those tested together grouped, those waiting to join, those Lo saw
// leave with why, and what stands in for the queue when the branch has none, a read failed, or
// GitHub left part of it out; each row's actions, its `⋯`, and what went wrong under it; and the
// status bar's hints, which run what they name.

import { holdRegistry, menuSections, type Registry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import type { QueueTab } from '../../tab/contract.ts';
import type * as TabShared from '../../tab/window/shared.ts';
import type { Acted, Entry, QueueRead, QueueState } from '../contract.ts';
import { acting } from './acting.ts';
import feature from './index.ts';
import { dropTurns, QueueTabView } from './QueueTabView.tsx';
import { focusedRows, forgetQueue, showQueue } from './store.ts';

// The tab on screen, as the tab feature names it: the queue's, unless a test says.
const on = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => on.tab,
}));

const TAB: QueueTab = {
  id: 'q',
  kind: 'queue',
  owner: 'rozed-dev',
  repo: 'e2e',
  branch: 'e4/queued',
  login: 'rozed-bot',
};

let bridge: FakeBridge;
let registry: Registry;

/** How main answers turning auto-merge off: as a test says, else that it's off. */
let turningOff: () => Promise<Acted> = () => Promise.resolve({ kind: 'autoMergeOff' });

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // jsdom lays nothing out, so it has nothing to scroll a row into view in.
  Element.prototype.scrollIntoView = () => undefined;
  registry = createRegistry(feature.commands, 'mac');
  // The tab's buttons run their commands through it, as the window's keys do.
  holdRegistry(registry);
  bridge = installBridge({
    'queue.state': () => undefined,
    'queue.show': () => 'q',
    'queue.look': () => ({ read: undefined, failed: undefined }),
    'queue.open': () => 'pull',
    'queue.plan': () => ({ kind: 'refused', why: '' }),
    'queue.autoMergeOff': () => turningOff(),
    'tab.openExternal': () => undefined,
  });
});

beforeEach(() => {
  on.tab = TAB;
  turningOff = () => Promise.resolve({ kind: 'autoMergeOff' });
});

afterEach(() => {
  act(() => {
    forgetQueue(TAB.id);
    focusedRows.set(TAB.id, undefined);
    acting.setState({ dialog: undefined, working: new Map(), problems: new Map() });
  });
  bridge.calls.length = 0;
});

function entry(position: number, number: number, extra: Partial<Entry> = {}): Entry {
  return {
    position,
    number,
    title: `Fixture M4: ${number}`,
    url: `https://github.com/rozed-dev/e2e/pull/${number}`,
    author: 'rozed-bot',
    state: 'AWAITING_CHECKS',
    enqueuedAt: Date.now() - 60_000,
    timeToMerge: null,
    yours: true,
    queuedByYou: true,
    head: 'a'.repeat(40),
    testedTogether: false,
    stack: null,
    ...extra,
  };
}

function stateOf(read: QueueRead, extra: Partial<QueueState> = {}): QueueState {
  return {
    id: TAB.id,
    branch: TAB.branch,
    branches: [
      { name: 'e4/queued', count: 3 },
      { name: 'merge/4/base', count: null },
    ],
    read,
    readAt: Date.now(),
    failure: null,
    away: false,
    ...extra,
  };
}

const QUEUE: QueueRead = {
  kind: 'queue',
  url: 'https://github.com/rozed-dev/e2e/queue/e4/queued',
  method: 'squash',
  groups: 5,
  nextMerge: null,
  admin: true,
  entries: [
    entry(1, 150, { testedTogether: true }),
    entry(2, 151, { testedTogether: true }),
    entry(3, 152, { state: 'QUEUED' }),
  ],
  more: 0,
  leftOut: false,
  waiting: [
    {
      number: 153,
      title: 'Fixture M4: waiting',
      url: 'https://github.com/rozed-dev/e2e/pull/153',
      author: 'rozed-bot',
      yours: true,
      head: 'b'.repeat(40),
      review: null,
      checks: 'running',
    },
  ],
  waitingCutShort: false,
  left: [
    {
      number: 154,
      title: 'Fixture M4: queued, fails in the queue',
      url: 'https://github.com/rozed-dev/e2e/pull/154',
      at: Date.now() - 5 * 60_000,
      enqueuedAt: Date.now() - 28 * 60_000,
      why: {
        kind: 'failedChecks',
        checks: [{ name: 'ci', url: 'https://github.com/rozed-dev/e2e/actions/runs/1' }],
      },
      partial: false,
    },
    {
      number: 149,
      title: 'Fixture M4: gone',
      url: 'https://github.com/rozed-dev/e2e/pull/149',
      at: Date.now() - 60 * 60_000,
      enqueuedAt: null,
      why: { kind: 'unknown' },
      partial: true,
    },
  ],
};

function render(): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<QueueTabView tab={TAB} />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const rowsIn = (host: HTMLElement) =>
  [...host.querySelectorAll('[role="row"][data-key]')].map((row) => row.getAttribute('data-key'));

/** Lets what's waiting settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

/** A button's words, without its key, or its name where it has no words. */
function wordsOf(button: Element): string {
  const label = button.getAttribute('aria-label');
  if (label !== null) return label;
  const walker = document.createTreeWalker(button, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent?.trim()) return node.textContent;
  }
  return '';
}

/** The buttons in the row `key`, by their words. */
function buttonsIn(host: HTMLElement, key: string): string[] {
  return [...(host.querySelector(`[data-key="${key}"]`)?.querySelectorAll('button') ?? [])].map(
    wordsOf,
  );
}

/** The button in `within` whose words start with `label`. */
function buttonOf(
  within: Element | null | undefined,
  label: string,
): HTMLButtonElement | undefined {
  return [...(within?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(label),
  );
}

function calls(channel: string): unknown[] {
  return bridge.calls.filter(([each]) => each === channel).map(([, input]) => input);
}

describe('a merge queue’s tab', () => {
  it('names the repository, the branch, the queue’s settings, the branches and the account', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const header = host.querySelector('header');
    expect(header?.textContent).toContain('Merge queue');
    expect(header?.textContent).toContain('rozed-dev/e2e into');
    expect(header?.textContent).toContain('e4/queued');
    expect(header?.textContent).toContain('Squash · groups of up to 5');
    expect(header?.textContent).toContain('as rozed-bot');
    const tabs = [...(header?.querySelectorAll('[role="tab"]') ?? [])];
    expect(tabs.map((each) => each.textContent)).toEqual(['e4/queued3', 'merge/4/base']);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('lists the entries, those tested together in a group, then those waiting to join, then those that left', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    expect(rowsIn(host)).toEqual([
      'queued-150',
      'queued-151',
      'queued-152',
      'waiting-153',
      'left-154',
      'left-149',
    ]);
    const group = host.querySelector(
      '[role="rowgroup"][aria-label="Testing together, 2 pull requests"]',
    );
    expect(group?.querySelectorAll('[data-key]')).toHaveLength(2);
    const joining = host.querySelector('[role="rowgroup"][aria-label="Waiting to join"]');
    expect(joining?.textContent).toContain('Auto-merge is on');
    expect(joining?.textContent).toContain('checks running');
    expect(host.querySelector('footer')?.textContent).toContain('Checked just now');
  });

  it('says why each that left did, its failed check’s run opening on GitHub', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const left = host.querySelector('[role="rowgroup"][aria-label="Left"]');
    const failed = left?.querySelector('[data-key="left-154"]');
    expect(failed?.textContent).toContain('Left 5 min ago · ci failed');
    expect(failed?.textContent).toContain('Checks failed');
    expect(failed?.textContent).toContain('23 min');
    const unknown = left?.querySelector('[data-key="left-149"]');
    expect(unknown?.textContent).toContain('Left 1 h ago');
    expect(unknown?.textContent).not.toContain('GitHub');
    act(() => buttonOf(failed, 'ci')?.click());
    expect(bridge.calls).toContainEqual([
      'tab.openExternal',
      { url: 'https://github.com/rozed-dev/e2e/actions/runs/1' },
    ]);
  });

  it('switches branch from the header, through main', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const other = [...host.querySelectorAll('[role="tab"]')].find((each) =>
      each.textContent.startsWith('merge/4/base'),
    );
    act(() => {
      other?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(bridge.calls).toContainEqual(['queue.show', { id: 'q', branch: 'merge/4/base' }]);
  });

  it('says GitHub left part of the queue out, counting down to the next read, never that it’s empty', async () => {
    act(() =>
      showQueue(
        stateOf({ ...QUEUE, url: null, entries: [], waiting: [], left: [], leftOut: true }),
      ),
    );
    const host = render();
    expect(host.textContent).toContain('Can’t show the whole queue');
    expect(host.textContent).toContain('GitHub left part of it out. Retrying in 20 s.');
    expect(host.textContent).not.toContain('No pull requests in the queue');
    act(() => buttonOf(host.querySelector('main'), 'Try now')?.click());
    await until(() => calls('queue.look').length === 1);
    expect(calls('queue.look')).toEqual([{ id: 'q' }]);
  });

  it('says a branch has no queue, and why a read failed, with GitHub’s words behind Details', async () => {
    act(() =>
      showQueue(
        stateOf(
          { kind: 'none' },
          {
            failure: {
              message: 'getaddrinfo ENOTFOUND api.github.com',
              reason: 'Offline.',
              retryAt: Date.now() + 40_000,
            },
          },
        ),
      ),
    );
    const host = render();
    expect(host.querySelector('[data-lo-empty] p')?.textContent).toBe(
      'e4/queued has no merge queue',
    );
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Can’t check the merge queue');
    expect(alert?.textContent).toContain('Offline. Retrying in 40 s.');
    expect(alert?.textContent).not.toContain('ENOTFOUND');
    expect(buttonOf(host.querySelector('main'), 'Details')).toBeDefined();
    act(() => buttonOf(host.querySelector('main'), 'Try now')?.click());
    await until(() => calls('queue.look').length === 1);
    expect(calls('queue.look')).toEqual([{ id: 'q' }]);
  });

  it('offers to sign in again when the queue’s account is signed out', () => {
    act(() =>
      showQueue(
        stateOf(QUEUE, {
          away: true,
          failure: { message: 'rozed-bot is signed out.', retryAt: null },
        }),
      ),
    );
    const host = render();
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('rozed-bot is signed out.');
    expect(buttonOf(host.querySelector('main'), 'Sign in again')).toBeDefined();
  });

  it('says more are waiting to join when GitHub listed only some', () => {
    act(() => showQueue(stateOf({ ...QUEUE, waitingCutShort: true })));
    const host = render();
    expect(host.textContent).toContain('More pull requests are waiting to join.');
  });

  it('keeps focus on the page as the table goes for a branch with no queue, so its keys still work', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const grid = host.querySelector<HTMLElement>('[role="grid"]');
    act(() => grid?.focus());
    expect(document.activeElement).toBe(grid);
    act(() => showQueue(stateOf({ kind: 'none' }, { branch: 'merge/4/base' })));
    expect(document.activeElement).toBe(host.querySelector('[data-lo-scope="queue"]'));
  });

  it('waits for the queue, asking main what it has, when it has heard nothing yet', () => {
    const host = render();
    expect(host.querySelector('main')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('main [role="status"]')).not.toBeNull();
    expect(bridge.calls).toContainEqual(['queue.state', { id: 'q' }]);
  });
});

describe('a row’s actions', () => {
  it('has each row’s actions, a move to the front only behind the front, and a `⋯` on every row', () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    expect(buttonsIn(host, 'queued-150')).toEqual(['Remove…', 'More actions for #150']);
    expect(buttonsIn(host, 'queued-151')).toEqual([
      'Move to front…',
      'Remove…',
      'More actions for #151',
    ]);
    expect(buttonsIn(host, 'waiting-153')).toEqual([
      'Turn off auto-merge',
      'More actions for #153',
    ]);
    expect(buttonsIn(host, 'left-149')).toEqual(['More actions for #149']);
  });

  it('offers a move to the front only to the repository’s admins', () => {
    act(() => showQueue(stateOf({ ...QUEUE, admin: false })));
    const host = render();
    expect(buttonsIn(host, 'queued-151')).toEqual(['Remove…', 'More actions for #151']);
  });

  it('asks about a removal in the queue’s dialog', async () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    act(() => buttonOf(host.querySelector('[data-key="queued-152"]'), 'Remove…')?.click());
    expect(acting.getState().dialog?.sketch).toMatchObject({ kind: 'remove', number: 152 });
    await until(() => calls('queue.plan').length === 1);
    expect(calls('queue.plan')).toEqual([{ id: 'q', number: 152, kind: 'remove' }]);
  });

  it('turns auto-merge off from a waiting row, its button busy meanwhile, and a toast says it went', async () => {
    let answer: ((acted: Acted) => void) | undefined;
    turningOff = () => new Promise((resolve) => (answer = resolve));
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const off = () =>
      buttonOf(host.querySelector('[data-key="waiting-153"]'), 'Turn off auto-merge');
    act(() => off()?.click());
    await until(() => off()?.getAttribute('aria-busy') === 'true');
    await until(() => calls('queue.autoMergeOff').length === 1);
    expect(calls('queue.autoMergeOff')).toEqual([{ id: 'q', number: 153 }]);
    expect(off()?.textContent).toContain('Turning off…');
    await act(async () => answer?.({ kind: 'autoMergeOff' }));
    await until(() => off()?.getAttribute('aria-busy') === null);
    expect(notice()).toMatchObject({ title: 'Turned off auto-merge for #153', done: true });
  });

  it('says under its row why auto-merge didn’t go off, and tries again from there', async () => {
    turningOff = () =>
      Promise.resolve({ kind: 'refused', why: 'GitHub returned an error.', details: 'HTTP 502' });
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    act(() =>
      buttonOf(host.querySelector('[data-key="waiting-153"]'), 'Turn off auto-merge')?.click(),
    );
    await until(() => host.querySelector('[role="alert"]') !== null);
    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('Couldn’t turn off auto-merge');
    expect(alert?.textContent).toContain('GitHub returned an error.');
    turningOff = () => Promise.resolve({ kind: 'autoMergeOff' });
    act(() => buttonOf(host.querySelector('[role="grid"]'), 'Try again')?.click());
    await until(() => calls('queue.autoMergeOff').length === 2);
    await until(() => host.querySelector('[role="alert"]') === null);
  });

  it('opens a row’s pull request on a double click', async () => {
    act(() => showQueue(stateOf(QUEUE)));
    const host = render();
    const row = host.querySelector('[data-key="queued-151"] [role="gridcell"]');
    act(() => {
      row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    });
    await until(() => calls('queue.open').length === 1);
    expect(calls('queue.open')).toEqual([{ id: 'q', number: 151 }]);
  });
});

/** The status bar's buttons, each with why it's dimmed, if it is. */
function hints(host: HTMLElement): [string, string | null][] {
  return [...(host.querySelector('footer')?.querySelectorAll('button') ?? [])]
    .filter((button) => button.textContent !== 'rozed-bot')
    .map((button) => [
      wordsOf(button),
      button.getAttribute('aria-disabled') === 'true'
        ? (document.getElementById(button.getAttribute('aria-describedby') ?? '')?.textContent ??
          '')
        : null,
    ]);
}

/** The status bar's row of hints, which the measuring test gives a width. */
function measured(element: HTMLElement): boolean {
  return element.classList.contains('give-up') && element.closest('footer') !== null;
}

/** How many steps a row has given up. */
function given(element: HTMLElement): number {
  return element.getAttribute('data-gave-up')?.split(' ').length ?? 0;
}

describe('the status bar’s hints', () => {
  it('give up hints from the right where they don’t fit, the dimmed ones first', () => {
    // #4 goes first, then #2, then the rest from the right.
    expect(dropTurns([false, false, true, false, true, false])).toEqual([6, 5, 2, 4, 1, 3]);
    expect(dropTurns([false, false, false])).toEqual([3, 2, 1]);
  });

  it('measures as one row: key chips first, then the dimmed hints from the right', () => {
    // The row is 300 px wide; its hints take 420 with their chips, and each step given up saves 50.
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return measured(this) ? 300 : 0;
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
      configurable: true,
      get(this: HTMLElement) {
        return measured(this) ? 420 - 50 * given(this) : 0;
      },
    });
    onTestFinished(() => {
      delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
      delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
    });
    act(() => showQueue(stateOf(QUEUE)));
    act(() => focusedRows.set(TAB.id, 'waiting-153'));
    const host = render();
    const row = host.querySelector<HTMLElement>('footer .give-up')!;
    expect(row.getAttribute('data-gave-up')).toBe('keys drop1 drop2');
    // Move to front and Remove, dimmed on a pull request waiting to join, go first.
    const going = (turn: string) => row.querySelector(`[data-gives="${turn}"]`)?.textContent;
    expect(going('drop1')).toContain('Move to front…');
    expect(going('drop2')).toContain('Remove…');
    expect(going('drop3')).toContain('Open on GitHub');
  });

  it('names the keys for the row the keyboard is on, each dimmed with why it can’t run', () => {
    act(() => showQueue(stateOf(QUEUE)));
    act(() => focusedRows.set(TAB.id, 'waiting-153'));
    const host = render();
    const labels = hints(host).map(([label]) => label);
    expect(labels).toEqual([
      'Next',
      'Previous',
      'Open',
      'Remove…',
      'Move to front…',
      'Turn off auto-merge',
      'Open on GitHub',
    ]);
    const dimmed = Object.fromEntries(hints(host));
    expect(dimmed['Remove…']).toBe('#153 is waiting to join');
    expect(dimmed['Move to front…']).toBe('#153 is waiting to join');
    expect(dimmed['Turn off auto-merge']).toBeNull();
  });

  it('offers to turn auto-merge on for one that left', () => {
    act(() => showQueue(stateOf(QUEUE)));
    act(() => focusedRows.set(TAB.id, 'left-154'));
    const host = render();
    expect(hints(host).map(([label]) => label)).toContain('Turn on auto-merge…');
  });

  it('runs what it names', () => {
    act(() => showQueue(stateOf(QUEUE)));
    act(() => focusedRows.set(TAB.id, 'queued-150'));
    const host = render();
    act(() => buttonOf(host.querySelector('footer'), 'Next')?.click());
    expect(focusedRows.get(TAB.id)).toBe('queued-151');
  });
});

/** The commands a right-click on row `row` lists. */
function listed(row: string): string[] {
  return menuSections(registry, { kind: 'row', row })
    .flat()
    .map(({ id }) => id);
}

describe('a row’s right-click menu', () => {
  it('lists the queue’s commands on the queue’s own rows', () => {
    act(() => showQueue(stateOf(QUEUE)));
    render();
    expect(listed('queued-151')).toEqual([
      'queue.open',
      'queue.remove',
      'queue.jump',
      'queue.autoMerge',
      'queue.openOnGithub',
    ]);
    // Moving to the front is for entries behind the front one only.
    const others = ['queue.open', 'queue.remove', 'queue.autoMerge', 'queue.openOnGithub'];
    expect(listed('queued-150')).toEqual(others);
    expect(listed('waiting-153')).toEqual(others);
    expect(listed('left-154')).toEqual(others);
  });

  it('offers moving to the front only to the repository’s admins', () => {
    act(() => showQueue(stateOf({ ...QUEUE, admin: false })));
    render();
    expect(listed('queued-151')).toEqual([
      'queue.open',
      'queue.remove',
      'queue.autoMerge',
      'queue.openOnGithub',
    ]);
  });

  it('lists none of them on another list’s rows, as a pull request’s timeline’s', () => {
    act(() => showQueue(stateOf(QUEUE)));
    // The queue's table isn't drawn: a pull request's tab is on screen.
    expect(listed('queued-150')).toEqual([]);
    render();
    expect(listed('comment-150')).toEqual([]);
  });
});
