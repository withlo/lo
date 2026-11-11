import { expect, test } from 'vitest';

import type { PushedAt } from '../revisions.ts';
import {
  baseTipAt,
  EVENT_LAG,
  type BaseHistory,
  type BaseRecord,
  type BaseTipSource,
  type Merge,
  type Retarget,
} from './base.ts';

const NO_COMMIT = '0000000000000000000000000000000000000000';

/** `minute` minutes into a day in 2026, in milliseconds since the Unix epoch. */
function at(minute: number): number {
  return (1_790_000_000 + minute * 60) * 1000;
}

/** `minute` minutes and `second` seconds into the day. */
function atSecond(minute: number, second: number): number {
  return at(minute) + second * 1000;
}

function pushed(minute: number): PushedAt {
  return { kind: 'exact', at: at(minute) };
}

function push(branch: string, before: string, after: string, minute: number): BaseRecord {
  return { kind: 'activity', branch, before, after, at: at(minute), forced: false };
}

function force(branch: string, before: string, after: string, minute: number): BaseRecord {
  return { kind: 'activity', branch, before, after, at: at(minute), forced: true };
}

function forceEvent(after: string, minute: number): BaseRecord {
  return { kind: 'forcePush', after, at: at(minute) };
}

function seen(branch: string, tip: string, minute: number): BaseRecord {
  return { kind: 'seen', branch, tip, at: at(minute) };
}

function retarget(from: string, to: string, minute: number): Retarget {
  return { from, to, at: at(minute) };
}

/** A pull request into `main`, whose tip is `m9` now. */
function intoMain(records: BaseRecord[], more: Partial<BaseHistory> = {}): BaseHistory {
  return { branch: 'main', tip: 'm9', records, ...more };
}

/** The tip for a revision whose head no tip holds. */
function found(history: BaseHistory, pushedAt: PushedAt): [string, BaseTipSource] | undefined {
  const then = baseTipAt(history, pushedAt, 'h1', () => false);
  return then && [then.commit, then.source];
}

function expected(commit: string, source: BaseTipSource): [string, BaseTipSource] {
  return [commit, source];
}

function merged(commit: string, parents: string[], head: string): Merge {
  return { commit, parents, head };
}

test('a base that only moved forward is its tip now', () => {
  const history = intoMain([]);

  expect(found(history, pushed(10))).toEqual(expected('m9', 'now'));
  expect(found(history, { kind: 'by', at: at(10) })).toEqual(expected('m9', 'now'));
  expect(found(history, { kind: 'unknown' })).toEqual(expected('m9', 'now'));
});

test('the activity api gives the tip at the push', () => {
  const history = intoMain([
    push('main', 'm1', 'm2', 5),
    push('main', 'm2', 'm3', 15),
    push('main', 'm3', 'm9', 25),
  ]);

  expect(found(history, pushed(20))).toEqual(expected('m3', 'activity'));
  // A push at the same second as the base's counts it.
  expect(found(history, pushed(15))).toEqual(expected('m3', 'activity'));
  // Before the earliest entry read, today's tip will do.
  expect(found(history, pushed(1))).toEqual(expected('m9', 'now'));
});

test('a pull request merged with a merge commit takes its first parent', () => {
  const history = intoMain([push('main', 'm1', 'm2', 5)], {
    merge: merged('mc', ['m8', 'h3'], 'h3'),
  });

  expect(found(history, pushed(10))).toEqual(expected('m8', 'mergeParent'));
});

test('a squash or rebase merge takes the tip before the merge or today s', () => {
  // Squashed, or rebased, into new commits: the activity API's merge says where main was.
  for (const merge of [merged('sq', ['m8'], 'h3'), merged('rb3', ['rb2'], 'h3')]) {
    const history = intoMain([push('main', 'm1', 'm2', 5), push('main', 'm8', merge.commit, 50)], {
      merge,
    });
    expect(found(history, pushed(10))).toEqual(expected('m8', 'beforeMerge'));

    // Without it, main doesn't hold the pull request's commits, so today's tip does.
    expect(found(intoMain([], { merge }), pushed(10))).toEqual(expected('m9', 'now'));
  }
});

test('a fast forward takes the tip before it and without it is uncertain', () => {
  // The head itself was pushed to main, so main holds every revision.
  const merge = merged('h3', ['h2'], 'h3');
  const history = intoMain(
    [push('main', 'm1', 'm2', 5), push('main', 'm2', 'm8', 30), push('main', 'm8', 'h3', 50)],
    { merge },
  );
  expect(found(history, pushed(10))).toEqual(expected('m8', 'beforeMerge'));

  // Past the pushes read, today's tip would make every revision's diff empty.
  expect(found(intoMain([], { merge }), pushed(10))).toEqual(expected('m9', 'uncertain'));
});

test('a fast forwarded head that is a merge commit is no merge parent', () => {
  // The author merged main into the branch, and the head was then pushed to main: the head's first
  // parent is the pull request's own commit.
  const merge = merged('h3', ['h2', 'm7'], 'h3');

  expect(found(intoMain([push('main', 'm8', 'h3', 50)], { merge }), pushed(10))).toEqual(
    expected('m8', 'beforeMerge'),
  );
  expect(found(intoMain([], { merge }), pushed(10))).toEqual(expected('m9', 'uncertain'));
});

test('a merge parent is no good once the base was force pushed', () => {
  const history = intoMain([push('main', 'm1', 'm2', 5), force('main', 'm2', 'n1', 30)], {
    merge: merged('mc', ['m8', 'h3'], 'h3'),
  });

  expect(found(history, pushed(10))).toEqual(expected('m2', 'activity'));
  // After the force-push, the base only moved forward again.
  expect(found(history, pushed(40))).toEqual(expected('m8', 'mergeParent'));
});

test('a stack whose lower layer was force pushed takes the lower tip then', () => {
  // The pull request targets `lower`, the branch of the pull request below, whose author amended it
  // at minute 30 and pushed again at 40.
  const history: BaseHistory = {
    branch: 'lower',
    tip: 'l3',
    records: [
      push('lower', NO_COMMIT, 'l1', 5),
      force('lower', 'l1', 'l2', 30),
      push('lower', 'l2', 'l3', 40),
    ],
  };

  expect(found(history, pushed(10))).toEqual(expected('l1', 'activity'));
  expect(found(history, pushed(35))).toEqual(expected('l2', 'activity'));
  expect(found(history, pushed(45))).toEqual(expected('l3', 'activity'));
});

test('without the activity api a force push event dates the lower tip', () => {
  const history: BaseHistory = {
    branch: 'lower',
    tip: 'l3',
    records: [forceEvent('l2', 30), forceEvent('l3', 50)],
  };

  expect(found(history, pushed(35))).toEqual(expected('l2', 'forcePush'));
  // Before any record, with a force-push since, nothing says where it was.
  expect(found(history, pushed(10))).toEqual(expected('l3', 'uncertain'));
  // After the last force-push, it only moved forward.
  expect(found(history, pushed(55))).toEqual(expected('l3', 'now'));
});

test('a force push event whose commit github lost names no tip', () => {
  const history: BaseHistory = {
    branch: 'lower',
    tip: 'l3',
    records: [
      forceEvent('l1', 10),
      { kind: 'forcePush', after: undefined, at: at(30) },
      forceEvent('l3', 50),
    ],
  };

  expect(found(history, pushed(35))).toEqual(expected('l3', 'uncertain'));
});

test('a tip lo saw is the last resort before today s', () => {
  const records = [
    seen('lower', 'l1', 12),
    seen('lower', 'l2', 33),
    forceEvent('l3', 50),
    // Another branch's tips say nothing about this one.
    seen('elsewhere', 'e1', 34),
  ];
  const history: BaseHistory = { branch: 'lower', tip: 'l3', records };

  expect(found(history, pushed(36))).toEqual(expected('l2', 'seen'));
  // A force-push event outranks a sighting.
  const withEvent: BaseHistory = { ...history, records: [...records, forceEvent('k1', 20)] };
  expect(found(withEvent, pushed(25))).toEqual(expected('k1', 'forcePush'));
});

test('a retargeted pull request takes the branch it targeted then', () => {
  // Stacked on `lower` until GitHub retargeted it to `main` at minute 30, when `lower` was merged
  // and deleted.
  const history = intoMain(
    [
      push('lower', NO_COMMIT, 'l1', 5),
      push('lower', 'l1', 'l2', 15),
      push('lower', 'l2', NO_COMMIT, 29),
      push('main', 'm1', 'm2', 2),
    ],
    { retargets: [retarget('lower', 'main', 30)] },
  );

  expect(found(history, pushed(20))).toEqual(expected('l2', 'activity'));
  expect(found(history, pushed(31))).toEqual(expected('m2', 'activity'));
});

test('retargets are read in time order', () => {
  const history = intoMain([seen('a', 'a1', 1), seen('b', 'b1', 11), seen('main', 'm1', 21)], {
    tip: undefined,
    retargets: [retarget('b', 'main', 20), retarget('a', 'b', 10)],
  });

  expect(found(history, pushed(5))).toEqual(expected('a1', 'seen'));
  expect(found(history, pushed(15))).toEqual(expected('b1', 'seen'));
  expect(found(history, pushed(25))).toEqual(expected('m1', 'seen'));
});

test('an old base that only moved forward is its latest tip read', () => {
  // Retargeted from a busy `develop` at minute 100; its pushes were read back to minute 50 only.
  const records = [push('develop', 'd1', 'd2', 50), push('develop', 'd2', 'd3', 90)];
  const retargets = [retarget('develop', 'main', 100)];
  const history = intoMain(records, { retargets });

  expect(found(history, pushed(20))).toEqual(expected('d3', 'now'));
  expect(found(history, pushed(60))).toEqual(expected('d2', 'activity'));
  // Force-pushed since, it's uncertain, with its own latest tip.
  const forced = intoMain([...records, force('develop', 'd3', 'e1', 95)], { retargets });
  expect(found(forced, pushed(20))).toEqual(expected('e1', 'uncertain'));
});

/** Whether `tip` holds `head`: only `d9` holds `h1`. */
function holdsH1(tip: string, head: string): boolean {
  return tip === 'd9' && head === 'h1';
}

test('an old base that took in the pull request later is uncertain', () => {
  // Opened against `develop`, retargeted to `main` at minute 100 and merged there; `main` was then
  // merged back into `develop`, whose tip now holds the pull request's head h1.
  const history = intoMain([push('develop', 'd1', 'd9', 150)], {
    retargets: [retarget('develop', 'main', 100)],
  });

  expect(baseTipAt(history, pushed(20), 'h1', holdsH1)).toEqual({
    commit: 'd9',
    source: 'uncertain',
  });
  // A tip that doesn't hold the head stands.
  expect(baseTipAt(history, pushed(20), 'h0', holdsH1)).toEqual({ commit: 'd9', source: 'now' });
});

test('a force push event counts from a few seconds before it', () => {
  // The layer below was force-pushed to l2 at about 10:00:00; GitHub made its event at 10:00:05,
  // and this layer was pushed onto it at 10:00:02. A later push moved the base on.
  const history: BaseHistory = {
    branch: 'lower',
    tip: 'l3',
    records: [
      { kind: 'forcePush', after: 'l2', at: atSecond(10, 5) },
      { kind: 'forcePush', after: 'l3', at: atSecond(20, 0) },
    ],
  };
  const foundAt = (second: number) => found(history, { kind: 'exact', at: atSecond(10, second) });

  expect(foundAt(2)).toEqual(expected('l2', 'forcePush'));
  // Exactly the lag before the event counts; a second earlier doesn't.
  expect(foundAt(0)).toEqual(expected('l2', 'forcePush'));
  expect(found(history, { kind: 'exact', at: at(10) - 1000 })).toEqual(expected('l3', 'uncertain'));
  expect(EVENT_LAG).toBe(5000);
});

test('a retargeted pull request with no record of its old base is uncertain', () => {
  const history = intoMain([], { retargets: [retarget('lower', 'main', 30)] });

  expect(found(history, pushed(20))).toEqual(expected('m9', 'uncertain'));
  expect(found(history, pushed(40))).toEqual(expected('m9', 'now'));
});

test('a force push event belongs to the branch targeted then', () => {
  // `lower`'s force-push at minute 10 happened while the pull request targeted it, so it says
  // nothing about `main`.
  const history = intoMain([forceEvent('l2', 10)], {
    retargets: [retarget('lower', 'main', 30)],
  });

  expect(found(history, pushed(20))).toEqual(expected('l2', 'forcePush'));
  expect(found(history, pushed(5))).toEqual(expected('m9', 'uncertain'));
  expect(found(history, pushed(40))).toEqual(expected('m9', 'now'));
});

test('a base deleted or recreated since isnt moving forward', () => {
  const deleted = intoMain([push('main', 'm1', NO_COMMIT, 30)]);
  expect(found(deleted, pushed(10))).toEqual(expected('m9', 'uncertain'));

  const recreated = intoMain([push('main', NO_COMMIT, 'm9', 30)]);
  expect(found(recreated, pushed(10))).toEqual(expected('m9', 'uncertain'));
});

test('records at the same second go by their order', () => {
  const history = intoMain([push('main', 'm1', 'm2', 5), push('main', 'm2', 'm3', 5)]);

  expect(found(history, pushed(5))).toEqual(expected('m3', 'activity'));
});

test('with nothing known there is no tip', () => {
  const history: BaseHistory = { branch: 'main' };

  expect(found(history, pushed(10))).toBeUndefined();
  expect(found({ ...history, tip: NO_COMMIT }, pushed(10))).toBeUndefined();
});
