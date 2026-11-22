// What Settings' Toolchains section shows: sizes in the units the rest of Settings and the status bar
// count in, the one being removed waiting, where one of the system's is from, and why one wasn't
// removed.

import { expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notRemoved, rowsOf } from './rows.ts';

const GO = {
  id: 'go',
  name: 'Go',
  version: '1.27.4',
  installed: 240_208_599,
  download: 68_260_000,
  uses: ['Go'],
};

it('writes sizes as formatBytes does, and has the one being removed wait', () => {
  const rows = rowsOf([GO, { ...GO, id: 'rust', name: 'Rust', installed: null }], new Set(['go']));
  expect(rows).toEqual([
    { ...GO, installed: '229.1 MB', download: '65.1 MB', removing: true },
    { ...GO, id: 'rust', name: 'Rust', installed: undefined, download: '65.1 MB', removing: false },
  ]);
});

it('says where one of the system’s is from, or what it needs while there’s none', () => {
  const swift = {
    id: 'swift',
    name: 'Swift',
    needs: 'Apple’s Command Line Tools',
    uses: ['Swift'],
  };
  expect(
    rowsOf([
      { ...swift, from: 'Xcode' },
      { ...swift, from: null },
    ]),
  ).toEqual([
    { kind: 'system', ...swift, from: 'Xcode' },
    { kind: 'system', ...swift, from: undefined },
  ]);
});

it('says why one wasn’t deleted as main said it, and nothing when that isn’t known', () => {
  expect(notRemoved(new IpcError('failed', 'Lo isn’t allowed to delete /lo/toolchains/go.'))).toBe(
    'Lo isn’t allowed to delete /lo/toolchains/go.',
  );
  expect(notRemoved(new Error('the port closed'))).toBe('');
});
