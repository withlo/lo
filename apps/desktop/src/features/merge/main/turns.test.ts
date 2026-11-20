// One merge write to a pull request at a time: a turn taken holds every pull request it names until
// it's given back, whatever wrote, and a pull request's key ignores case, as GitHub's names do.

import { RepoRef } from '@lo/github';
import { expect, it } from 'vitest';

import { MergeTurns } from './turns.ts';

it('holds each pull request a turn names until it’s given back, once', () => {
  const turns = new MergeTurns();
  const repo = new RepoRef('rozed-dev', 'e2e');
  const stack = turns.take(repo, [4818, 4819]);
  if ('busy' in stack) throw new Error('taken');
  expect(turns.take(new RepoRef('Rozed-Dev', 'E2E'), [4821, 4819])).toEqual({ busy: 4819 });
  expect(turns.busy(repo, [4818, 4821])).toEqual([4818]);
  // Another repository's pull request of the same number is its own.
  expect('busy' in turns.take(new RepoRef('rozed-dev', 'other'), [4818])).toBe(false);
  stack.give();
  stack.give();
  expect(turns.busy(repo, [4818, 4819])).toEqual([]);
  expect('busy' in turns.take(repo, [4819])).toBe(false);
});

it('says each time a turn is given back, until told to stop', () => {
  const turns = new MergeTurns();
  const repo = new RepoRef('rozed-dev', 'e2e');
  let given = 0;
  const stop = turns.onGiven(() => {
    given += 1;
    // Free by then, for the write that waits for it.
    expect(turns.busy(repo, [4818])).toEqual([]);
  });
  const first = turns.take(repo, [4818]);
  if ('busy' in first) throw new Error('taken');
  first.give();
  first.give();
  expect(given).toBe(1);
  stop();
  const second = turns.take(repo, [4818]);
  if ('busy' in second) throw new Error('taken');
  second.give();
  expect(given).toBe(1);
});
