// The auto-merge watch, with a stand-in poller and the real database: auto-merge approve and ship
// turned on after your approval is kept through a restart; a push that would merge with your
// approval turns it off, once, and says so; it watches only the auto-merge this account turned on,
// with its method, and stops once there's nothing more to watch.

import {
  MERGE_FACTS,
  PullRef,
  type Cached,
  type MergeFacts,
  type PollEvent,
  type ReadKind,
  type SinceMark,
} from '@lo/github';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { openDatabase, type Database } from '../../../main/database.ts';
import { migrate } from '../../../main/migrations.ts';
import type { Confirmed, Watched } from '../contract.ts';
import type { AutoAnswer } from './merging.ts';
import { factsOf, HEAD } from './test/facts.ts';
import { ShippedStore, ShipWatch, type WatchPoller } from './watch.ts';

const NEWER = 'c'.repeat(40);
const PULL = new PullRef('rozed-dev', 'e2e', 138);

// The feature's migrations, named by their paths in the app, as main finds them.
const migrations = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('../migrations/*.sql', {
      eager: true,
      query: '?raw',
      import: 'default',
    }),
  ).map(([path, sql]) => [path.replace(/^\.\.\//, '/src/features/merge/'), sql]),
);

function database(): Database {
  const opened = openDatabase(':memory:');
  migrate(opened, migrations);
  return opened;
}

/** #138, mira-chen's, with auto-merge on as rozed-bot turned it on, at `head`. */
function on(
  head = HEAD,
  more: Partial<MergeFacts['pullRequest']> = {},
  rest: Partial<MergeFacts> = {},
): MergeFacts {
  return factsOf(
    {
      author: 'mira-chen',
      viewerDidAuthor: false,
      mergeState: 'BLOCKED',
      head,
      autoMerge: { method: 'SQUASH', enabledBy: 'rozed-bot' },
      reviews: [
        {
          author: 'rozed-bot',
          state: 'APPROVED',
          commit: HEAD,
          authorCanPush: true,
          onBehalfOf: [],
        },
      ],
      ...more,
    },
    rest,
  );
}

const watches: ShipWatch[] = [];

afterEach(() => {
  for (const each of watches.splice(0)) each.stop();
});

function setup(opened: Database = database(), facts: MergeFacts = on()) {
  let cached: Cached<MergeFacts> = { value: facts, fetchedAt: 1 };
  let fetched = 1;
  const listeners = new Set<(event: PollEvent) => void>();
  let reads = 0;
  let again = 0;
  const emit = () => {
    for (const listener of listeners)
      listener({ kind: 'read', pull: PULL, name: MERGE_FACTS.name });
  };
  const poller = {
    login: 'rozed-bot',
    presence: 'front' as const,
    mergeFacts: () => Promise.resolve(cached),
    readAfresh() {
      reads += 1;
      queueMicrotask(emit);
      return { read: 1, generation: reads };
    },
    readSince<T>(_pull: PullRef, _kind: ReadKind<T>): SinceMark<Cached<T>> {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what MERGE_FACTS reads.
      return { kind: 'read', read: cached as Cached<T> };
    },
    readMergeFactsAgain: () => {
      again += 1;
    },
    onEvent(listener: (event: PollEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const turnedOff: string[] = [];
  let heard: ((answer: AutoAnswer) => void) | undefined;
  let answer: Exclude<Confirmed, { kind: 'again' }> = { kind: 'sent' };
  const said: Watched[] = [];
  const store = new ShippedStore(opened);
  const watch = new ShipWatch({
    store,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are used.
    poller: () => Promise.resolve(poller as unknown as WatchPoller),
    turnOff(pull, login, _poller, hears) {
      turnedOff.push(`${login} ${pull.toString()}`);
      heard = hears;
      return answer;
    },
    publish: (each) => said.push(each),
    log: () => undefined,
    newKey: () => 'key',
    every: { front: 1e9, back: 1e9 },
  });
  watches.push(watch);
  return {
    watch,
    store,
    turnedOff,
    said,
    reads: () => reads,
    again: () => again,
    /** GitHub says `next`, as a read of the pull request, by the watch or a tab, brings it. */
    github: async (next: MergeFacts) => {
      fetched += 1;
      cached = { value: next, fetchedAt: fetched };
      emit();
      await vi.waitFor(() => undefined);
    },
    /** GitHub answers turning auto-merge off. */
    answer: (each: AutoAnswer) => heard?.(each),
    refuse: (refused: Exclude<Confirmed, { kind: 'again' }>) => {
      answer = refused;
    },
  };
}

/** Keeps auto-merge about to be turned on by rozed-bot, with `method`, after approving `HEAD`. */
function keep(watch: ShipWatch, method: 'SQUASH' | null = 'SQUASH') {
  return watch.keep({ login: 'rozed-bot', pull: PULL, head: HEAD, base: 'main', method });
}

/** Auto-merge on, as GitHub answers turning it on. */
function onAnswer(method: 'SQUASH' | 'MERGE' = 'SQUASH', enabledBy = 'Rozed-Bot'): AutoAnswer {
  return { number: 138, head: HEAD, autoMerge: { method, enabledBy }, inQueue: false };
}

const OFF: AutoAnswer = { number: 138, head: NEWER, autoMerge: undefined, inQueue: false };

describe('the watch', () => {
  it('reads nothing until GitHub answers, then turns auto-merge off for a push that would merge with your approval, and says so', async () => {
    const { watch, store, turnedOff, said, reads, github, answer } = setup();
    const heard = keep(watch);
    expect(store.list()).toMatchObject([
      { login: 'rozed-bot', head: HEAD, enabledBy: 'rozed-bot' },
    ]);
    await vi.waitFor(() => undefined);
    expect(reads()).toBe(0);
    heard(onAnswer());
    await vi.waitFor(() => expect(reads()).toBe(1));
    expect(store.list()).toMatchObject([{ enabledBy: 'Rozed-Bot', method: 'SQUASH' }]);
    expect(turnedOff).toEqual([]);
    await github(on(NEWER));
    expect(turnedOff).toEqual(['rozed-bot rozed-dev/e2e#138']);
    // Read again before GitHub answers, it isn't sent twice.
    await github(on(NEWER));
    expect(turnedOff).toHaveLength(1);
    answer(OFF);
    expect(said).toEqual([
      expect.objectContaining({ kind: 'turnedOff', approved: HEAD, head: NEWER, number: 138 }),
    ]);
    expect(store.list()).toEqual([]);
  });

  it('a Lo started again watches what it kept, and reads at once', async () => {
    const opened = database();
    const first = setup(opened);
    keep(first.watch)(onAnswer());
    first.watch.stop();
    const again = setup(opened, on(NEWER));
    again.watch.start();
    await vi.waitFor(() => expect(again.turnedOff).toHaveLength(1));
  });

  it('a push your latest review approves isn’t turned off, and is watched from', async () => {
    const { watch, store, turnedOff, github } = setup();
    keep(watch)(onAnswer());
    const yours = {
      author: 'rozed-bot',
      state: 'APPROVED',
      commit: NEWER,
      authorCanPush: true,
      onBehalfOf: [],
    };
    await github(on(NEWER, { reviews: [yours] }));
    expect(turnedOff).toEqual([]);
    expect(store.list()).toMatchObject([{ head: NEWER }]);
  });

  it('watches only the auto-merge this account turned on, with its method', async () => {
    const other = setup();
    keep(other.watch)(onAnswer());
    await other.github(on(NEWER, { autoMerge: { method: 'SQUASH', enabledBy: 'mira-chen' } }));
    expect(other.turnedOff).toEqual([]);
    expect(other.store.list()).toEqual([]);
    const method = setup();
    keep(method.watch)(onAnswer());
    await method.github(on(NEWER, { autoMerge: { method: 'MERGE', enabledBy: 'rozed-bot' } }));
    expect(method.turnedOff).toEqual([]);
    expect(method.store.list()).toEqual([]);
  });

  it('keeps the method GitHub reports turning it on, and only when this account turned it on', () => {
    const method = setup();
    keep(method.watch)(onAnswer('MERGE'));
    expect(method.store.list()).toMatchObject([{ method: 'MERGE', enabledBy: 'Rozed-Bot' }]);
    const other = setup();
    keep(other.watch)(onAnswer('SQUASH', 'mira-chen'));
    expect(other.store.list()).toEqual([]);
  });

  it('on a branch with a merge queue, GitHub’s method isn’t compared: it reports a merge commit', async () => {
    const { watch, turnedOff, store, github } = setup();
    keep(watch, null)(onAnswer('MERGE'));
    expect(store.list()).toMatchObject([{ method: null }]);
    await github(on(NEWER, { autoMerge: { method: 'MERGE', enabledBy: 'rozed-bot' } }));
    expect(turnedOff).toHaveLength(1);
  });

  it('ends when GitHub refused to turn it on, or it merged', async () => {
    const refused = setup();
    keep(refused.watch)({ refused: undefined });
    expect(refused.store.list()).toEqual([]);
    const merged = setup();
    keep(merged.watch)(onAnswer());
    await merged.github(on(NEWER, { state: 'MERGED' }));
    expect(merged.turnedOff).toEqual([]);
    expect(merged.store.list()).toEqual([]);
  });

  it('says once when it can’t tell whether a push would merge, and reads again', async () => {
    const { watch, said, again, turnedOff, github } = setup();
    keep(watch)(onAnswer());
    await github(on(NEWER, {}, { leftOut: ['reviews'] }));
    await github(on(NEWER, {}, { leftOut: ['reviews'] }));
    expect(said).toEqual([expect.objectContaining({ kind: 'cantTell', head: NEWER })]);
    expect(again()).toBeGreaterThanOrEqual(2);
    expect(turnedOff).toEqual([]);
  });

  it('says once when it couldn’t turn auto-merge off, and tries again on the next read', async () => {
    const { watch, said, turnedOff, github, refuse, store } = setup();
    keep(watch)(onAnswer());
    refuse({
      kind: 'refused',
      refusal: { kind: 'noPermission', text: 'Not allowed.', rules: [], until: null, newer: null },
    });
    await github(on(NEWER));
    await github(on(NEWER));
    expect(turnedOff).toHaveLength(2);
    expect(said).toEqual([
      expect.objectContaining({ kind: 'notTurnedOff', why: 'Not allowed.', head: NEWER }),
    ]);
    expect(store.list()).toHaveLength(1);
  });
});

it('`merge_shipped` keeps one row an account and pull request, in any case, and only GitHub’s methods', () => {
  const opened = database();
  const store = new ShippedStore(opened);
  const row = {
    login: 'rozed-bot',
    pull: PULL,
    head: HEAD,
    base: 'main',
    method: 'SQUASH' as const,
    enabledBy: 'rozed-bot',
    at: 1.4,
  };
  store.put(row);
  store.put({ ...row, login: 'Rozed-Bot', head: NEWER, method: null, at: 2 });
  expect(store.list()).toEqual([{ ...row, head: NEWER, method: null, at: 2 }]);
  store.remove('ROZED-BOT', PULL);
  expect(store.list()).toEqual([]);
  expect(() =>
    opened
      .prepare("INSERT INTO merge_shipped VALUES ('a', 'o', 'r', 1, 'h', 'a', 'FAST', 'main', 1)")
      .run(),
  ).toThrow('CHECK constraint failed');
});
