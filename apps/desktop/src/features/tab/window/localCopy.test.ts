// Showing and copying the local copy's folder from the window: main does both with the whole path,
// and the window says how a copy went on the details' Copy path while it's drawn, else in a toast.

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { LocalState } from '../contract.ts';
import { answerLocalCopies, copyLocalPath, localShowable, showLocalCopy } from './localCopy.ts';

const seen = vi.hoisted(() => ({
  tab: undefined as { id: string; kind: string } | undefined,
  locals: new Map<string, LocalState>(),
  copyLocal: vi.fn<(input: { id: string }) => Promise<void>>(),
  showLocal: vi.fn<(input: { id: string }) => Promise<void>>(),
  announce: vi.fn<(text: string) => void>(),
  fail: vi.fn<(title: string, reason?: string) => void>(),
}));

vi.mock('./main.ts', () => ({
  main: () => ({ copyLocal: seen.copyLocal, showLocal: seen.showLocal }),
}));
vi.mock('./shared.ts', () => ({ activeTab: () => seen.tab }));
vi.mock('./store.ts', () => ({ pullsStore: { getState: () => ({ locals: seen.locals }) } }));
vi.mock('../../../window/commands/notices.tsx', () => ({
  announce: seen.announce,
  fail: seen.fail,
  saidBy: (error: unknown) => (error instanceof Error ? error.message : undefined),
}));

const READY: LocalState = {
  kind: 'ready',
  head: '5530830f2c1dfa8b3c6a4e8f0d2b7a9c1e3f5d70',
  base: '1111111111111111111111111111111111111111',
  mergeBase: null,
  offline: false,
  folder: '~/Library/Caches/lo/repos/github.com/rozed-dev/e2e.git',
};

afterEach(() => {
  seen.tab = undefined;
  seen.locals.clear();
  vi.clearAllMocks();
});

/** A pull request's tab on screen, its local copy as `local` says. */
function onScreen(local: LocalState): void {
  seen.tab = { id: 'v1', kind: 'pull' };
  seen.locals.set('v1', local);
}

describe('the local copy’s folder', () => {
  it('can be shown or copied only once the copy on screen is ready, saying why not', () => {
    expect(localShowable()).toBe('Open a pull request first');
    onScreen({ kind: 'waiting' });
    expect(localShowable()).toBe('The local copy isn’t ready');
    onScreen(READY);
    expect(localShowable()).toBe(true);
  });

  it('is copied whole by main, and says so in a toast where no Copy path is drawn', async () => {
    onScreen(READY);
    seen.copyLocal.mockResolvedValue();
    await copyLocalPath();
    expect(seen.copyLocal).toHaveBeenCalledWith({ id: 'v1' });
    expect(seen.announce).toHaveBeenCalledWith('Copied path');

    seen.copyLocal.mockRejectedValue(new Error('The local copy isn’t ready.'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await copyLocalPath();
    expect(seen.fail).toHaveBeenCalledWith('Couldn’t copy the path', 'The local copy isn’t ready.');
  });

  it('says how a copy went on the Copy path drawn for the view, and in no toast', async () => {
    onScreen(READY);
    const said = vi.fn<(said: string) => void>();
    const stop = answerLocalCopies('v1', said);
    seen.copyLocal.mockResolvedValue();
    await copyLocalPath();
    expect(said).toHaveBeenCalledWith('copied');
    seen.copyLocal.mockRejectedValue(new Error('No clipboard.'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await copyLocalPath();
    expect(said).toHaveBeenLastCalledWith('failed');
    expect(seen.announce).not.toHaveBeenCalled();
    expect(seen.fail).not.toHaveBeenCalled();
    // Once it's gone, a toast says it again.
    stop();
    seen.copyLocal.mockResolvedValue();
    await copyLocalPath();
    expect(seen.announce).toHaveBeenCalledWith('Copied path');
  });

  it('says why main couldn’t show it, as when its folder is gone', async () => {
    onScreen(READY);
    seen.showLocal.mockRejectedValue(new Error('Its folder was moved or deleted.'));
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await showLocalCopy();
    expect(seen.showLocal).toHaveBeenCalledWith({ id: 'v1' });
    expect(seen.fail).toHaveBeenCalledWith(
      'Couldn’t show the local copy',
      'Its folder was moved or deleted.',
    );
  });
});
