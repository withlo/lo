import { expect, test } from 'vitest';

import { familyOf, memberOfStat, membersOfPs, residentOfStatus } from './family.ts';

const START = 'Sun Nov 15 12:52:33 2026';

/** `ps` lines for `rows` of pid, parent, group and resident kilobytes, each started at `START`. */
function ps(rows: readonly (readonly [number, number, number, number | string])[]): string {
  return [...rows.map((row) => ` ${row.join('  ')} ${START}`), ''].join('\n');
}

function pids(members: readonly { pid: number }[]): number[] {
  return members.map((member) => member.pid).toSorted((a, b) => a - b);
}

test('a family is its group and every process descended from it, wherever its group', () => {
  const table = membersOfPs(
    ps([
      [1, 0, 1, 9000],
      [200, 1, 200, 1000],
      [201, 200, 200, 24],
      [300, 201, 300, 500],
      [301, 300, 300, 8],
      [400, 1, 400, 7777],
      [401, 400, 400, 'abc'],
    ]),
  );
  // The server, 200, started 201 in its group, which started 300 in a session of its own.
  expect(pids(familyOf(table, 200))).toEqual([200, 201, 300, 301]);
  expect(familyOf(table, 200).reduce((sum, member) => sum + (member.resident ?? 0), 0)).toBe(
    1532 * 1024,
  );
  expect(familyOf(table, 200)[0]?.started).toBe(START);
  expect(familyOf(table, 999)).toEqual([]);
  expect(residentOfStatus('Name:\tnode\nVmRSS:\t   2048 kB\nThreads:\t7\n')).toBe(2048 * 1024);
});

test('a process read before is in the family while it’s the same process, with what it started', () => {
  // 300 left the group, and its parent has gone, so nothing ties it to the server but having been
  // read before.
  const before = { pid: 300, parent: 201, group: 300, started: START };
  const table = membersOfPs(
    ps([
      [200, 1, 200, 1000],
      [300, 1, 300, 500],
      [301, 300, 301, 8],
    ]),
  );
  expect(pids(familyOf(table, 200, [before]))).toEqual([200, 300, 301]);
  // Its ID, started again later, is another process: not the server's.
  expect(pids(familyOf(table, 200, [{ ...before, started: 'Sun Nov 15 12:52:30 2026' }]))).toEqual([
    200,
  ]);
  expect(pids(familyOf(table, 200, [{ ...before, started: undefined }]))).toEqual([200]);
});

/** A stat line's fields after its name, in `state`, started at tick 987654. */
function fields(state: string): string {
  return `${state} 1 4200 4200 0 -1 4194560 120 0 0 0 5 6 0 0 20 0 1 0 987654 1000 200`;
}

test('a process’s stat gives its parent, group and start, whatever its name', () => {
  expect(memberOfStat(`4242 (a) b (c) ${fields('S')}`)).toEqual({
    pid: 4242,
    parent: 1,
    group: 4200,
    started: '987654',
  });
  expect(memberOfStat(`4243 (gone) ${fields('Z')}`)).toBeUndefined();
  expect(memberOfStat('4244 (short) S 1 4200 4200')).toBeUndefined();
});
