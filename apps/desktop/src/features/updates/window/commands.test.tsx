// @vitest-environment jsdom
// The update commands, run as the palette and the app menu run them, with main answered by a
// stand-in bridge: each asks main for its own request and nothing else, a check says what it found
// in a note, and a refusal is said with its reason under the command's name.

import { NO_TARGET } from '@lo/ui/commands';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice, withdraw } from '../../../window/commands/notices.tsx';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import { releasePage, type CheckAnswer, type UpdateState } from '../contract.ts';
import feature from './index.ts';
import { showState, updatesStore } from './store.ts';

const defaults: Record<string, (input: unknown) => unknown> = {
  'updates.read': () => ({ status: 'idle' }),
  'updates.check': () => ({ status: 'newest', version: '0.1.0' }),
  'updates.install': () => undefined,
  'updates.restart': () => undefined,
  'updates.later': () => undefined,
  'updates.move': () => undefined,
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
});

afterEach(() => {
  const note = notice();
  if (note) withdraw(note.title, note.body);
});

/** Runs a command as the palette does, and lets what it asked of main settle. */
async function run(id: string): Promise<void> {
  await act(async () => {
    registry().run(id, NO_TARGET);
    await Promise.resolve();
  });
}

const noop = (_answer: CheckAnswer): void => {};

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
    expect(bridge.calls).toEqual([['updates.check', undefined]]);
    expect(notice()).toEqual({ title: 'Lo 0.1.0 is the newest version.', body: '', done: true });
  });

  it('says why when Lo couldn’t check, with the reason', async () => {
    answers['updates.check'] = (): CheckAnswer => ({
      status: 'failed',
      reason:
        'Lo couldn’t reach GitHub (ERR_INTERNET_DISCONNECTED). Check your connection, then try again.',
    });
    await run('updates.check');
    expect(notice()).toEqual({
      title: 'Lo couldn’t check for updates',
      body: 'Lo couldn’t reach GitHub (ERR_INTERNET_DISCONNECTED). Check your connection, then try again.',
    });
  });

  it('says why when main refused, or couldn’t be asked', async () => {
    answers['updates.check'] = () => {
      throw new IpcError('unavailable', 'Lo hasn’t started checking for updates yet.');
    };
    await run('updates.check');
    expect(notice()).toEqual({
      title: 'Lo couldn’t check for updates',
      body: 'Lo hasn’t started checking for updates yet.',
    });
    answers['updates.check'] = () => {
      throw new Error('boom');
    };
    await run('updates.check');
    expect(notice()?.body).toBe('Lo couldn’t ask for it. Try again.');
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
    expect(bridge.calls).toEqual([['updates.check', undefined]]);
    await act(async () => {
      finish({ status: 'newest', version: '0.1.0' });
      await Promise.resolve();
    });
    expect(updatesStore.getState().checking).toBe(false);
    expect(notice()?.title).toBe('Lo 0.1.0 is the newest version.');
    // Once it's over, the next is asked for as usual.
    answers['updates.check'] = defaults['updates.check'] ?? (() => undefined);
    await run('updates.check');
    expect(bridge.calls).toHaveLength(2);
  });
});

describe('the other commands', () => {
  it.each([
    ['updates.install', 'Lo couldn’t install the update'],
    ['updates.restart', 'Lo couldn’t restart to update'],
    ['updates.move', 'Lo couldn’t move to Applications'],
    ['updates.later', 'Lo couldn’t hide the update'],
  ])('%s asks main for it alone, and says why when main refuses', async (id, title) => {
    await run(id);
    expect(bridge.calls).toEqual([[id, undefined]]);
    expect(notice()).toBeUndefined();
    answers[id] = () => {
      throw new IpcError('unavailable', 'There’s no update to install.');
    };
    await run(id);
    expect(notice()).toEqual({ title, body: 'There’s no update to install.' });
  });

  it('never ask for more than they say: no command installs or restarts but its own', async () => {
    act(() => showState({ status: 'ready', version: '0.2.0' }));
    await run('updates.check');
    await run('updates.later');
    expect(bridge.calls.map(([channel]) => channel)).toEqual(['updates.check', 'updates.later']);
  });
});
