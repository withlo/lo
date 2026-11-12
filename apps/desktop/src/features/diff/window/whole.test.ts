import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { fileKey, type TreePath } from '../../tree/contract.ts';
import type { FileVersions, WholeText } from '../contract.ts';
import { fileLink } from './links.ts';
import { changedIn, pathIn, readOf, reads, readWhole, versionOf, type WholeWork } from './whole.ts';

const HEAD = 'a'.repeat(40);

/** A changed file as main lists it. */
function changed(path: TreePath, change: FileVersions['change'], previous?: TreePath) {
  return {
    path,
    previous: previous ?? null,
    change,
    additions: 1,
    deletions: 1,
    old: null,
    new: null,
    start: 'shown',
    generated: null,
    large: null,
    submodule: null,
    reach: 0,
    conflicted: false,
  } satisfies FileVersions;
}

/** Work whose reads and highlighting the test answers, with what it was asked for and logged. */
function work() {
  const asked: { path: string; large: boolean }[] = [];
  const logged: unknown[] = [];
  const answers: ((text: WholeText | Error) => void)[] = [];
  const colors: ((tokens: Uint32Array | undefined) => void)[] = [];
  const made: WholeWork = {
    whole: ({ path, large }) => {
      asked.push({ path: path.text, large });
      return new Promise((resolve, reject) => {
        answers.push((text) => (text instanceof Error ? reject(text) : resolve(text)));
      });
    },
    highlight: () => new Promise((resolve) => colors.push(resolve)),
    log: (_message, error) => logged.push(error),
  };
  return { made, asked, logged, answers, colors };
}

/** Lets what's waiting on resolved promises run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('a file read whole', () => {
  it('shows its lines, then their highlighting, and drops what an older read brings', async () => {
    const { made, asked, answers, colors } = work();
    const file = { key: 'src/a.ts', version: 'new' as const, path: { text: 'src/a.ts' } };
    readWhole('t1', file, HEAD, false, made);
    expect(reads.get('t1')).toMatchObject({
      key: 'src/a.ts',
      at: HEAD,
      content: { kind: 'reading' },
    });
    // Another file asked for before the first came: the first's text is dropped.
    readWhole('t1', { ...file, key: 'b.ts', path: { text: 'b.ts' } }, HEAD, false, made);
    answers[0]?.({ kind: 'text', text: 'old\n' });
    answers[1]?.({ kind: 'text', text: 'one\r\ntwo\n' });
    await settle();
    expect(asked).toEqual([
      { path: 'src/a.ts', large: false },
      { path: 'b.ts', large: false },
    ]);
    const shown = reads.get('t1');
    expect(shown).toMatchObject({ key: 'b.ts', content: { kind: 'text', tokens: undefined } });
    expect(shown?.content.kind === 'text' && shown.content.lines).toEqual(['one', 'two']);

    const tokens = new Uint32Array([0, 3, 1]);
    colors[0]?.(tokens);
    await settle();
    expect(reads.get('t1')?.content).toMatchObject({ kind: 'text', tokens });
  });

  it('says what main says in place of its lines, in main’s own words when it refuses', async () => {
    const { made, logged, answers } = work();
    const file = { key: 'big.json', version: 'new' as const, path: { text: 'big.json' } };
    for (const [answer, content] of [
      [
        { kind: 'large', size: 2_000_000 },
        { kind: 'large', size: 2_000_000 },
      ],
      [
        { kind: 'binary', size: 12 },
        { kind: 'binary', size: 12 },
      ],
      [{ kind: 'waiting' }, { kind: 'waiting' }],
      [
        new IpcError('invalid', 'There’s no file at that path in the head on screen.'),
        { kind: 'failed', why: 'There’s no file at that path in the head on screen.' },
      ],
      [new Error('the bridge fell over'), { kind: 'failed', why: 'Lo couldn’t read it.' }],
    ] as const) {
      readWhole('t2', file, HEAD, true, made);
      answers.at(-1)?.(answer);
      await settle();
      expect(reads.get('t2')).toMatchObject({ large: true, content });
    }
    expect(logged).toEqual([new Error('the bridge fell over')]);
  });

  it('is of one file, version and head', () => {
    const read = {
      key: 'a.ts',
      version: 'old',
      at: HEAD,
      large: false,
      content: { kind: 'reading' },
    } as const;
    expect(readOf(read, { key: 'a.ts', version: 'old' }, HEAD)).toBe(true);
    expect(readOf(read, { key: 'a.ts', version: 'new' }, HEAD)).toBe(false);
    expect(readOf(read, { key: 'a.ts', version: 'old' }, 'b'.repeat(40))).toBe(false);
    expect(readOf(undefined, { key: 'a.ts', version: 'old' }, HEAD)).toBe(false);
  });
});

/** A file the pull request leaves alone, as the tree has its path. */
const tree = () => ({ text: 'README.md' });

describe('the version of a file shown whole', () => {
  const renamed = changed({ text: 'src/parser.ts' }, 'renamed', { text: 'src/parse.ts' });
  const added = changed({ text: 'data/numbers.txt' }, 'added');
  const deleted = changed({ text: 'src/legacy.ts' }, 'deleted');
  // A path too long to key a map by is known by its digest, as the tree knows it.
  const long = changed({ text: `src/${'x'.repeat(2000)}.ts`, digest: 'f'.repeat(64) }, 'modified');
  const files = [renamed, added, deleted, long];

  it('is a changed file’s, by its key, and a file the pull request leaves alone is the tree’s', () => {
    expect(changedIn(files, 'src/parser.ts')).toBe(renamed);
    expect(changedIn(files, `\0#${'f'.repeat(64)}`)).toBe(long);
    expect(fileKey(long.path)).toBe(`\0#${'f'.repeat(64)}`);
    expect(changedIn(files, 'README.md')).toBeUndefined();
    expect(changedIn(null, 'src/parser.ts')).toBeUndefined();
  });

  it('is one the file has: an added file’s head, a deleted file’s base', () => {
    expect(versionOf(added, 'old')).toBe('new');
    expect(versionOf(deleted, 'new')).toBe('old');
    expect(versionOf(renamed, 'old')).toBe('old');
    expect(versionOf(renamed, 'new')).toBe('new');
    expect(versionOf(undefined, 'old')).toBe('new');
  });

  it('is at the path it had: a renamed file’s old one in the base', () => {
    expect(pathIn(renamed, 'old', tree)).toEqual({ text: 'src/parse.ts' });
    expect(pathIn(renamed, 'new', tree)).toEqual({ text: 'src/parser.ts' });
    expect(pathIn(deleted, 'old', tree)).toEqual({ text: 'src/legacy.ts' });
    expect(pathIn(undefined, 'new', tree)).toEqual({ text: 'README.md' });
  });
});

describe('a file’s page on GitHub', () => {
  const pull = { owner: 'rozed-dev', repo: 'e2e', number: 78 };

  it('is at a commit, at a line if given, with each byte an address can’t hold escaped', () => {
    expect(fileLink(pull, HEAD, { text: 'README.md' })).toBe(
      `https://github.com/rozed-dev/e2e/blob/${HEAD}/README.md`,
    );
    expect(fileLink(pull, HEAD, { text: 'docs/a b#c.md' }, 12)).toBe(
      `https://github.com/rozed-dev/e2e/blob/${HEAD}/docs/a%20b%23c.md#L12`,
    );
    // A path that isn't UTF-8, by its bytes.
    expect(fileLink(pull, HEAD, { text: 'caf�', hex: '636166e9' })).toBe(
      `https://github.com/rozed-dev/e2e/blob/${HEAD}/caf%E9`,
    );
  });
});
