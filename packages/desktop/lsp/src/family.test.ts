import { expect, test } from 'vitest';

import { familyOf, memberOfStat, membersOfPs, residentOfStatus } from './family.ts';

test('a family is its group and every process descended from it, wherever its group', () => {
  const table = membersOfPs(
    [
      '  1     0     1  9000',
      ' 200     1   200  1000',
      ' 201   200   200    24',
      ' 300   201   300   500',
      ' 301   300   300     8',
      ' 400     1   400  7777',
      ' 401   400   400  abc',
      '',
    ].join('\n'),
  );
  // The server, 200, started 201 in its group, which started 300 in a session of its own.
  expect(
    familyOf(table, 200)
      .map((member) => member.pid)
      .toSorted((a, b) => a - b),
  ).toEqual([200, 201, 300, 301]);
  expect(familyOf(table, 200).reduce((sum, member) => sum + (member.resident ?? 0), 0)).toBe(
    1532 * 1024,
  );
  expect(familyOf(table, 999)).toEqual([]);
  // A process's name may hold spaces and parentheses; a zombie isn't a member of anything.
  expect(memberOfStat('4242 (a) b (c) S 1 4200 4200 0 -1 4194560 120 0 0 0')).toEqual({
    pid: 4242,
    parent: 1,
    group: 4200,
  });
  expect(memberOfStat('4243 (gone) Z 4242 4200 4200 0 -1')).toBeUndefined();
  expect(residentOfStatus('Name:\tnode\nVmRSS:\t   2048 kB\nThreads:\t7\n')).toBe(2048 * 1024);
});
