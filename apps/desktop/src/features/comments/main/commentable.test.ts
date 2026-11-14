import type { Repo } from '@lo/git';
import type { PullFile } from '@lo/github';
import { expect, test, vi } from 'vitest';

import type { PullTabInfo } from '../../tab/service.ts';
import { CommentableReads, fromListing, type CommentablePoller } from './commentable.ts';

const HEAD = 'a'.repeat(40);
const OLDER = 'b'.repeat(40);
const BASE = 'c'.repeat(40);

const PATCH = '@@ -1,3 +1,4 @@\n one\n-two\n+2\n+2b\n three';

function file(overrides: Partial<PullFile>): PullFile {
  return {
    filename: 'src/a.ts',
    status: 'modified',
    additions: 2,
    deletions: 1,
    changes: 3,
    patch: PATCH,
    ...overrides,
  };
}

test('GitHub’s listing gives a file’s hunks, none for a binary file, and says what isn’t in it', () => {
  expect(fromListing([file({})], true, 'src/a.ts')).toEqual({
    kind: 'diff',
    hunks: [{ old: 0, new: 0, kinds: ' -++ ' }],
  });
  expect(fromListing([file({ patch: undefined, changes: 0 })], true, 'src/a.ts')).toEqual({
    kind: 'diff',
    hunks: [],
  });
  expect(fromListing([file({})], true, 'src/b.ts')).toEqual({ kind: 'notInDiff' });
  // A patch GitHub left out of a file with changes, or a listing cut short, says nothing.
  expect(fromListing([file({ patch: undefined })], true, 'src/a.ts')).toBeUndefined();
  expect(fromListing([file({})], false, 'src/b.ts')).toBeUndefined();
});

function info(overrides: Partial<PullTabInfo> = {}): PullTabInfo {
  return {
    id: 't1',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    number: 94,
    acting: { kind: 'account', login: 'rozed-bot' },
    head: { fork: null },
    shown: HEAD,
    latest: HEAD,
    provisional: false,
    local: { kind: 'ready', head: HEAD, base: BASE, mergeBase: BASE, offline: false },
    compareFrom: undefined,
    drawn: true,
    run: undefined,
    ...overrides,
  };
}

function reads(view: PullTabInfo, comparing?: { head: string; base: string }) {
  const listed = vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve({ files: [file({ patch: undefined })], head: HEAD, cutShort: undefined }),
  );
  const patch = vi.fn<() => Promise<unknown>>(() =>
    Promise.resolve({ binary: false as const, hunks: Buffer.from(`${PATCH}\n`) }),
  );
  const made = new CommentableReads({
    view: () => view,
    poller: () =>
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only these are read.
      Promise.resolve({
        pullRequest: () => ({ details: { headRefOid: HEAD } }),
        readOnce: listed,
      } as unknown as CommentablePoller),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- only `patch` is read.
    clone: () => Promise.resolve({ patch } as unknown as Repo),
    comparing: () => comparing,
    log: () => {},
  });
  return { made, listed, patch };
}

test('where GitHub gave no patch, the local copy’s comes from where the revision branched off', async () => {
  const { made, listed, patch } = reads(info());
  const said = await made.read('t1', HEAD, 'src/a.ts', null);
  expect(said).toEqual({ kind: 'diff', hunks: [{ old: 0, new: 0, kinds: ' -++ ' }] });
  await made.read('t1', HEAD, 'src/a.ts', null);
  // GitHub's listing is read once for the view and head.
  expect(listed).toHaveBeenCalledOnce();
  expect(patch).toHaveBeenCalledWith(BASE, HEAD, expect.anything(), undefined);

  // An older revision compared in the newer column diffs from where it branched off.
  const compared = reads(info(), { head: OLDER, base: '9'.repeat(40) });
  await compared.made.read('t1', OLDER, 'src/a.ts', 'src/old.ts');
  expect(compared.listed).not.toHaveBeenCalled();
  expect(compared.patch).toHaveBeenCalledWith(
    '9'.repeat(40),
    OLDER,
    expect.anything(),
    expect.anything(),
  );

  // Without a local copy, or a revision Lo knows the start of, it can't tell.
  const waiting = reads(info({ local: { kind: 'waiting' } }));
  expect(await waiting.made.read('t1', HEAD, 'src/a.ts', null)).toEqual({ kind: 'unknown' });
  expect(await reads(info()).made.read('t1', OLDER, 'src/a.ts', null)).toEqual({ kind: 'unknown' });
});
