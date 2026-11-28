import { expect, test } from 'vitest';

import { Refreshes } from './refreshes.ts';

test('a refresh waits for every part of the tab, and one asked for meanwhile waits on it', async () => {
  const refreshes = new Refreshes(() => {});
  const pull = Promise.withResolvers<undefined>();
  const asked: string[] = [];
  refreshes.listen((id) => {
    asked.push(`pull ${id}`);
    return pull.promise;
  });
  // A part the tab doesn't show answers nothing.
  refreshes.listen((id) => {
    asked.push(`queue ${id}`);
    return undefined;
  });
  let done = false;
  const refresh = refreshes.refresh('t1');
  void refresh.then(() => {
    done = true;
  });
  expect(refreshes.refresh('t1')).toBe(refresh);
  await Promise.resolve();
  expect(asked).toEqual(['pull t1', 'queue t1']);
  expect(done).toBe(false);
  pull.resolve(undefined);
  await refresh;
  expect(done).toBe(true);
  // Once it's in, the next is a refresh of its own.
  void refreshes.refresh('t1');
  expect(asked).toHaveLength(4);
});

test('a part that fails is logged, and the refresh settles all the same', async () => {
  const logged: string[] = [];
  const refreshes = new Refreshes((line) => logged.push(line));
  refreshes.listen(() => Promise.reject(new Error('GitHub can’t be reached')));
  refreshes.listen(() => {
    throw new Error('not a tab');
  });
  await refreshes.refresh('t1');
  expect(logged.toSorted()).toEqual([
    'refreshing t1: GitHub can’t be reached',
    'refreshing t1: not a tab',
  ]);
});

test('a part that stops listening is no longer asked', async () => {
  const refreshes = new Refreshes(() => {});
  const asked: string[] = [];
  const stop = refreshes.listen((id) => {
    asked.push(id);
    return undefined;
  });
  await refreshes.refresh('t1');
  stop();
  await refreshes.refresh('t2');
  expect(asked).toEqual(['t1']);
});
