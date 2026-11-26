import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import type { RequestGate } from '../client.ts';
import type { PullFiles, ReadFiles } from '../files.ts';
import { PullRef } from '../refs.ts';
import { RequestQueue } from './queue.ts';
import { FilesUnwanted, PULL_FILES_KEPT_FOR, SharedPullFiles } from './shared-files.ts';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const PULL = new PullRef('octo', 'repo', 1);
const LIMITS: ReadFiles = { maxPages: 3, keepRequests: 0 };

/** A made-up read of the files: `pages` requests of 100 ms each, through the gate, logged. */
function pagesRead(pages: number, log: string[]) {
  return async (_pull: PullRef, _limits: ReadFiles, gate: RequestGate): Promise<PullFiles> => {
    for (let page = 1; page <= pages; page++) {
      const release = await gate();
      try {
        log.push(`files ${page}`);
        await new Promise((resolve) => setTimeout(resolve, 100));
      } finally {
        release();
      }
    }
    return { files: [], head: undefined, cutShort: undefined };
  };
}

test('a pull requests files are read once for everyone who asks, and kept a while', async () => {
  const log: string[] = [];
  const shared = new SharedPullFiles(pagesRead(2, log));
  const wanted = { wanted: () => true };
  const both = Promise.all([
    shared.read(PULL, 'abc', LIMITS, wanted),
    shared.read(PULL, 'abc', LIMITS, wanted),
  ]);
  await vi.advanceTimersByTimeAsync(300);
  const [diff, tree] = await both;
  expect(tree).toBe(diff);
  expect(await shared.read(PULL, 'abc', LIMITS, wanted)).toBe(diff);
  // Another head is read afresh, and so is this one once it's been kept long enough.
  void shared.read(PULL, 'def', LIMITS, wanted);
  await vi.advanceTimersByTimeAsync(PULL_FILES_KEPT_FOR);
  void shared.read(PULL, 'abc', LIMITS, wanted);
  await vi.advanceTimersByTimeAsync(300);
  expect(log).toEqual(['files 1', 'files 2', 'files 1', 'files 2', 'files 1', 'files 2']);
});

test('a pull requests files read nothing more once nobody wants them, and the next ask reads again', async () => {
  const log: string[] = [];
  const shared = new SharedPullFiles(pagesRead(3, log));
  let wanted = true;
  const first = shared.read(PULL, 'abc', LIMITS, { wanted: () => wanted }).catch((error) => error);
  await vi.advanceTimersByTimeAsync(50);
  // The tab closed, or another head is on screen, as the first page is read.
  wanted = false;
  await vi.advanceTimersByTimeAsync(500);
  expect(await first).toBeInstanceOf(FilesUnwanted);
  expect(log).toEqual(['files 1']);
  const again = shared.read(PULL, 'abc', LIMITS, { wanted: () => true });
  await vi.advanceTimersByTimeAsync(500);
  await again;
  expect(log).toEqual(['files 1', 'files 1', 'files 2', 'files 3']);
});

test('a pull requests files go ahead of background reads while someone who wants them waits on them', async () => {
  const log: string[] = [];
  const queue = new RequestQueue(0);
  const shared = new SharedPullFiles(pagesRead(2, log), queue);
  queue.giveWayWhile(() => shared.leads());
  const background = (name: string) =>
    queue.read(async () => {
      log.push(name);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
  void background('a');
  void background('b');
  let onScreen = false;
  void shared.read(PULL, 'abc', LIMITS, {
    wanted: () => true,
    priority: () => (onScreen ? 'foreground' : 'background'),
  });
  // Its tab comes on screen while the first read runs.
  onScreen = true;
  await vi.advanceTimersByTimeAsync(1000);
  expect(log).toEqual(['a', 'files 1', 'files 2', 'b']);
});
