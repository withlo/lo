import { expect, it } from 'vitest';

import { startupWords } from './startup.ts';

it('words the startup box from the failure: the fact, then the detail as its last paragraph', () => {
  expect(startupWords({ kind: 'noSqlite' })).toEqual({
    body: 'This copy of Lo is incomplete. Download it again.',
    detail: 'node:sqlite',
  });
  expect(startupWords({ kind: 'newerDatabase', feature: 'tab', number: 7 })).toEqual({
    body: 'Lo’s saved data is from a newer version. Update Lo to open it.',
    detail: 'tab 007',
  });
  expect(
    startupWords({ kind: 'cacheFolder', why: 'writable', path: '/private/var/folders/x/y/C' }),
  ).toEqual({
    body: 'The cache folder can’t be used. Other users can change it.',
    detail: '/private/var/folders/x/y/C',
  });
});
