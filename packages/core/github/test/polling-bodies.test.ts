// The poller's reads of posts' HTML on a fake clock, replaying `poll_playground` and what rozed-bot
// read of rozed-dev/e2e#23 (`rendered_bodies_e2e_23`).

import { cassette, type Interaction } from '@lo/testing';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

import { POSTS_23 } from './scenarios/posts.ts';
import { outcome, pr, Polling, recorded, useFakeClock } from './support/polling.ts';
import { PullRef } from '../src/refs.ts';

beforeEach(useFakeClock);

afterEach(() => {
  vi.useRealTimers();
});

const E2E_23 = new PullRef('rozed-dev', 'e2e', 23);
const IDS = [POSTS_23.comment, POSTS_23.reply, POSTS_23.review, POSTS_23.deleted];

/** rozed-dev/e2e#23's posts, one gone. */
function bodies(): Interaction[] {
  const { interactions } = cassette('rendered_bodies_e2e_23');
  return interactions.slice(0, 1).map(({ interaction }) => interaction);
}

test('posts html is read ahead of waiting polls, and read again each time', async () => {
  const t = await Polling.start('bodies', [...recorded(), ...bodies()], { delay: 1000 });
  void t.poller.setOpen(pr(1));
  await t.run();
  const first = await t.finish(t.poller.renderedBodies(E2E_23, IDS));
  expect([...first.bodies.keys()]).toEqual(IDS.slice(0, 3));
  expect(first.gone).toEqual([POSTS_23.deleted]);
  const again = await t.finish(t.poller.renderedBodies(E2E_23, IDS));
  expect(again.bodies).toEqual(first.bodies);

  const requests = t.requests().map(([, what]) => what);
  // In the queue after the open pull request's poll, as a read someone waits on: before the
  // repository's poll that was waiting. Nothing is kept, so the second read is sent too.
  expect(requests.indexOf('RenderedBodies')).toBeLessThan(
    requests.indexOf('GET /pulls?state=open&per_page=100'),
  );
  expect(requests.filter((what) => what === 'RenderedBodies')).toHaveLength(2);
});

test('a read of posts given up while it waits for its turn is never sent', async () => {
  const t = await Polling.start('bodies_given_up', [...recorded(), ...bodies()], { delay: 1000 });
  void t.poller.setOpen(pr(1));
  await t.runUntil(1);
  const giving = new AbortController();
  const read = outcome(t.poller.renderedBodies(E2E_23, IDS, { signal: giving.signal }));
  // It waits behind the open pull request's poll (0–3 s).
  await t.runUntil(2);
  const reason = new Error('closed');
  giving.abort(reason);
  expect(await t.finish(read)).toEqual({ ok: false, error: reason });
  await t.runUntil(30);
  expect(t.requests().map(([, what]) => what)).not.toContain('RenderedBodies');
});
