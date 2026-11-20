// @vitest-environment jsdom
// The app menu's items for updates are made again when what applies changes, which is when where
// updates stand changes in status or in how Lo takes the update, or a check starts or ends; and not
// as a download's bytes come, which would send the menu a dozen times a second.

import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { onMenuStale } from '../../../window/commands/bar.ts';
import { createRegistry, registry } from '../../../window/commands/registry.ts';
import { installBridge } from '../../../window/test/bridge.ts';
import { releasePage, type UpdateState } from '../contract.ts';
import feature from './index.ts';
import { showState, updatesStore } from './store.ts';
import { menuKey } from './applies.ts';

let finish: (answer: unknown) => void = () => {};
const bridge = installBridge({
  'updates.read': () => ({ status: 'idle' }),
  'updates.check': () =>
    new Promise((resolve) => {
      finish = resolve;
    }),
  'app.info': () => ({ version: '0.1.0' }),
});

/** How many times the menu has been told it's stale. */
let told = 0;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry(feature.commands ?? [], 'mac');
  feature.start?.();
  onMenuStale(() => {
    told += 1;
  });
});

beforeEach(() => {
  act(() => showState({ status: 'idle' }));
  told = 0;
});

afterEach(() => {
  bridge.calls.length = 0;
});

const down = (received: number): UpdateState => ({
  status: 'downloading',
  version: '0.2.0',
  received,
  total: 100,
});

const offer = (how: 'install' | 'page', version = '0.2.0'): UpdateState => ({
  status: 'available',
  version,
  line: '',
  how,
  page: releasePage(version),
});

describe('what the menu depends on', () => {
  it('is the status, how an offer is taken and whether a check is going, and nothing of progress', () => {
    expect(menuKey(down(1), false)).toBe(menuKey(down(99), false));
    expect(menuKey(offer('install'), false)).not.toBe(menuKey(offer('page'), false));
    expect(menuKey(offer('install'), false)).toBe(menuKey(offer('install', '0.3.0'), false));
    expect(menuKey({ status: 'idle' }, true)).not.toBe(menuKey({ status: 'idle' }, false));
  });
});

describe('the app menu', () => {
  it('is told when updates go from nothing to an offer, a download and an update that’s ready', () => {
    act(() => bridge.push('updates.state', offer('page')));
    expect(told).toBe(1);
    act(() =>
      bridge.push('updates.state', {
        status: 'downloading',
        version: '0.2.0',
        received: 1,
        total: 9,
      }),
    );
    expect(told).toBe(2);
    act(() => bridge.push('updates.state', { status: 'ready', version: '0.2.0' }));
    expect(told).toBe(3);
    act(() => bridge.push('updates.state', { status: 'idle' }));
    expect(told).toBe(4);
  });

  it('is told once for how an offer is taken changing, and not for the same offer again or a newer one', () => {
    act(() => bridge.push('updates.state', offer('page')));
    act(() => bridge.push('updates.state', offer('page')));
    act(() => bridge.push('updates.state', offer('page', '0.3.0')));
    expect(told).toBe(1);
    act(() => bridge.push('updates.state', offer('install', '0.3.0')));
    expect(told).toBe(2);
  });

  it('is not told as a download’s bytes come', () => {
    act(() =>
      bridge.push('updates.state', {
        status: 'downloading',
        version: '0.2.0',
        received: 0,
        total: 100,
      }),
    );
    told = 0;
    for (const received of [10, 20, 30, 60, 100]) {
      act(() =>
        bridge.push('updates.state', {
          status: 'downloading',
          version: '0.2.0',
          received,
          total: 100,
        }),
      );
    }
    expect(told).toBe(0);
  });

  it('is told as a check the reader asked for starts and ends', async () => {
    act(() => updatesStore.setState({ checking: false }));
    await act(async () => {
      registry().run('updates.check', { kind: 'none' });
      await Promise.resolve();
    });
    expect(told).toBe(1);
    await act(async () => {
      finish({ status: 'newest', version: '0.1.0' });
      await Promise.resolve();
    });
    expect(told).toBe(2);
  });
});
