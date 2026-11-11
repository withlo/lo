// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { Bridge } from '../../../ipc/bridge.ts';
import { contract, FOLDERS_LIMIT, type TreePath } from '../contract.ts';
import { askFolders, folders, showState } from './store.ts';

/** The folders asked for in each request. */
const asked: number[] = [];

beforeAll(() => {
  const bridge: Bridge = {
    invoke: vi.fn<Bridge['invoke']>((channel, input) => {
      const parsed = contract.requests.folder.input.safeParse(input);
      // A request the contract refuses counts as none.
      asked.push(parsed.success ? parsed.data.paths.length : 0);
      if (channel !== 'tree.folder' || !parsed.success) {
        return Promise.resolve({ ok: false, error: { code: 'invalid', message: 'refused' } });
      }
      return Promise.resolve({
        ok: true,
        value: parsed.data.paths.map((path) => ({ path, entries: [] })),
      });
    }),
    subscribe: vi.fn<Bridge['subscribe']>(() => () => undefined),
  };
  Reflect.set(window, 'lo', bridge);
});

afterEach(() => {
  asked.length = 0;
});

const AT = 'a'.repeat(40);

describe('asking main for folders', () => {
  it('asks in batches main takes, so more than it takes at once all load', async () => {
    showState({
      id: 't1',
      at: AT,
      listing: { kind: 'folders', root: [] },
      from: 'local',
      changes: [],
      changesFrom: 'local',
      partial: false,
      problem: null,
      omitted: 0,
    });
    const paths: TreePath[] = Array.from({ length: 600 }, (_, index) => ({ text: `d${index}` }));
    askFolders('t1', AT, paths);
    // Asked again while waiting: nothing more goes.
    askFolders('t1', AT, paths);
    await vi.waitFor(() => expect(folders.get('t1').entries.size).toBe(600));
    expect(asked).toEqual([FOLDERS_LIMIT, 100]);
  });
});
