// Whether a pull request's head holds its base's tip, from a real local copy, fetching from a
// remote standing in for GitHub: the copy fetches a tip it lacks, says nothing for a head it lacks,
// and the merge status says the head is out of date where the rules want it up to date.

import { parseOid } from '@lo/git';
import { noBranchRules } from '@lo/github';
import { RepoServer } from '@lo/testing/git';
import { afterAll, beforeAll, expect, it } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import { holdsIn } from './holds.ts';
import { MergeReads, type MergePoller } from './reads.ts';
import { testClone } from './test/clone.ts';
import { factsOf } from './test/facts.ts';

let server: RepoServer;
/** The base's tip the head was cut from, the head, and the base's tip once it moved on. */
let cut: string;
let head: string;
let moved: string;

beforeAll(() => {
  server = new RepoServer();
  const remote = server.repo('o', 'r');
  remote.write('README.md', 'Read me.\n');
  cut = remote.commit('The base.');
  remote.publish('refs/heads/trunk');
  remote.switch('topic').write('src/a.ts', 'export const a = 1;\n');
  head = remote.commit('Adds a.');
  remote.publish('refs/pull/1/head');
  remote.switch('trunk').write('README.md', 'Read me, now.\n');
  moved = remote.commit('The base moves on.');
  remote.publish('refs/heads/trunk');
}, 60_000);

afterAll(() => server.remove());

it('fetches a base tip the copy lacks, and says nothing of a head it lacks', async () => {
  const repo = await testClone(server.baseUrl, 'o', 'r');
  expect(await holdsIn(repo, moved, head)).toBeUndefined();
  await repo.fetchCommit(parseOid(head));
  expect(await holdsIn(repo, cut, head)).toBe(true);
  expect(await repo.hasCommit(parseOid(moved))).toBe(false);
  expect(await holdsIn(repo, moved, head)).toBe(false);
  expect(await repo.hasCommit(parseOid(moved))).toBe(true);
});

it('a head behind a base whose rules want it up to date is out of date, from the copy', async () => {
  const repo = await testClone(server.baseUrl, 'o', 'r');
  await repo.fetchCommit(parseOid(head));
  const statuses = new Map<string, string[]>();
  for (const tip of [cut, moved]) {
    const facts = factsOf(
      { mergeState: 'BLOCKED', head, baseTip: tip },
      {
        rules: {
          ...noBranchRules('trunk'),
          rules: [
            {
              kind: 'requiredStatusChecks',
              rule: { strict: true, checks: [{ name: 'ci', app: undefined }] },
            },
          ],
        },
      },
    );
    const poller: MergePoller = {
      mergeFacts: () => Promise.resolve({ value: facts, fetchedAt: 1 }),
      cachedRead: () => undefined,
      onEvent: () => () => undefined,
      onChange: () => () => undefined,
      status: () => ({ rateLimit: { kind: 'normal' }, offline: undefined, signedOut: false }),
      readOnce: () => Promise.reject(new Error('not here')),
    };
    const info = {
      id: 't1',
      repository: { owner: 'o', name: 'r' },
      number: 1,
      acting: { kind: 'account', login: 'rozed-bot' },
      head: { fork: null },
      shown: head,
      latest: head,
      provisional: false,
      local: { kind: 'ready', head, base: tip, mergeBase: cut, offline: false },
      compareFrom: undefined,
      drawn: false,
      run: undefined,
    } satisfies PullTabInfo;
    const answered = Promise.withResolvers<void>();
    const followed = new MergeReads({
      poller: () => Promise.resolve(poller),
      view: () => info,
      onScreen: () => 't1',
      headOnScreen: () => head,
      method: () => undefined,
      async holds(_, base, ours) {
        const said = await holdsIn(repo, base, ours);
        setTimeout(answered.resolve, 0);
        return said;
      },
      publish({ view }) {
        if (view.kind === 'known')
          statuses.set(
            tip,
            view.state.blockers.map((each) => each.kind),
          );
      },
      log: () => undefined,
    });
    followed.follow('t1');
    await answered.promise;
    followed.stop();
  }
  expect(statuses.get(cut)).not.toContain('outOfDate');
  expect(statuses.get(moved)).toContain('outOfDate');
});
