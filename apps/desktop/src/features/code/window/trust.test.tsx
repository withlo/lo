// @vitest-environment jsdom
// Trust in the window, with main answered by a stand-in bridge: the banner says what main decided
// and only asks main, its button says how far main has got and waits meanwhile, and once trusting
// failed it says why, offering to open the settings file and to try again; the palette's commands
// act only where they can, and Settings lists what's trusted, from the file, with "Remove".

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Status } from '../contract.ts';
import feature from './index.ts';
import { askable, bannerOf, drawn, trustable, trustSwitch, untrustable } from './status.ts';
import { daysAgo, rowsOf } from './Trusted.tsx';
import { TrustBanner } from './TrustBanner.tsx';

/** What main says of each view, by its id. */
const states = new Map<string, Status>();

/** How main answers `code.trust`, which a test sets. */
let answerTrust: (input: unknown) => unknown = () => 'cancelled';

const bridge = installBridge({
  'code.state': (input) => states.get(String(Reflect.get(Object(input), 'view'))) ?? null,
  'code.trust': (input) => answerTrust(input),
  'code.untrust': () => undefined,
  'code.dismiss': () => undefined,
  'settings.openFile': () => undefined,
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

/** What a button says: the words on it that show, for one that says something else at work. */
const said = (control: HTMLElement) =>
  control.querySelector('span > span:not([aria-hidden])')?.textContent ?? control.textContent;

const button = (page: HTMLElement, name: string) =>
  [...page.querySelectorAll('button')].find(
    (each) => said(each) === name || each.getAttribute('aria-label') === name,
  );

describe('the banner', () => {
  it('says language servers are off for a repository nothing trusts, and only asks main', async () => {
    const page = draw(<TrustBanner tab={tabOf('t1')} />);
    expect(page.textContent).toBe('');
    act(() => bridge.push('code.status', statusOf('t1')));
    // One fact, in one line.
    expect(page.querySelector('[role="status"] p')?.textContent).toBe(
      'Language servers are off for rozed-dev/e2e',
    );
    act(() => button(page, 'Trust repo…')?.click());
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
    expect(page.textContent).toContain('Language servers are off for the fork rozed-bot/e2e');
    act(() => button(page, 'Trust pull request…')?.click());
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
        label: 'Trust repo…',
        pull: false,
      },
    );
    // A fork GitHub no longer has can't be trusted.
    expect(bannerOf(statusOf('t', { head: { kind: 'gone' } }))?.action).toBeUndefined();
  });

  it('keeps its place in the tab until it has closed', () => {
    const tab = tabOf('t9');
    draw(<TrustBanner tab={tab} />);
    act(() => bridge.push('code.status', statusOf('t9')));
    expect(drawn.get('t9')).toBe('on');
    expect(trustSwitch.shows(tab)).toBe(true);
    act(() =>
      bridge.push('code.status', statusOf('t9', { trust: { kind: 'trusted', by: 'repo' } })),
    );
    // Closing takes no time here, so it's gone, and nothing holds its place.
    expect(drawn.get('t9')).toBe('off');
    expect(trustSwitch.shows(tab)).toBe(false);
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

/** How many times the window asked main for `channel`. */
const asked = (channel: string) => bridge.calls.filter(([name]) => name === channel).length;
/** The banner's button that trusts, whatever it says now. */
const trustButton = (page: HTMLElement) => [...page.querySelectorAll('button')].at(-2);
/** What a button at work says: the words on it that show, in place of its label. */
const says = (control: HTMLElement | undefined) => control && said(control);

describe('asking to trust', () => {
  it('waits while main reads, asks and saves, saying how far it has got, and asks once', async () => {
    const page = draw(<TrustBanner tab={tabOf('t4')} />);
    act(() => bridge.push('code.status', statusOf('t4')));
    // What it will say waits unseen beside its label, so pressing it keeps its width.
    const idle = trustButton(page);
    expect(says(idle)).toBe('Trust repo…');
    expect(idle?.querySelector('[aria-hidden="true"]')?.textContent).toBe('Checking…');
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'reading' })));
    const trust = trustButton(page);
    expect(trust).toBe(idle);
    expect(says(trust)).toBe('Checking…');
    expect(trust?.getAttribute('aria-disabled')).toBe('true');
    expect(trust?.querySelector('.spinner')).not.toBeNull();
    const before = asked('code.trust');
    act(() => trust?.click());
    await act(async () => {
      await Promise.resolve();
    });
    // A second press, while main is at it, does nothing.
    expect(asked('code.trust')).toBe(before);
    // While main's dialog asks, nothing says it's trusting: the reader hasn't said so yet.
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'asking' })));
    expect(says(trust)).toBe('Waiting…');
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'saving' })));
    // The same button, which keeps focus, says what Lo does now.
    expect(trustButton(page)).toBe(trust);
    expect(says(trust)).toBe('Trusting…');
    // Trusted: the banner goes, and the status item shows the servers starting.
    act(() =>
      bridge.push('code.status', statusOf('t4', { trust: { kind: 'trusted', by: 'repo' } })),
    );
    expect(page.textContent).toBe('');
  });

  it('says why it failed, offers the settings file when that’s the cause, and asks again', async () => {
    const page = draw(<TrustBanner tab={tabOf('t5')} />);
    act(() => bridge.push('code.status', statusOf('t5')));
    const why =
      "The settings file isn't valid JSON (Expected ',' or '}' after property value in JSON at position 20). Fix that, then trust the repo again.";
    answerTrust = () => {
      throw new IpcError('settingsFile', why);
    };
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => page.textContent.includes('Couldn’t trust rozed-dev/e2e'));
    // In its own body, as an alert, with the button back.
    expect(page.querySelector('[role="alert"] p')?.textContent).toBe(
      `Couldn’t trust rozed-dev/e2e ${why}`,
    );
    expect([...page.querySelectorAll('button')].map(said)).toEqual([
      'Open settings file',
      'Trust repo…',
      '',
    ]);
    expect(button(page, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    act(() => button(page, 'Open settings file')?.click());
    await until(() => asked('settings.openFile') === 1);

    // Asked again: what failed goes at once, and a disk that can't take it says so, with nothing
    // to open.
    answerTrust = () => {
      throw new IpcError('unsaved', "Lo couldn't write the settings file (ENOSPC).");
    };
    act(() => button(page, 'Trust repo…')?.click());
    expect(page.textContent).toContain('Language servers are off for rozed-dev/e2e');
    await until(() => page.textContent.includes('(ENOSPC)'));
    expect(button(page, 'Open settings file')).toBeUndefined();

    // Asked again, and trusted.
    answerTrust = () => {
      bridge.push('code.status', statusOf('t5', { trust: { kind: 'trusted', by: 'repo' } }));
      return 'trusted';
    };
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => page.textContent === '');
  });

  it('stops saying the settings file kept it from trusting once the settings change', async () => {
    const page = draw(<TrustBanner tab={tabOf('t7')} />);
    act(() => bridge.push('code.status', statusOf('t7')));
    answerTrust = () => {
      throw new IpcError('settingsFile', "The settings file isn't valid JSON (x). Fix that.");
    };
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => page.textContent.includes('Couldn’t trust rozed-dev/e2e'));
    // Saved, as once it's fixed: the banner offers to trust it, as before it was asked.
    act(() =>
      bridge.push('settings.state', {
        file: '~/.config/lo/settings.json',
        values: {},
        problems: [],
      }),
    );
    expect(page.textContent).toContain('Language servers are off for rozed-dev/e2e');
    expect(button(page, 'Open settings file')).toBeUndefined();

    // What the file didn't cause stays, whatever the settings do.
    answerTrust = () => {
      throw new IpcError('unsaved', "Lo couldn't write the settings file (ENOSPC).");
    };
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => page.textContent.includes('(ENOSPC)'));
    act(() =>
      bridge.push('settings.state', {
        file: '~/.config/lo/settings.json',
        values: { theme: 'dark' },
        problems: [],
      }),
    );
    expect(page.textContent).toContain('(ENOSPC)');
    answerTrust = () => 'cancelled';
  });

  it('says so when main is asking about another repo, and asks it again once pressed again', async () => {
    const page = draw(<TrustBanner tab={tabOf('t8')} />);
    act(() => bridge.push('code.status', statusOf('t8')));
    const elsewhere =
      'Lo is already asking whether to trust rozed-dev/other. Answer that first, then try again.';
    answerTrust = () => {
      throw new IpcError('asking', elsewhere);
    };
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => page.textContent.includes(elsewhere));
    expect(button(page, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    answerTrust = () => 'cancelled';
    const before = asked('code.trust');
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 1);
    await until(() => !page.textContent.includes(elsewhere));
  });

  it('never waits on an answer main doesn’t give, as after a reload, but on what main says', async () => {
    const page = draw(<TrustBanner tab={tabOf('t6')} />);
    act(() => bridge.push('code.status', statusOf('t6')));
    // Main never answers this one.
    answerTrust = () => new Promise(() => undefined);
    const before = asked('code.trust');
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 1);
    // The button waits only while main says it's at it.
    expect(button(page, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    act(() => bridge.push('code.status', statusOf('t6', { trusting: 'asking' })));
    expect(trustButton(page)?.getAttribute('aria-disabled')).toBe('true');
    act(() => bridge.push('code.status', statusOf('t6')));
    act(() => button(page, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 2);
    answerTrust = () => 'cancelled';
  });

  it('keeps the palette from asking while main is at it', () => {
    expect(askable(statusOf('t', { trusting: 'asking' }), false)).toBe(
      'Lo is asking whether to trust this repo already.',
    );
    expect(askable(statusOf('t'), false)).toBe(true);
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
