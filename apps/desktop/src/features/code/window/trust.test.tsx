// @vitest-environment jsdom
// Trust in the window, with main answered by a stand-in bridge: the Language servers item's
// details say what main decided and only ask main, open by themselves once for a repo at the first
// `g d`, and their button says how far main has got and waits meanwhile; once trusting failed they
// say why, offering to open the settings file and to try again; the palette's commands act only
// where they can, and Settings lists what's trusted, from the file, with "Stop trusting".

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { Servers, Status } from '../contract.ts';
import { readTrusted } from '../settings.ts';
import feature from './index.ts';
import { ServerItems } from './ServerItems.tsx';
import { offered } from './servers.ts';
import { askable, offerOf, offerOnce, trustable, untrustable } from './status.ts';
import { rowsOf } from './Trusted.tsx';

/** What main says of each view, by its id. */
const states = new Map<string, Status>();

/** How main answers `code.trust`, which a test sets. */
let answerTrust: (input: unknown) => unknown = () => 'cancelled';

/** What main says of each view's servers, by its id: off, as nothing trusts them. */
const off = (view: string): Servers => ({ view, off: true, servers: [] });

const bridge = installBridge({
  'code.state': (input) => states.get(String(Reflect.get(Object(input), 'view'))) ?? null,
  'code.servers': (input) => off(String(Reflect.get(Object(input), 'view'))),
  'code.trust': (input) => answerTrust(input),
  'code.untrust': () => undefined,
  'code.dismiss': () => undefined,
  'settings.openFile': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // Where the window puts the items' details, as its page has.
  const root = document.createElement('div');
  root.id = 'root';
  document.body.append(root);
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

/** Draws tab `id`'s Language servers item, off as nothing trusts its view, as `change` says. */
function offItem(id: string, change: Partial<Status> = {}): HTMLElement {
  const page = draw(<ServerItems tab={tabOf(id)} />);
  act(() => {
    bridge.push('code.served', off(id));
    bridge.push('code.status', statusOf(id, change));
  });
  return page;
}

/** The item's details, open over it, or nothing while they're closed. */
const details = () => document.querySelector<HTMLElement>('.status-details') ?? undefined;

/** Lets the details mount, and take focus as they do. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Opens the item's details, as a click on it does, and gives them. */
async function open(page: HTMLElement): Promise<HTMLElement> {
  act(() => page.querySelector('button')?.click());
  await settle();
  const shown = details();
  expect(shown).toBeDefined();
  return shown ?? page;
}

/** What main says once a view is trusted: so, and its servers starting. */
function trustedNow(id: string): void {
  bridge.push('code.status', statusOf(id, { trust: { kind: 'trusted', by: 'repo' } }));
  bridge.push('code.served', {
    view: id,
    off: false,
    servers: [{ id: 'typescript', name: 'TypeScript', state: { kind: 'starting' } }],
  });
}

describe('the Language servers item', () => {
  it('says language servers are off for a repository nothing trusts, and only asks main', async () => {
    const page = offItem('t1');
    expect(page.textContent).toBe('Language servers off');
    const shown = await open(page);
    // One fact, in one line, and one button.
    expect(shown.querySelector('p')?.textContent).toBe(
      'Language servers are off for rozed-dev/e2e',
    );
    expect([...shown.querySelectorAll('button')].map(said)).toEqual(['Trust repo…']);
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => bridge.calls.some(([channel]) => channel === 'code.trust'));
    expect(bridge.calls.find(([channel]) => channel === 'code.trust')?.[1]).toEqual({
      view: 't1',
      repo: 'rozed-dev/e2e',
      pull: null,
    });
    // Main hasn't said it's trusted, so the details stay, saying the same.
    expect(details()?.textContent).toContain('Language servers are off');
  });

  it('offers a fork’s pull request alone', async () => {
    const shown = await open(
      offItem('t2', { pull: 97, head: { kind: 'fork', repo: 'rozed-bot/e2e' } }),
    );
    expect(shown.textContent).toContain('Language servers are off for the fork rozed-bot/e2e');
    act(() => button(shown, 'Trust pull request…')?.click());
    await until(() =>
      bridge.calls.some(
        ([channel, input]) => channel === 'code.trust' && Reflect.get(Object(input), 'pull') === 97,
      ),
    );
  });

  it('offers nothing to trust for a fork GitHub no longer has', async () => {
    const shown = await open(offItem('t10', { head: { kind: 'gone' } }));
    expect(shown.textContent).toBe('Language servers are off for a fork that no longer exists');
    expect(shown.querySelector('button')).toBeNull();
  });

  it('offers to trust only a view nothing trusts, with git', () => {
    expect(offerOf(null)).toBeUndefined();
    for (const trust of [
      { kind: 'noGit' },
      { kind: 'checking' },
      { kind: 'waiting' },
      { kind: 'trusted', by: 'repo' },
      // Lo couldn't check what may trust it: the item would offer what's there already.
      { kind: 'untrusted', why: 'unread' },
    ] as const) {
      expect(offerOf(statusOf('t', { trust }))).toBeUndefined();
    }
    // A repository by the name trusted that isn't the one.
    expect(offerOf(statusOf('t', { trust: { kind: 'untrusted', why: 'other' } }))).toEqual({
      line: 'Language servers are off for rozed-dev/e2e',
      pull: false,
    });
    // Offered once already, it's offered still, in the item's details.
    expect(offerOf(statusOf('t', { dismissed: true }))?.pull).toBe(false);
  });

  it('opens by itself once for a repo, at the first `g d`, and leaves focus where it was', async () => {
    const page = offItem('t3');
    const elsewhere = document.createElement('button');
    document.body.append(elsewhere);
    onTestFinished(() => elsewhere.remove());
    elsewhere.focus();
    act(() => offerOnce('t3'));
    await settle();
    expect(details()?.textContent).toContain('Language servers are off for rozed-dev/e2e');
    expect(document.activeElement).toBe(elsewhere);
    // Main keeps that it was offered, for every tab of the repository.
    await until(() => bridge.calls.some(([channel]) => channel === 'code.dismiss'));
    expect(bridge.calls.find(([channel]) => channel === 'code.dismiss')?.[1]).toEqual({
      view: 't3',
    });
    act(() => offered.set('t3', 'closed'));
    act(() => offerOnce('t3'));
    expect(offered.get('t3')).toBe('closed');
    // A click opens them as ever, and they take focus then.
    await open(page);
    expect(offered.get('t3')).toBe('open');
  });

  it('closes the offer once the view is trusted, so a later Stop trusting finds the item closed', async () => {
    const page = offItem('t16');
    act(() => offerOnce('t16'));
    await settle();
    expect(details()).toBeDefined();
    // Trusted: the item gives way to the servers starting, and the offer is done.
    act(() => trustedNow('t16'));
    expect(offered.get('t16')).toBe('closed');
    // Stop trusting brings the item back, closed and asking nothing.
    act(() => {
      bridge.push('code.served', off('t16'));
      bridge.push('code.status', statusOf('t16', { dismissed: true }));
    });
    await settle();
    expect(page.textContent).toBe('Language servers off');
    expect(details()).toBeUndefined();
    // Servers no longer off by any road, as by a file fixed by hand, close it too.
    act(() => offered.set('t16', 'open'));
    act(() => bridge.push('code.served', { view: 't16', off: false, servers: [] }));
    expect(offered.get('t16')).toBe('closed');
  });

  it('doesn’t open by itself where it was offered, while Lo asks, or where nothing can be trusted', () => {
    // Nor where there's no item, as where Lo has no language server for what the view shows.
    act(() => bridge.push('code.status', statusOf('t15')));
    act(() => offerOnce('t15'));
    expect(offered.get('t15')).toBe('closed');
    for (const [id, change] of [
      ['t11', { dismissed: true }],
      ['t12', { trusting: 'asking' }],
      ['t13', { head: { kind: 'gone' } }],
      ['t14', { trust: { kind: 'trusted', by: 'repo' } }],
    ] as const) {
      act(() => {
        bridge.push('code.served', off(id));
        bridge.push('code.status', statusOf(id, change));
      });
      act(() => offerOnce(id));
      expect(offered.get(id)).toBe('closed');
    }
  });

  it('asks main where a view drawn before it said anything stands', async () => {
    states.set('t9', statusOf('t9'));
    const page = draw(<ServerItems tab={tabOf('t9')} />);
    await until(() => page.textContent === 'Language servers off');
    expect(
      bridge.calls.some(
        ([channel, input]) =>
          channel === 'code.state' && Reflect.get(Object(input), 'view') === 't9',
      ),
    ).toBe(true);
  });
});
/** How many times the window asked main for `channel`. */
const asked = (channel: string) => bridge.calls.filter(([name]) => name === channel).length;
/** The details' button that trusts, whatever it says now: the last of their buttons. */
const trustButton = (page: HTMLElement | undefined) =>
  [...(page?.querySelectorAll('button') ?? [])].at(-1);
/** What a button at work says: the words on it that show, in place of its label. */
const says = (control: HTMLElement | undefined) => control && said(control);

describe('asking to trust', () => {
  it('waits while main reads, asks and saves, saying how far it has got, and asks once', async () => {
    const page = offItem('t4');
    const shown = await open(page);
    // What it will say waits unseen beside its label, so pressing it keeps its width.
    const idle = trustButton(shown);
    expect(says(idle)).toBe('Trust repo…');
    const unseen = () =>
      [...(idle?.querySelectorAll('.invisible') ?? [])].map((face) => face.textContent);
    // Its widest words hold their room from the start.
    expect(unseen()).toContain('Trusting…');
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'reading' })));
    const trust = trustButton(details());
    expect(trust).toBe(idle);
    expect(says(trust)).toBe('Waiting…');
    expect(trust?.getAttribute('aria-disabled')).toBe('true');
    expect(trust?.querySelector('.spinner')).not.toBeNull();
    const before = asked('code.trust');
    act(() => trust?.click());
    await act(async () => {
      await Promise.resolve();
    });
    // A second press, while main is at it, does nothing.
    expect(asked('code.trust')).toBe(before);
    // While main's dialog asks, it says the same: the reader hasn't said to trust yet.
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'asking' })));
    expect(says(trust)).toBe('Waiting…');
    act(() => bridge.push('code.status', statusOf('t4', { trusting: 'saving' })));
    // The same button, which keeps focus, says what Lo does now.
    expect(trustButton(details())).toBe(trust);
    expect(says(trust)).toBe('Trusting…');
    // Its widest words keep their room through every stage, so it's one width throughout.
    expect(unseen()).toEqual(['Trust repo…', 'Trusting…']);
    // Trusted: the item gives way to the servers starting.
    act(() => trustedNow('t4'));
    expect(page.textContent).not.toContain('Language servers off');
    expect(page.textContent).toContain('TypeScript');
  });

  it('says why it failed, offers the settings file when that’s the cause, and asks again', async () => {
    const shown = await open(offItem('t5'));
    const why =
      "The settings file isn't valid JSON (Expected ',' or '}' after property value in JSON at position 20).";
    answerTrust = () => {
      throw new IpcError('settingsFile', why);
    };
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => shown.textContent.includes('Couldn’t trust rozed-dev/e2e'));
    // As a Problem in the details, under their line: the reason in the window's words, and what
    // the file holds behind Details.
    const alert = () => [...shown.querySelectorAll('[role="alert"] p')].map((p) => p.textContent);
    expect(alert()).toEqual(['Couldn’t trust rozed-dev/e2e', 'settings.json has an error.']);
    expect([...shown.querySelectorAll('button')].map(said)).toEqual([
      'Open settings.json',
      'Details',
      'Trust repo…',
    ]);
    expect(button(shown, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    act(() => button(shown, 'Open settings.json')?.click());
    await until(() => asked('settings.openFile') === 1);

    // Asked again: what failed goes at once, and a disk that can't take it says so, with nothing
    // to open.
    answerTrust = () => {
      throw new IpcError('unsaved', "Lo couldn't write the settings file (ENOSPC).");
    };
    act(() => button(shown, 'Trust repo…')?.click());
    expect(shown.textContent).toContain('Language servers are off for rozed-dev/e2e');
    await until(() => shown.textContent.includes('couldn’t be saved'));
    expect(button(shown, 'Open settings.json')).toBeUndefined();

    // Asked again, and trusted.
    answerTrust = () => {
      trustedNow('t5');
      return 'trusted';
    };
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => details() === undefined || !details()?.textContent.includes('Couldn’t'));
  });

  it('stops saying the settings file kept it from trusting once the settings change', async () => {
    const shown = await open(offItem('t7'));
    answerTrust = () => {
      throw new IpcError('settingsFile', "The settings file isn't valid JSON (x). Fix that.");
    };
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => shown.textContent.includes('Couldn’t trust rozed-dev/e2e'));
    // What main read as it refused, which can reach the window after the refusal: the file still
    // can't be read, so what it said stays.
    act(() =>
      bridge.push('settings.state', {
        file: '~/.config/lo/settings.json',
        values: {},
        problems: [{ message: "The settings file isn't valid JSON (x)." }],
      }),
    );
    expect(shown.textContent).toContain('Couldn’t trust rozed-dev/e2e');
    // Saved, as once it's fixed, with an entry Lo ignores, which doesn't keep it from trusting:
    // the details offer to trust it, as before it was asked.
    const ignored = [42];
    act(() =>
      bridge.push('settings.state', {
        file: '~/.config/lo/settings.json',
        values: { 'code.trusted': ignored },
        problems: readTrusted(ignored).problems.map((message) => ({
          key: 'code.trusted',
          message,
        })),
      }),
    );
    expect(shown.textContent).not.toContain('Couldn’t trust');
    expect(button(shown, 'Open settings.json')).toBeUndefined();

    // What the file didn't cause stays, whatever the settings do.
    answerTrust = () => {
      throw new IpcError('unsaved', "Lo couldn't write the settings file (ENOSPC).");
    };
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => shown.textContent.includes('couldn’t be saved'));
    act(() =>
      bridge.push('settings.state', {
        file: '~/.config/lo/settings.json',
        values: { theme: 'dark' },
        problems: [],
      }),
    );
    expect(shown.textContent).toContain('couldn’t be saved');
    answerTrust = () => 'cancelled';
  });

  it('says so when main is asking about another repo, and asks it again once pressed again', async () => {
    // A refusal's reason, as an error's body line in the details: a sentence, with its full stop.
    const shown = await open(offItem('t8'));
    const elsewhere = 'Answer the question about rozed-dev/other first.';
    answerTrust = () => {
      throw new IpcError('asking', 'rozed-dev/other');
    };
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => shown.textContent.includes(elsewhere));
    expect(button(shown, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    answerTrust = () => 'cancelled';
    const before = asked('code.trust');
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 1);
    await until(() => !shown.textContent.includes(elsewhere));
  });

  it('never waits on an answer main doesn’t give, as after a reload, but on what main says', async () => {
    const shown = await open(offItem('t6'));
    // Main never answers this one.
    answerTrust = () => new Promise(() => undefined);
    const before = asked('code.trust');
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 1);
    // The button waits only while main says it's at it.
    expect(button(shown, 'Trust repo…')?.getAttribute('aria-disabled')).toBeNull();
    act(() => bridge.push('code.status', statusOf('t6', { trusting: 'asking' })));
    expect(trustButton(shown)?.getAttribute('aria-disabled')).toBe('true');
    act(() => bridge.push('code.status', statusOf('t6')));
    act(() => button(shown, 'Trust repo…')?.click());
    await until(() => asked('code.trust') === before + 2);
    answerTrust = () => 'cancelled';
  });

  it('keeps the palette from asking while main is at it', () => {
    expect(askable(statusOf('t', { trusting: 'asking' }), false)).toBe(
      'Answer the open question first',
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
    expect(trustable(repo, true)).toBe('This pull request isn’t from a fork');
    expect(trustable(fork, true)).toBe(true);
    expect(trustable(fork, false)).toBe('This pull request is from a fork');
    expect(trustable(trusted, false)).toBe('rozed-dev/e2e is already trusted');
    expect(trustable(statusOf('t', { trust: { kind: 'trusted', by: 'pull' } }), true)).toBe(
      'This pull request is already trusted',
    );
    expect(trustable(statusOf('t', { head: { kind: 'gone' } }), true)).toBe(
      'The fork no longer exists',
    );
    expect(trustable(statusOf('t', { trust: { kind: 'noGit' } }), false)).toBe('Git wasn’t found');
    expect(trustable('Open a pull request first', false)).toBe('Open a pull request first');
    expect(untrustable(trusted)).toBe(true);
    expect(untrustable(repo)).toBe('This repo isn’t trusted');
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
      { key: 'R_e2e', name: 'rozed-dev/e2e', kind: 'repo', trusted: 'trusted 12 d ago' },
      { key: 'R_e2e#97', name: 'rozed-bot/e2e#97', kind: 'fork', trusted: 'trusted just now' },
    ]);
    // One added in the file by hand has no time, and says so.
    const [byHand] = rowsOf([{ kind: 'repo', repo: 'rozed-dev/e2e', id: 'R_e2e' }], now);
    expect(typeof byHand?.trusted).toBe('object');
  });
});
