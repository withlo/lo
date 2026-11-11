import { expect, test } from 'vitest';

import {
  conflictedPaths,
  parseMergeTree,
  readReplay,
  type Replayed,
  replayPinned,
  setAsideFrom,
} from './compare.ts';
import { GitError } from './errors.ts';
import { type Oid, parseOid } from './oid.ts';

const TREE = 'f74d6ab317132cd8ec8c2165016f89a7d9e03caa';
/** An object that's nowhere. */
const UNKNOWN = parseOid('3333333333333333333333333333333333333333');

function finished(code: number, stdout: Buffer | string, stderr: string) {
  return { code, signal: null, stdout: Buffer.from(stdout), stderr };
}

function failure(run: () => unknown): GitError {
  try {
    run();
  } catch (error) {
    if (error instanceof GitError) return error;
    throw error;
  }
  throw new Error('it didn’t fail');
}

test('output that doesnt parse is reported with gits message', () => {
  // What a git does when it can't read a commit, as when downloading it failed: exit 1, as for a
  // conflict, with nothing on stdout.
  const lost = failure(() =>
    readReplay(
      'git merge-tree',
      finished(
        1,
        '',
        "fatal: unable to access 'https://github.com/a/b.git/': Could not resolve host: " +
          'github.com\nfatal: could not fetch 6178079 from promisor remote\nmerge-tree: ' +
          '6178079 - not something we can merge',
      ),
    ),
  );
  expect(lost.detail).toMatchObject({ kind: 'fetch', failure: 'network' });
  expect(lost.isRetryable()).toBe(true);

  const unmergeable = failure(() =>
    readReplay(
      'git merge-tree',
      finished(1, '', 'merge-tree: 6178079 - not something we can merge'),
    ),
  );
  expect(unmergeable.message).toBe(
    '`git merge-tree` failed: merge-tree: 6178079 - not something we can merge',
  );

  // With nothing on stderr, what it printed.
  const printed = failure(() => readReplay('git merge-tree', finished(0, 'not a tree\0', '')));
  expect(printed.detail.kind === 'git' && printed.detail.message).toContain('not a tree');
});

test('reads whether a replay was clean from its exit status', () => {
  const output = `${TREE}\0`;
  expect(readReplay('git merge-tree', finished(0, output, ''))).toEqual({
    kind: 'clean',
    tree: TREE,
  });
  // A conflict can leave no path conflicted, as over where a renamed folder's files go.
  expect(readReplay('git merge-tree', finished(1, output, ''))).toEqual({
    kind: 'conflicted',
    tree: TREE,
    paths: [],
  });
  const failed = failure(() =>
    readReplay('git merge-tree', finished(128, '', 'fatal: bad object 3333')),
  );
  expect(failed.detail).toEqual({
    kind: 'git',
    command: 'git merge-tree',
    message: 'fatal: bad object 3333',
  });
});

test('reads a clean replays tree', () => {
  expect(parseMergeTree(Buffer.from(`${TREE}\0`))).toEqual({ tree: TREE, paths: [] });
});

test('reads conflicted paths as bytes', () => {
  // git lists each conflicted path once.
  const output = Buffer.concat([
    Buffer.from(`${TREE}\0src/a.txt\0`),
    Buffer.from('caf\xe9\tname\n.txt\0', 'latin1'),
  ]);

  expect(parseMergeTree(output)).toEqual({
    tree: TREE,
    paths: [Buffer.from('src/a.txt'), Buffer.from('caf\xe9\tname\n.txt', 'latin1')],
  });
});

/** The commits merge-tree was given, which name the copies it sets aside. */
const ONTO = '856e106c454a82f1827674a185f94a2456c8883d';
const OLD_HEAD = 'b3ab5414d310233f6e349cbb75e151cb86349f8b';

test('copies git set aside stand for the paths they came from', () => {
  const labels = [ONTO, OLD_HEAD];
  const cases: [string, string | undefined][] = [
    [`l.txt~${ONTO}`, 'l.txt'],
    [`src/a.rs~${OLD_HEAD}`, 'src/a.rs'],
    // With a number when the name was taken.
    [`a~b.txt~${ONTO}_0`, 'a~b.txt'],
    [`dir~${OLD_HEAD}_12`, 'dir'],
    ['a~b.txt', undefined],
    [`l.txt~${TREE}`, undefined],
    [`l.txt~${ONTO}x`, undefined],
    [`l.txt~${ONTO}_`, undefined],
    [`l.txt~${ONTO}_1a`, undefined],
    [`~${ONTO}`, undefined],
  ];
  expect(cases.map(([path]) => setAsideFrom(Buffer.from(path), labels)?.toString('utf8'))).toEqual(
    cases.map(([, from]) => from),
  );

  // Each path once, in order, with copies standing for theirs.
  const listed = ['dir/f', `dir~${ONTO}`, 'l.txt', `l.txt~${OLD_HEAD}`].map((path) =>
    Buffer.from(path),
  );
  expect(conflictedPaths(listed, labels).map((path) => path.toString('utf8'))).toEqual([
    'dir',
    'dir/f',
    'l.txt',
  ]);
});

test('refuses anything else', () => {
  for (const output of [
    '',
    '\0',
    TREE,
    'not a tree\0',
    `${TREE}\0a.txt`,
    `${TREE}\0\0a.txt\0`,
    // What `merge-tree` prints with its messages, which Lo turns off.
    `${TREE}\0a.txt\0\x001\0a.txt\0Auto-merging\0Auto-merging a.txt\n\0`,
  ]) {
    expect.soft(parseMergeTree(Buffer.from(output))).toBeUndefined();
  }
});

/** Pins as a clone does: a tree that's there stays pinned, and one that isn't, isn't. */
function pinning(there: Oid) {
  const pins: Oid[] = [];
  return {
    pins,
    pin: async (tree: Oid) => {
      pins.push(tree);
      return tree === there;
    },
  };
}

test('a replayed tree gone by the time its pinned is replayed again', async () => {
  // A full repack deleted the first replay's tree before it was pinned: here, a tree that's
  // nowhere, as one made in the clone and deleted from it is.
  const tree = parseOid(TREE);
  const { pins, pin } = pinning(tree);
  const pinned = new Set<Oid>();
  let replays = 0;
  const replay = async (): Promise<Replayed> => {
    replays++;
    return { kind: 'clean', tree: replays === 1 ? UNKNOWN : tree };
  };

  const replayed = await replayPinned(replay, pin, pinned, () => undefined);

  expect(replayed).toEqual({ kind: 'clean', tree });
  expect(replays).toBe(2);
  expect([...pinned]).toEqual([tree]);
  // Pinned once: replaying it again pins nothing more.
  await replayPinned(
    async () => ({ kind: 'clean', tree }),
    pin,
    pinned,
    () => undefined,
  );
  expect(pins).toEqual([UNKNOWN, tree]);
});

test('a replayed tree still gone after a second replay is an error', async () => {
  const { pin } = pinning(parseOid(TREE));
  const pinned = new Set<Oid>();
  let replays = 0;

  const error: unknown = await replayPinned(
    async () => {
      replays++;
      return { kind: 'clean', tree: UNKNOWN };
    },
    pin,
    pinned,
    () => undefined,
  ).catch((caught: unknown) => caught);

  expect(error instanceof GitError && error.detail.kind).toBe('git');
  expect(replays).toBe(2);
  expect(pinned.size).toBe(0);
});
