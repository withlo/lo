// What an overview's code blocks show: each block's state found by the lines and file it names,
// the code when it resolves, a note in its place when it doesn't, saying why and what the reader
// can do, and, once read, the diff only for a file the pull request changed.

import { LIMITS, type CheckedCode, type CodeRange, type CodeState } from '@lo/artifact';
import { diffText } from '@lo/diff';
import { describe, expect, it } from 'vitest';

import type { DiffedText } from '../../diff/window/shared.ts';
import type { CodeRead } from './checking.ts';
import { excerptOf, nameOf, showsOf, targetsOf, textsOf, type Target } from './targets.ts';

const COMMIT = 'abc1234'.padEnd(40, '0');
const READ: CodeRead = { kind: 'read', commit: COMMIT, files: [] };

function range(path: string, start: number, end = start): CodeRange {
  return { kind: 'code', path, lines: { start, end } };
}

function checked(
  target: CodeRange,
  code: CodeState,
  from: 'block' | 'step' = 'block',
): CheckedCode {
  return { reference: { target, line: 1, from }, code };
}

const resolved: Target = { code: { state: 'resolved' }, answer: undefined };
const broken = (why: Extract<CodeState, { state: 'broken' }>['why']): Target => ({
  code: { state: 'broken', why },
  answer: undefined,
});

describe('targetsOf', () => {
  it('finds each block’s state by the lines and file it names, and main’s answer by its file', () => {
    const find = targetsOf(
      [
        checked(range('src/a.ts', 1, 4), { state: 'resolved' }),
        checked(range('src/a.ts', 5, 9), { state: 'broken', why: 'lines' }, 'step'),
        // A link to the whole file names no lines.
        {
          reference: { target: { kind: 'code', path: 'src/b.ts' }, line: 2, from: 'link' },
          code: { state: 'broken', why: 'missing' },
        },
      ],
      {
        kind: 'read',
        commit: COMMIT,
        files: [
          { path: 'src/a.ts', lines: true, answer: { kind: 'file', size: 10, read: 10 } },
          { path: 'src/a.ts', lines: false, answer: { kind: 'missing' } },
        ],
      },
    );
    expect(find(range('src/a.ts', 1, 4))).toEqual({
      code: { state: 'resolved' },
      answer: { kind: 'file', size: 10, read: 10 },
    });
    expect(find(range('src/a.ts', 5, 9)).code).toEqual({ state: 'broken', why: 'lines' });
    // What the check didn't read, it can't vouch for.
    expect(find(range('src/b.ts', 1))).toEqual({
      code: { state: 'unread', why: 'failed' },
      answer: undefined,
    });
  });

  it('tells paths that look alike as keys apart', () => {
    const find = targetsOf(
      [
        checked(range('2:x', 1), { state: 'resolved' }),
        checked(range('x', 1, 2), { state: 'broken', why: 'missing' }),
      ],
      READ,
    );
    expect(find(range('2:x', 1)).code.state).toBe('resolved');
    expect(find(range('x', 1, 2)).code.state).toBe('broken');
  });
});

describe('showsOf', () => {
  const target = range('src/cache.ts', 3, 9);

  it('shows the code when it resolves', () => {
    expect(showsOf(target, resolved, READ, COMMIT)).toEqual({ kind: 'code' });
  });

  it('offers to find a file of the name a missing one gave', () => {
    expect(showsOf(target, broken('missing'), READ, COMMIT)).toEqual({
      kind: 'note',
      variant: 'unresolved',
      title: 'This reference doesn’t resolve.',
      words: [
        'There’s no ',
        { code: 'src/cache.ts' },
        ' at abc1234, so Lo can’t show the code it names. It may have been renamed, or never pushed.',
      ],
      action: { kind: 'find', name: 'cache.ts' },
    });
  });

  it('offers the file at the newest push when the commit is gone', () => {
    expect(showsOf(target, broken('commit'), READ, COMMIT)).toMatchObject({
      variant: 'missing',
      title: 'The commit this overview describes is gone.',
      action: { kind: 'latest' },
    });
  });

  it('says why lines, folders, links, binary and large files show nothing', () => {
    const words = (found: Target) => {
      const shows = showsOf(target, found, READ, COMMIT);
      if (shows.kind !== 'note') throw new Error('no note');
      expect(shows.variant).toBe('unresolved');
      expect(shows.action).toBe(undefined);
      return shows.words.map((part) => (typeof part === 'string' ? part : part.code)).join('');
    };
    expect(words(broken('lines'))).toBe(
      'src/cache.ts at abc1234 has no lines 3–9, so Lo can’t show them.',
    );
    expect(
      words({
        code: { state: 'broken', why: 'notFile' },
        answer: { kind: 'notFile', is: 'folder' },
      }),
    ).toBe('src/cache.ts at abc1234 is a folder, so it has no lines to show.');
    expect(
      words({ code: { state: 'broken', why: 'notFile' }, answer: { kind: 'notFile', is: 'link' } }),
    ).toBe('src/cache.ts at abc1234 is a symbolic link, so it has no lines to show.');
    expect(words(broken('binary'))).toBe(
      'src/cache.ts at abc1234 isn’t text, so it has no lines to show.',
    );
    expect(words(broken('tooLarge'))).toContain(`larger than ${LIMITS.file / 2 ** 20} MB`);
    expect(showsOf(range('a.ts', 7), broken('lines'), READ, COMMIT)).toMatchObject({
      words: [{ code: 'a.ts' }, ' at abc1234 has no line 7, so Lo can’t show them.'],
    });
  });

  it('says which it is when the code wasn’t read', () => {
    const unread: Target = { code: { state: 'unread', why: 'failed' }, answer: undefined };
    const title = (read: CodeRead, found = unread) => {
      const shows = showsOf(target, found, read, COMMIT);
      return shows.kind === 'note' ? [shows.variant, shows.title, ...shows.words] : [];
    };
    expect(title({ kind: 'waiting' })).toEqual([
      'code',
      'Waiting for the local copy.',
      'Lo shows this code once it has fetched the pull request.',
    ]);
    expect(title({ kind: 'noGit' })).toEqual([
      'code',
      'Lo needs git to show this code.',
      'Code comes from the pull request’s local copy, which git fetches.',
    ]);
    expect(title({ kind: 'failed', why: 'It broke.' })).toEqual([
      'code',
      'Lo couldn’t read this code.',
      'It broke.',
    ]);
    expect(title(READ, { ...unread, answer: { kind: 'unread', why: 'Git failed.' } })).toEqual([
      'code',
      'Lo couldn’t read this code.',
      'Git failed.',
    ]);
    expect(title(READ, { code: { state: 'unread', why: 'stopped' }, answer: undefined })).toEqual([
      'code',
      'Lo couldn’t read this code.',
      'Reading the overview’s code took too long.',
    ]);
  });

  it('names a file by what’s past its last slash', () => {
    expect(nameOf('src/a/b.ts')).toBe('b.ts');
    expect(nameOf('b.ts')).toBe('b.ts');
  });
});

describe('excerptOf', () => {
  const diff = diffText('a\n', 'b\nc\n');
  const tokens = { old: new Uint32Array([0, 1, 2]), new: new Uint32Array([0, 3, 4]) };
  const diffed: DiffedText = { ok: true, diff, tokens, changes: { deleted: [], added: [] } };

  it('shows the diff of a file the pull request changed, with each side’s lines', () => {
    const read = {
      kind: 'text',
      text: 'b\nc\n',
      base: { kind: 'changed', path: 'x', text: 'a\n' },
    } as const;
    expect(textsOf('y', read)).toEqual({ path: 'y', old: 'a\n', new: 'b\nc\n' });
    expect(excerptOf(read, diffed)).toEqual({
      lines: { old: ['a'], new: ['b', 'c'] },
      diff,
      tokens,
    });
  });

  it('shows a file the pull request added as all added', () => {
    const read = { kind: 'text', text: 'b\n', base: { kind: 'added' } } as const;
    expect(textsOf('y', read)).toEqual({ path: 'y', old: null, new: 'b\n' });
    expect(excerptOf(read, diffed)).toMatchObject({ lines: { old: [], new: ['b'] }, diff });
  });

  it('shows plain lines for a file it didn’t change, or that Lo couldn’t diff', () => {
    for (const base of [{ kind: 'same' }, { kind: 'unknown', why: 'No.' }, null] as const) {
      const read = { kind: 'text', text: 'b\n', base } as const;
      expect(textsOf('y', read).old).toBe(null);
      expect(excerptOf(read, diffed)).toEqual({
        lines: { old: [], new: ['b'] },
        diff: undefined,
        tokens: { new: tokens.new },
      });
    }
    const changed = {
      kind: 'text',
      text: 'b\n',
      base: { kind: 'changed', path: 'y', text: 'a\n' },
    } as const;
    for (const failed of [undefined, { ok: false, why: 'No.' } as const]) {
      expect(excerptOf(changed, failed)).toEqual({
        lines: { old: [], new: ['b'] },
        diff: undefined,
        tokens: { new: undefined },
      });
    }
  });
});
