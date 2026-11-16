// Each view's merge status, from what its account's poller reads: read once the view is on screen,
// followed as the poller reads it again, mapped with the head on screen and what the local copy
// says, and none for a view that reads nothing.

import {
  type Cached,
  MERGE_FACTS,
  type MergeFacts,
  type PollEvent,
  type PollStatus,
  PullRef,
  noBranchRules,
} from '@lo/github';
import { expect, test } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import type { MergeStatusView } from '../contract.ts';
import { MergeReads, NO_STATUS, type MergePoller } from './reads.ts';
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
    local: { kind: 'ready', head: HEAD, offline: false, from: null },
    compareFrom: undefined,
    drawn: false,
    run: undefined,
    ...overrides,
  } as PullTabInfo;
}

/** A poller holding `facts`, with events the test sends, and what it was asked. */
function fakePoller(facts: MergeFacts | Error) {
  const listeners = new Set<(event: PollEvent) => void>();
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
    cachedRead<T>() {
      return (held.facts instanceof Error ? undefined : held.facts) as Cached<T> | undefined;
    },
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onChange: () => () => undefined,
    status: () => status,
    readOnce: (request) => Promise.reject(new Error(`not here: ${String(request)}`)),
  } as MergePoller;
  return {
    poller,
    asked,
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
          error: { kind: 'api', status: 404, message: 'Not Found' },
        } as PollEvent);
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
    view?: PullTabInfo | undefined;
    onScreen?: string | undefined;
    holds?: (tip: string, head: string) => boolean | undefined;
  } = {},
) {
  const fake = options.poller ?? fakePoller(factsOf());
  const sent: MergeStatusView[] = [];
  const asked: string[] = [];
  let view = 'view' in options ? options.view : info();
  const followed = new MergeReads({
    poller: () => Promise.resolve(fake.poller),
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
  });
  return {
    followed,
    fake,
    sent,
    asked,
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
  expect(failing.followed.current('t1')).toEqual({ kind: 'failed', why: 'GitHub answered 502' });

  const kept = reads();
  kept.followed.follow('t1');
  await settled();
  kept.fake.fail();
  expect(kept.followed.current('t1').kind).toBe('known');
});

test('where the rules want the head up to date, the local copy says whether it is', async () => {
  const strict = factsOf(
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
    view: info({ local: { kind: 'fetching', progress: null } } as Partial<PullTabInfo>),
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
