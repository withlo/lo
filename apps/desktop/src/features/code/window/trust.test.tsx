// @vitest-environment jsdom
// Trust in the window, with main answered by a stand-in bridge: the banner says what main decided
// and only asks main, the palette's commands act only where they can, and Settings lists what's
// trusted, from the file, with "Remove".

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import feature from './index.ts';
import { bannerOf, trustable, trustSwitch, untrustable } from './status.ts';
import { daysAgo, rowsOf } from './Trusted.tsx';
import { TrustBanner } from './TrustBanner.tsx';

/** What main says of each view, by its id. */
const states = new Map<string, Status>();

const bridge = installBridge({
  'code.state': (input) => states.get(String(Reflect.get(Object(input), 'view'))) ?? null,
  'code.trust': () => 'cancelled',
  'code.untrust': () => undefined,
  'code.dismiss': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  feature.start?.();
});

/** A view of rozed-dev/e2e#80, as main says it stands, with `change`. */
function statusOf(view: string, change: Partial<Status> = {}): Status {
  return {
    view,
    repo: 'rozed-dev/e2e',
    pull: 80,
    head: { kind: 'base' },
    trust: { kind: 'untrusted', why: 'unnamed' },
    dismissed: false,
    ...change,
  };
}

function tabOf(id: string): PullTab {
  return { id, kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 80 };
}

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

/** Lets what's waiting on main settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find(
    (each) => each.textContent === name || each.getAttribute('aria-label') === name,
  );

describe('the banner', () => {
  it('says language servers are off for a repository nothing trusts, and only asks main', async () => {
    const page = draw(<TrustBanner tab={tabOf('t1')} />);
    expect(page.textContent).toBe('');
    act(() => bridge.push('code.status', statusOf('t1')));
    expect(page.textContent).toContain('Language servers are off for rozed-dev/e2e.');
    expect(page.textContent).toContain('Lo runs them only on repos you trust.');
    act(() => button(page, 'Trust this repo')?.click());
    await until(() => bridge.calls.some(([channel]) => channel === 'code.trust'));
    expect(bridge.calls.find(([channel]) => channel === 'code.trust')?.[1]).toEqual({
      view: 't1',
      repo: 'rozed-dev/e2e',
      pull: null,
    });
    // Main hasn't said it's trusted, so the banner stays.
    expect(page.textContent).toContain('Language servers are off');
  });

  it('offers a fork’s pull request alone, and goes once dismissed', async () => {
    const page = draw(<TrustBanner tab={tabOf('t2')} />);
    act(() =>
      bridge.push(
        'code.status',
        statusOf('t2', { pull: 97, head: { kind: 'fork', repo: 'rozed-bot/e2e' } }),
      ),
    );
    expect(page.textContent).toContain('This PR comes from a fork, rozed-bot/e2e.');
    act(() => button(page, 'Trust this PR')?.click());
    await until(() =>
      bridge.calls.some(
        ([channel, input]) => channel === 'code.trust' && Reflect.get(Object(input), 'pull') === 97,
      ),
    );
    act(() => button(page, 'Dismiss')?.click());
    expect(page.textContent).toBe('');
    await until(() => bridge.calls.some(([channel]) => channel === 'code.dismiss'));
    expect(bridge.calls.find(([channel]) => channel === 'code.dismiss')?.[1]).toEqual({
      view: 't2',
    });
  });

  it('shows only on a view nothing trusts, with git, not dismissed', () => {
    expect(bannerOf(null)).toBeUndefined();
    expect(bannerOf(statusOf('t', { dismissed: true }))).toBeUndefined();
    for (const trust of [
      { kind: 'noGit' },
      { kind: 'checking' },
      { kind: 'waiting' },
      { kind: 'trusted', by: 'repo' },
      // Lo couldn't check what may trust it: the banner would offer what's there already.
      { kind: 'untrusted', why: 'unread' },
    ] as const) {
      expect(bannerOf(statusOf('t', { trust }))).toBeUndefined();
    }
    // A repository by the name trusted that isn't the one.
    expect(bannerOf(statusOf('t', { trust: { kind: 'untrusted', why: 'other' } }))?.action).toEqual(
      {
        label: 'Trust this repo',
        pull: false,
      },
    );
    // A fork GitHub no longer has can't be trusted.
    expect(bannerOf(statusOf('t', { head: { kind: 'gone' } }))?.action).toBeUndefined();
  });

  it('asks main where a view drawn before it said anything stands', async () => {
    states.set('t3', statusOf('t3'));
    const tab = tabOf('t3');
    expect(trustSwitch.shows(tab)).toBe(false);
    const stop = trustSwitch.subscribe(tab, () => undefined);
    onTestFinished(stop);
    await until(() => trustSwitch.shows(tab));
  });
});

describe('the palette’s commands', () => {
  it('trust the repo or the PR only where that can help, and stop trusting only what’s trusted', () => {
    const repo = statusOf('t');
    const fork = statusOf('t', { head: { kind: 'fork', repo: 'rozed-bot/e2e' } });
    const trusted = statusOf('t', { trust: { kind: 'trusted', by: 'repo' } });
    expect(trustable(repo, false)).toBe(true);
    expect(trustable(repo, true)).toBe(
      "This PR's branch is in the repo itself: trust the repo instead.",
    );
    expect(trustable(fork, true)).toBe(true);
    expect(trustable(fork, false)).toBe('This PR comes from a fork: trust this PR instead.');
    expect(trustable(trusted, false)).toBe('Lo trusts rozed-dev/e2e already.');
    expect(trustable(statusOf('t', { trust: { kind: 'noGit' } }), false)).toBe(
      'Code features need git.',
    );
    expect(trustable("There's no pull request on screen.", false)).toBe(
      "There's no pull request on screen.",
    );
    expect(untrustable(trusted)).toBe(true);
    expect(untrustable(repo)).toBe("Lo doesn't trust this repo.");
  });
});

describe('Settings’ trust rows', () => {
  const now = Date.parse('2026-11-15T12:00:00.000Z');

  it('lists each repository and fork’s pull request trusted, once, with when', () => {
    expect(
      rowsOf(
        [
          { kind: 'repo', repo: 'rozed-dev/old', id: 'R_e2e', at: '2026-11-01T09:00:00.000Z' },
          { kind: 'repo', repo: 'rozed-dev/e2e', id: 'R_e2e', at: '2026-11-03T12:00:00.000Z' },
          {
            kind: 'pull',
            repo: 'rozed-dev/e2e',
            id: 'R_e2e',
            pull: 97,
            from: 'rozed-bot/e2e',
            fromId: 'R_fork',
            at: '2026-11-15T12:00:00.000Z',
          },
        ],
        now,
      ),
    ).toEqual([
      { key: 'R_e2e', name: 'rozed-dev/e2e', kind: 'repo', trusted: '12 days ago' },
      { key: 'R_e2e#97', name: 'rozed-bot/e2e#97', kind: 'fork', trusted: 'today' },
    ]);
    expect(daysAgo('2026-11-14T12:00:00.000Z', now)).toBe('yesterday');
    expect(daysAgo(undefined, now)).toBe('in the settings file');
  });
});
