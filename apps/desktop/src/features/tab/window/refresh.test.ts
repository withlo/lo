// The reader's refresh from the window: main reads the tab on screen again, by its view on screen,
// while its mark in the strip turns; asking again meanwhile asks nothing more.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Connection, PullView, Tab } from '../contract.ts';
import { refresh, refreshable, refreshingStore } from './refresh.ts';
import { pullsStore, showTabs } from './store.ts';

const seen = vi.hoisted(() => ({
  refresh: vi.fn<(input: { id: string }) => Promise<void>>(),
}));

vi.mock('./main.ts', () => ({ main: () => ({ refresh: seen.refresh }) }));

const stack: Tab = {
  id: 'a',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 82,
  layer: 83,
  layers: [82, 83],
};

const queue: Tab = {
  id: 'q',
  kind: 'queue',
  owner: 'rozed-dev',
  repo: 'e2e',
  branch: 'main',
  login: 'rozed-bot',
};

/** `tab` on screen, its view on screen standing with GitHub as `connection` says. */
function onScreen(tab: Tab, connection: Connection = { kind: 'live' }): void {
  showTabs({ tabs: [tab, { id: 'r', kind: 'recent' }], active: tab.id });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only the connection is read.
  const view = { id: 'a:83', connection } as PullView;
  pullsStore.setState({ views: new Map([['a:83', view]]) });
}

afterEach(() => {
  refreshingStore.setState({ ids: new Set() });
  vi.clearAllMocks();
});

describe('refreshing the tab on screen', () => {
  it('reads a pull request’s or a merge queue’s tab again, and nothing on Recent or Settings', () => {
    onScreen(stack);
    expect(refreshable()).toBe(true);
    onScreen(queue);
    expect(refreshable()).toBe(true);
    showTabs({ tabs: [{ id: 'r', kind: 'recent' }], active: 'r' });
    expect(refreshable()).toBe('');
    showTabs({ tabs: [{ id: 's', kind: 'settings' }], active: 's' });
    expect(refreshable()).toBe('');
  });

  it('says why a pull request’s tab can’t be read now', () => {
    onScreen(stack, { kind: 'signedOut', login: 'rozed-bot' });
    expect(refreshable()).toBe('Sign in again to refresh');
    onScreen(stack, { kind: 'rateLimited', login: 'rozed-bot', until: 0, secondary: false });
    expect(refreshable()).toBe('Rate limit reached');
  });

  it('asks main by the view on screen, and marks the tab until main has read it', async () => {
    onScreen(stack);
    const read = Promise.withResolvers<undefined>();
    seen.refresh.mockReturnValue(read.promise);
    const refreshing = refresh();
    expect(seen.refresh).toHaveBeenCalledExactlyOnceWith({ id: 'a:83' });
    expect(refreshingStore.getState().ids).toEqual(new Set(['a']));
    // Asked again meanwhile, nothing more is asked, and nothing is said.
    expect(refreshable()).toBe('');
    await refresh();
    expect(seen.refresh).toHaveBeenCalledOnce();
    read.resolve(undefined);
    await refreshing;
    expect(refreshingStore.getState().ids).toEqual(new Set());
    expect(refreshable()).toBe(true);
  });

  it('stops marking the tab when main couldn’t be asked', async () => {
    onScreen(queue);
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    seen.refresh.mockRejectedValue(new Error('main is gone'));
    await refresh();
    expect(seen.refresh).toHaveBeenCalledExactlyOnceWith({ id: 'q' });
    expect(refreshingStore.getState().ids).toEqual(new Set());
    expect(logged).toHaveBeenCalledOnce();
    logged.mockRestore();
  });
});
