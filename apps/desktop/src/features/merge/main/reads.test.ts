// Each view's merge status, from what its account's poller reads: read once the view is on screen,
// followed as the poller reads it again, mapped with the head on screen and what the local copy
// says, and none for a view that reads nothing.

import {
  type Cached,
  MERGE_FACTS,
  type MergeFacts,
  type PollEvent,
  type PollStatus,
  type ReadKind,
  PullRef,
  noBranchRules,
} from '@lo/github';
import { expect, test } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeStatusView } from '../contract.ts';
import { backoff, MergeReads, NO_STATUS, type MergePoller } from './reads.ts';
import { BASE_TIP, factsOf, HEAD } from './test/facts.ts';

const PULL = new PullRef('rozed-dev', 'e2e', 138);

/** #138's view `t1`, on screen at `HEAD` as rozed-bot, its local copy ready. */
function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 138,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'ready', head: HEAD, base: BASE_TIP, mergeBase: null, offline: false },
    compareFrom: undefined,
    drawn: false,
    run: undefined,
    ...overrides,
  };
}

/** A poller holding `facts`, with events the test sends, and what it was asked. */
function fakePoller(facts: MergeFacts | Error) {
  const listeners = new Set<(event: PollEvent) => void>();
  const changes = new Set<() => void>();
  const asked: string[] = [];
  const held: { facts: Cached<MergeFacts> | Error } = {
    facts: facts instanceof Error ? facts : { value: facts, fetchedAt: 1 },
  };
  const status: PollStatus = {
    rateLimit: { kind: 'normal' },
    offline: undefined,
    signedOut: false,
  };
  const poller: MergePoller = {
    mergeFacts(pull) {
      asked.push(pull.key);
      return held.facts instanceof Error ? Promise.reject(held.facts) : Promise.resolve(held.facts);
    },
    cachedRead<T>(_: PullRef, kind: ReadKind<T>): Cached<T> | undefined {
      if (held.facts instanceof Error || kind.name !== MERGE_FACTS.name) return undefined;
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return held.facts as Cached<T>;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onChange(listener) {
      changes.add(listener);
      return () => changes.delete(listener);
    },
    status: () => status,
    writesHeldUntil: () => undefined,
    readOnce: (request) => Promise.reject(new Error(`not here: ${String(request)}`)),
  };
  return {
    poller,
    asked,
    /** How many listen to its reads now. */
    listening: () => listeners.size,
    /** GitHub can't be reached, or, with nothing, it can again. */
    offline(error: string | undefined) {
      status.offline =
        error === undefined
          ? undefined
          : { since: 0, retryAt: 0, cause: { kind: 'offline' }, error };
      for (const listener of changes) listener();
    },
    /** GitHub gives `next` on a read again. */
    read(next: MergeFacts, fetchedAt = 2) {
      held.facts = { value: next, fetchedAt };
      for (const listener of listeners) {
        listener({ kind: 'read', pull: PULL, name: MERGE_FACTS.name });
      }
    },
    fail() {
      for (const listener of listeners) {
        listener({
          kind: 'readFailed',
          pull: PULL,
          name: MERGE_FACTS.name,
          error: { kind: 'api', status: 404, message: 'Not Found', errors: [] },
        });
      }
    },
  };
}

/** Lets what's waiting settle. */
async function settled(): Promise<void> {
  for (let round = 0; round < 5; round++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function reads(
  options: {
    poller?: ReturnType<typeof fakePoller>;
    /** Each account's poller, in place of `poller`'s for every account. */
    pollerOf?: (login: string) => Promise<MergePoller>;
    view?: PullTabInfo | undefined;
    onScreen?: string | undefined;
    holds?: (tip: string, head: string) => boolean | undefined;
  } = {},
) {
  const fake = options.poller ?? fakePoller(factsOf());
  const sent: MergeStatusView[] = [];
  const asked: string[] = [];
  const clock = { now: 1_000 };
  let view = 'view' in options ? options.view : info();
  const followed = new MergeReads({
    poller: options.pollerOf ?? (() => Promise.resolve(fake.poller)),
    view: () => view,
    onScreen: () => ('onScreen' in options ? options.onScreen : 't1'),
    headOnScreen: () => view?.shown,
    method: () => undefined,
    holds(_, tip, head) {
      asked.push(`${tip}:${head}`);
      return Promise.resolve(options.holds?.(tip, head));
    },
    publish: (status) => sent.push(status),
    log: () => undefined,
    now: () => clock.now,
  });
  return {
    followed,
    fake,
    sent,
    asked,
    clock,
    setView(next: PullTabInfo | undefined) {
      view = next;
    },
  };
}

test('a view acting as nobody, or a run of layers, reads nothing and says why', () => {
  const anonymous = reads({ view: info({ acting: { kind: 'anonymous' } }) });
  anonymous.followed.follow('t1');
  expect(anonymous.fake.asked).toEqual([]);
  expect(anonymous.followed.current('t1')).toEqual({ kind: 'none', why: NO_STATUS.anonymous });
  const run = reads({ view: info({ run: [137, 138] }) });
  run.followed.follow('t1');
  expect(run.fake.asked).toEqual([]);
  expect(run.sent.at(-1)?.view).toEqual({ kind: 'none', why: NO_STATUS.run });
});

test('a view reads once it’s on screen, and follows the poller’s reads after', async () => {
  const off = reads({ onScreen: 't2' });
  off.followed.follow('t1');
  await settled();
  expect(off.fake.asked).toEqual([]);
  expect(off.followed.current('t1')).toEqual({ kind: 'loading' });

  const on = reads();
  on.followed.follow('t1');
  await settled();
  expect(on.fake.asked).toEqual([PULL.key]);
  const first = on.followed.current('t1');
  expect(first.kind === 'known' && first.state.verdict).toBe('ready');
  on.fake.read(factsOf({ state: 'MERGED' }));
  const after = on.sent.at(-1)?.view;
  expect(after?.kind === 'known' && after.state.verdict).toBe('merged');
  // Following again reads nothing more.
  on.followed.follow('t1');
  await settled();
  expect(on.fake.asked).toEqual([PULL.key]);
});

test('a first read that fails says why, and a later failure keeps what was read', async () => {
  const failing = reads({ poller: fakePoller(new Error('GitHub answered 502')) });
  failing.followed.follow('t1');
  await settled();
  // What it said, with no cause to tell, is behind Details.
  expect(failing.followed.current('t1')).toEqual({
    kind: 'failed',
    why: '',
    details: 'GitHub answered 502',
  });

  const kept = reads();
  kept.followed.follow('t1');
  await settled();
  kept.fake.fail();
  expect(kept.followed.current('t1').kind).toBe('known');
});

/** #138 blocked, into a base whose rules want the head up to date with it. */
function strictFacts(): MergeFacts {
  return factsOf(
    { mergeState: 'BLOCKED' },
    {
      rules: {
        ...noBranchRules('main'),
        rules: [
          {
            kind: 'requiredStatusChecks',
            rule: { strict: true, checks: [{ name: 'ci', app: undefined }] },
          },
        ],
      },
    },
  );
}

/** What blocks view `t1` now, by kind. */
function blockersOf(followed: MergeReads): string[] | undefined {
  const view = followed.current('t1');
  return view.kind === 'known' ? view.state.blockers.map((blocker) => blocker.kind) : undefined;
}

test('where the rules want the head up to date, the local copy says whether it is', async () => {
  const strict = strictFacts();
  const behind = reads({ poller: fakePoller(strict), holds: () => false });
  behind.followed.follow('t1');
  await settled();
  expect(behind.asked).toEqual([`${BASE_TIP}:${HEAD}`]);
  const view = behind.followed.current('t1');
  expect(view.kind === 'known' && view.state.blockers.map((blocker) => blocker.kind)).toContain(
    'outOfDate',
  );
  // Asked once for a tip and head.
  behind.followed.follow('t1');
  await settled();
  expect(behind.asked).toHaveLength(1);

  // Not before the local copy is ready, and then it can't tell, so Lo may not see every rule.
  const early = reads({
    poller: fakePoller(strict),
    view: info({ local: { kind: 'fetching', progress: null, attempt: 1 } }),
  });
  early.followed.follow('t1');
  await settled();
  expect(early.asked).toEqual([]);
  const unsure = early.followed.current('t1');
  expect(unsure.kind === 'known' && unsure.state.partial).toBe(true);

  // Never where the rules don't ask for it.
  const loose = reads();
  loose.followed.follow('t1');
  await settled();
  expect(loose.asked).toEqual([]);
});

test('only the pages a view’s status links open', async () => {
  const blocked = factsOf({
    mergeState: 'BLOCKED',
    checks: [
      {
        kind: 'checkRun',
        name: 'ci',
        status: 'COMPLETED',
        conclusion: 'FAILURE',
        url: 'https://github.com/rozed-dev/e2e/actions/runs/7',
      },
    ],
  });
  const followed = reads({ poller: fakePoller(blocked) });
  followed.followed.follow('t1');
  await settled();
  expect(followed.followed.links('t1', 'https://github.com/rozed-dev/e2e/actions/runs/7')).toBe(
    true,
  );
  expect(followed.followed.links('t1', 'https://github.com/rozed-dev/e2e/pull/138')).toBe(true);
  expect(followed.followed.links('t1', 'https://example.com/')).toBe(false);
  expect(followed.followed.links('t2', 'https://github.com/rozed-dev/e2e/pull/138')).toBe(false);
});

test('a closed view is let go', async () => {
  const closing = reads();
  closing.followed.follow('t1');
  await settled();
  closing.setView(undefined);
  closing.followed.follow('t1');
  expect(closing.followed.current('t1')).toEqual({ kind: 'none', why: NO_STATUS.closed });
});

test('a local copy that can’t tell is asked again at a later read, waiting longer each time', async () => {
  const strict = strictFacts();
  const answers: (boolean | undefined)[] = [undefined, false];
  const later = reads({ poller: fakePoller(strict), holds: () => answers.shift() });
  later.followed.follow('t1');
  await settled();
  expect(later.asked).toHaveLength(1);
  expect(blockersOf(later.followed)).not.toContain('outOfDate');
  // A read before the wait is over asks nothing.
  later.fake.read(strict, 3);
  await settled();
  expect(later.asked).toHaveLength(1);
  later.clock.now += backoff(1);
  later.fake.read(strict, 4);
  await settled();
  expect(later.asked).toHaveLength(2);
  expect(blockersOf(later.followed)).toContain('outOfDate');
  // Once it's said, it's not asked again for that tip and head.
  later.clock.now += backoff(9);
  later.fake.read(strict, 5);
  await settled();
  expect(later.asked).toHaveLength(2);
  expect([1, 2, 3, 10].map(backoff)).toEqual([10_000, 20_000, 40_000, 300_000]);
});

test('a status read before a failed read, or while GitHub can’t be reached, says why it may be old, and merging is off while it can’t', async () => {
  const followed = reads();
  followed.followed.follow('t1');
  await settled();
  const known = () => {
    const view = followed.followed.current('t1');
    if (view.kind !== 'known') throw new Error('not known');
    return view.state;
  };
  expect(known().stale).toBeNull();
  followed.fake.fail();
  expect(known().stale).toBe('GitHub returned an error.');
  followed.fake.read(factsOf(), 3);
  expect(known().stale).toBeNull();
  expect(known().off).toBeNull();
  followed.fake.offline('getaddrinfo ENOTFOUND api.github.com');
  expect(known().stale).toBe('Offline.');
  expect(known().off).toEqual({ kind: 'offline' });
  followed.fake.offline(undefined);
  expect(known().stale).toBeNull();
  expect(known().off).toBeNull();
});

test('a view whose account’s poller couldn’t be had starts again once it’s shown, or later', async () => {
  const fake = fakePoller(factsOf());
  let signedIn = false;
  const logins: string[] = [];
  const starting = reads({
    pollerOf(login) {
      logins.push(login);
      return signedIn
        ? Promise.resolve(fake.poller)
        : Promise.reject(new Error('rozed-bot isn’t signed in.'));
    },
  });
  starting.followed.follow('t1');
  await settled();
  expect(starting.followed.current('t1')).toEqual({
    kind: 'failed',
    why: 'rozed-bot isn’t signed in.',
  });
  // Followed again at once, as a view is as anything about it changes, it waits.
  signedIn = true;
  starting.followed.follow('t1');
  await settled();
  expect(logins).toEqual(['rozed-bot']);
  // Shown again, as after signing in, it starts at once.
  starting.followed.shown('t1');
  await settled();
  expect(logins).toEqual(['rozed-bot', 'rozed-bot']);
  expect(starting.followed.current('t1').kind).toBe('known');

  // Or, followed once the wait is over.
  let asked = 0;
  const again = reads({
    pollerOf() {
      asked += 1;
      return asked === 1 ? Promise.reject(new Error('No poller.')) : Promise.resolve(fake.poller);
    },
  });
  again.followed.follow('t1');
  await settled();
  again.clock.now += backoff(1);
  again.followed.follow('t1');
  await settled();
  expect(asked).toBe(2);
  expect(again.followed.current('t1').kind).toBe('known');
});

test('a view that changes account reads as the new one, and lets the old one’s poller go', async () => {
  const first = fakePoller(factsOf());
  const second = fakePoller(factsOf({ state: 'MERGED' }));
  const switching = reads({
    pollerOf: (login) => Promise.resolve(login === 'rozed-bot' ? first.poller : second.poller),
  });
  switching.followed.follow('t1');
  await settled();
  expect(first.listening()).toBe(1);
  switching.setView(info({ acting: { kind: 'account', login: 'jun-park' } }));
  switching.followed.follow('t1');
  expect(first.listening()).toBe(0);
  expect(switching.followed.current('t1')).toEqual({ kind: 'loading' });
  await settled();
  expect(second.asked).toEqual([PULL.key]);
  const verdict = () => {
    const view = switching.followed.current('t1');
    return view.kind === 'known' ? view.state.verdict : view.kind;
  };
  expect(verdict()).toBe('merged');
  // What the first account's poller reads now changes nothing.
  first.read(factsOf({ state: 'CLOSED' }));
  expect(verdict()).toBe('merged');
});
