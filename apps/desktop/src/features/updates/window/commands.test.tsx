// @vitest-environment jsdom
// The update commands, run as the palette and the app menu run them, with main answered by a
// stand-in bridge: each asks main for its own request and nothing else, a check says what it found
// in a note, and a refusal is said with its reason under the command's name.

import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice, notices, withdraw } from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import { releasePage, type CheckAnswer, type UpdateState } from '../contract.ts';
import feature from './index.ts';
import { showState, updatesStore } from './store.ts';

const defaults: Record<string, (input: unknown) => unknown> = {
  'updates.read': () => ({ status: 'idle' }),
  'updates.how': () => 'page',
  'updates.check': () => ({ status: 'newest', version: '0.1.0' }),
  'updates.install': () => undefined,
  'updates.restart': () => undefined,
  'updates.later': () => undefined,
  'updates.move': () => undefined,
  'tab.openExternal': () => undefined,
  'app.info': () => ({ version: '0.1.0' }),
};
let answers = { ...defaults };

const bridge = installBridge(
  Object.fromEntries(
    Object.keys(defaults).map((channel) => [
      channel,
      (input: unknown) => answers[channel]?.(input),
    ]),
  ),
);

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands ?? [], 'mac');
});

beforeEach(() => {
  answers = { ...defaults };
  bridge.calls.length = 0;
  act(() => showState({ status: 'idle' }));
});

afterEach(() => {
  for (const note of notices()) withdraw(note.title, note.body);
});

/** Runs a command as the palette does, and lets what it asked of main settle. */
async function run(id: string): Promise<void> {
  await act(async () => {
    registry().run(id, NO_TARGET);
    await Promise.resolve();
  });
}

const noop = (_answer: CheckAnswer): void => {};

/** What was asked of main to do something, not the reads that follow a check. */
const requests = () => bridge.calls.filter(([channel]) => channel !== 'updates.how');

const OFFER: UpdateState = {
  status: 'available',
  version: '0.2.0',
  line: 'Faster diffs',
  how: 'install',
  page: releasePage('0.2.0'),
};

describe('Check for updates', () => {
  it('asks main to check, and says so in a note when nothing newer is out', async () => {
    await run('updates.check');
    expect(requests()).toEqual([['updates.check', undefined]]);
    expect(notice()).toEqual({ title: 'No update available', body: '', done: true });
  });

  it('says why when Lo couldn’t check, with the reason', async () => {
    answers['updates.check'] = (): CheckAnswer => ({
      status: 'failed',
      why: 'offline',
      details: 'ERR_INTERNET_DISCONNECTED',
    });
    await run('updates.check');
    expect(notice()).toMatchObject({
      title: 'Couldn’t check for updates',
      body: 'Offline.',
      details: 'ERR_INTERNET_DISCONNECTED',
      tone: 'danger',
    });
    expect(notice()?.action?.label).toBe('Try again');
  });

  it('offers Lo’s releases on GitHub where this copy can’t check, as a build from source', async () => {
    answers['updates.check'] = (): CheckAnswer => ({ status: 'failed', why: 'source' });
    await run('updates.check');
    // Blocked, not failed: a warning.
    expect(notice()).toMatchObject({
      title: 'Can’t check for updates',
      body: 'This copy of Lo is built from source.',
      tone: 'warning',
    });
    expect(notice()?.action?.label).toBe('Open on GitHub');
    bridge.calls.length = 0;
    await act(async () => {
      notice()?.action?.onClick();
      await Promise.resolve();
    });
    expect(bridge.calls).toEqual([
      ['tab.openExternal', { url: 'https://github.com/withlo/lo/releases' }],
    ]);
  });

  it('says why when main refused, or couldn’t be asked', async () => {
    answers['updates.check'] = () => {
      throw new IpcError('unavailable', 'Lo hasn’t started checking for updates yet.');
    };
    await run('updates.check');
    expect(notice()).toMatchObject({ title: 'Couldn’t check for updates', body: '' });
    expect(notice()?.action?.label).toBe('Try again');
    answers['updates.check'] = () => {
      throw new Error('boom');
    };
    await run('updates.check');
    expect(notice()).toMatchObject({
      title: 'Couldn’t check for updates',
      body: '',
      details: 'boom',
    });
  });

  it('leaves a newer Lo, one downloading and one ready to their toasts, with no note', async () => {
    const found: CheckAnswer[] = [
      OFFER,
      { status: 'downloading', version: '0.2.0', received: 1, total: 2 },
      { status: 'ready', version: '0.2.0' },
    ];
    for (const answer of found) {
      answers['updates.check'] = () => answer;
      await run('updates.check');
      expect(notice()).toBeUndefined();
    }
  });

  it('is asked once while a check is going, whoever asks again, and the button says so', async () => {
    let finish = noop;
    answers['updates.check'] = () =>
      new Promise<CheckAnswer>((resolve) => {
        finish = resolve;
      });
    await run('updates.check');
    expect(updatesStore.getState().checking).toBe(true);
    await run('updates.check');
    expect(requests()).toEqual([['updates.check', undefined]]);
    await act(async () => {
      finish({ status: 'newest', version: '0.1.0' });
      await Promise.resolve();
    });
    expect(updatesStore.getState().checking).toBe(false);
    expect(notice()?.title).toBe('No update available');
    // Once it's over, the next is asked for as usual.
    answers['updates.check'] = defaults['updates.check'] ?? (() => undefined);
    await run('updates.check');
    expect(requests()).toHaveLength(2);
  });
});

describe('the other commands', () => {
  /** What each applies to, since the app menu and the palette refuse one that doesn't. */
  const WHEN: Record<string, UpdateState> = {
    'updates.install': OFFER,
    'updates.restart': { status: 'ready', version: '0.2.0' },
    'updates.move': { ...OFFER, how: 'move' },
    'updates.later': OFFER,
  };

  it.each([
    ['updates.install', 'Couldn’t update Lo'],
    ['updates.restart', 'Couldn’t restart Lo'],
    ['updates.move', 'Couldn’t move Lo to Applications'],
    ['updates.later', 'Couldn’t hide the update'],
  ])('%s asks main for it alone, and says why when main refuses or it fails', async (id, title) => {
    act(() => showState(WHEN[id] ?? OFFER));
    await run(id);
    expect(requests()).toEqual([[id, undefined]]);
    expect(notice()).toBeUndefined();
    // Refused as not applying now: the reason alone.
    answers[id] = () => {
      throw new IpcError('unavailable', 'No update available');
    };
    await run(id);
    expect(notice()).toEqual({ title: 'No update available', body: '' });
    // Failed: what failed, with main's words behind Details, since nothing in view holds it.
    answers[id] = () => {
      throw new IpcError('failed', 'Failed to copy Lo.app');
    };
    await run(id);
    expect(notice()).toEqual({ title, body: '', details: 'Failed to copy Lo.app', tone: 'danger' });
  });

  it('never ask for more than they say: no command installs or restarts but its own', async () => {
    act(() => showState({ status: 'ready', version: '0.2.0' }));
    await run('updates.check');
    // Hiding applies to an offer, not to an update that's ready: it's refused before main hears.
    await run('updates.later');
    expect(requests().map(([channel]) => channel)).toEqual(['updates.check']);
    expect(notice()).toEqual({ title: 'Lo 0.2.0 is ready', body: '' });
  });
});
