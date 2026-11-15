import { expect, test } from 'vitest';

import { groupOfStat, memoryOfPs, residentOfStatus } from './memory.ts';

test('a group’s memory is the sum of its processes’', () => {
  const ps = '    1  37408\n  208 1000\n  208   24\n  300 99999\n  208 abc\n';
  expect(memoryOfPs(ps, new Set([208, 404]))).toEqual(new Map([[208, 1024 * 1024]]));
  // A process's name may hold spaces and parentheses.
  expect(groupOfStat('4242 (a) b (c) S 1 4200 4200 0 -1 4194560 120 0 0 0')).toBe(4200);
  expect(residentOfStatus('Name:\tnode\nVmRSS:\t   2048 kB\nThreads:\t7\n')).toBe(2048 * 1024);
  expect(residentOfStatus('Name:\tzombie\nState:\tZ (zombie)\n')).toBeUndefined();
});
