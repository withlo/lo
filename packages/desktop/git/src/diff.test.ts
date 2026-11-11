import { expect, test } from 'vitest';

import {
  type ChangedFile,
  changedPath,
  type FileVersion,
  parseChanges,
  rawDiffBlobs,
} from './diff.ts';
import { parseOid } from './oid.ts';
import { displayPath, type FileMode } from './tree.ts';

const A = '1111111111111111111111111111111111111111';
const B = '2222222222222222222222222222222222222222';
const ZERO = '0000000000000000000000000000000000000000';

function version(path: string, oid: string, mode: FileMode): FileVersion {
  return { path: Buffer.from(path), oid: parseOid(oid), mode };
}

/** A side, with its path as text. */
function shownSide(side: FileVersion | undefined) {
  return side === undefined ? undefined : { ...side, path: displayPath(side.path) };
}

/** What a file's records say, with its paths as text. */
function shown(file: ChangedFile) {
  return { ...file, old: shownSide(file.old), new: shownSide(file.new) };
}

function lines(added: number, deleted: number) {
  return { added, deleted };
}

test('parses raw and numstat records', () => {
  const output =
    `:000000 100644 ${ZERO} ${A} A\0added.txt\0` +
    `:100644 100644 ${A} ${B} M\0data.bin\0` +
    `:100644 000000 ${A} ${ZERO} D\0gone.txt\0` +
    `:100644 100755 ${A} ${B} M\0run.sh\0` +
    `:120000 100644 ${A} ${B} T\0link\0` +
    `:100644 100644 ${A} ${B} R087\0old.rs\0src/new.rs\0` +
    `:160000 160000 ${A} ${B} M\0vendor/lib\0` +
    '1\t0\tadded.txt\0-\t-\tdata.bin\x000\t1\tgone.txt\x000\t0\trun.sh\0' +
    '1\t1\tlink\x003\t1\t\0old.rs\0src/new.rs\x001\t1\tvendor/lib\0';

  const files = parseChanges(Buffer.from(output));

  const file = (
    change: ChangedFile['change'],
    old: FileVersion | undefined,
    now: FileVersion | undefined,
    binary: boolean,
    counted: ChangedFile['lines'],
  ) => shown({ change, old, new: now, binary, lines: counted });
  expect(files.map(shown)).toEqual([
    file({ kind: 'added' }, undefined, version('added.txt', A, 'regular'), false, lines(1, 0)),
    file(
      { kind: 'modified' },
      version('data.bin', A, 'regular'),
      version('data.bin', B, 'regular'),
      true,
      undefined,
    ),
    file({ kind: 'deleted' }, version('gone.txt', A, 'regular'), undefined, false, lines(0, 1)),
    file(
      { kind: 'modified' },
      version('run.sh', A, 'regular'),
      version('run.sh', B, 'executable'),
      false,
      lines(0, 0),
    ),
    file(
      { kind: 'typeChanged' },
      version('link', A, 'symlink'),
      version('link', B, 'regular'),
      false,
      lines(1, 1),
    ),
    file(
      { kind: 'renamed', similarity: 87 },
      version('old.rs', A, 'regular'),
      version('src/new.rs', B, 'regular'),
      false,
      lines(3, 1),
    ),
    file(
      { kind: 'modified' },
      version('vendor/lib', A, 'submodule'),
      version('vendor/lib', B, 'submodule'),
      false,
      undefined,
    ),
  ]);
  const [added, , gone, , , renamed] = files;
  expect(gone && displayPath(changedPath(gone))).toBe('gone.txt');
  expect(renamed && displayPath(changedPath(renamed))).toBe('src/new.rs');
  expect(renamed?.old && displayPath(renamed.old.path)).toBe('old.rs');
  expect(added?.old).toBeUndefined();
});

test('paths are bytes whatever they hold', () => {
  const output = Buffer.concat([
    Buffer.from(`:000000 100644 ${ZERO} ${A} A\0`),
    Buffer.from('caf\xe9.txt\0', 'latin1'),
    Buffer.from(`:100644 100644 ${A} ${B} R090\0`),
    Buffer.from('old\tname\0new\tname\0'),
    Buffer.from('1\t0\tcaf\xe9.txt\x002\t1\t\0old\tname\0new\tname\0', 'latin1'),
  ]);

  const files = parseChanges(output);

  expect(files).toHaveLength(2);
  const [cafe, renamed] = files;
  expect(cafe && changedPath(cafe)).toEqual(Buffer.from('caf\xe9.txt', 'latin1'));
  expect(cafe && displayPath(changedPath(cafe))).toBe('caf�.txt');
  expect(cafe?.lines).toEqual({ added: 1, deleted: 0 });
  expect(renamed?.old?.path.toString('utf8')).toBe('old\tname');
  expect(renamed && displayPath(changedPath(renamed))).toBe('new\tname');
  expect(renamed?.lines).toEqual({ added: 2, deleted: 1 });
});

test('nothing changed is an empty list', () => {
  expect(parseChanges(Buffer.alloc(0))).toEqual([]);
});

test('refuses output it doesnt understand', () => {
  for (const output of [
    `:100644 100644 ${A} ${B} R100\0only-one-path\0`,
    `:100644 100644 ${A} ${B} X\0what\0`,
    `:100644 100644 ${A} ${B} M\0a\0`,
    `:100644 100644 ${A} ${B} M\0a\x001\t1\tb\0`,
    `:100644 100644 ${A} ${B} M\0a\x001\t1\ta\x001\t1\ta\0`,
    `:040000 040000 ${A} ${B} M\0dir\x001\t1\tdir\0`,
    '1\t1\ta\0',
  ]) {
    expect.soft(() => parseChanges(Buffer.from(output))).toThrow('printed an unexpected');
  }
});

test('a raw diff names both sides blobs but not submodules or missing sides', () => {
  const [a, b, c] = ['a', 'b', 'c'].map((digit) => digit.repeat(40));
  // The second path starts with a colon and has spaces, as a file's name can: read as an entry,
  // it would name blobs that aren't there.
  const output =
    `:100644 100644 ${a} ${b} M\0x.rs\0:000000 100644 ${ZERO} ${c} A\0:x y z w\0` +
    `:160000 160000 ${a} ${b} M\0sub\0`;

  expect(rawDiffBlobs(Buffer.from(output))).toEqual([a, b, c]);
});
