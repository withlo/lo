// What the window shows of the code port's answers: a peek's answers and code, where each came
// from, the references panel's rows, the outline's nesting and filter, and what the status bar says
// when there's nothing to show.

import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { CodeAnswer } from '../port.ts';
import {
  candidatesOf,
  codeOf,
  failureOf,
  filterOutline,
  groupsOf,
  metaOf,
  noDefinition,
  notYet,
  outlineRows,
  peekOf,
  sourceOf,
  textsFrom,
} from './answers.ts';

const HEAD = 'a'.repeat(40);

function answer(change: Partial<CodeAnswer> = {}): CodeAnswer {
  return {
    key: HEAD,
    side: 'new',
    path: 'src/parser.ts',
    line: 2,
    column: 17,
    name: 'Line',
    kind: 'interface',
    source: 'syntax',
    label: 'Syntax index',
    changed: true,
    ...change,
  };
}

describe('what the status bar says', () => {
  it('names what has no definition', () => {
    expect(noDefinition('parse')).toBe('No definition of `parse` found');
  });

  it('says why code features can’t answer before the local copy, or without git', () => {
    expect(notYet(undefined)).toBe('The syntax index waits for the local copy.');
    expect(notYet({ kind: 'fetching', progress: null, attempt: 1 })).toBe(
      'The syntax index waits for the local copy.',
    );
    expect(notYet({ kind: 'noGit', message: 'No git.', install: '' })).toBe(
      'Code features need git.',
    );
    expect(
      notYet({ kind: 'ready', head: HEAD, base: HEAD, mergeBase: HEAD, offline: false }),
    ).toBeUndefined();
  });

  it('says what main said of a question that failed, and nothing of one a newer one cancelled', () => {
    expect(
      failureOf(new IpcError('unavailable', 'The syntax index waits for the local copy.')),
    ).toBe('The syntax index waits for the local copy.');
    expect(failureOf(new IpcError('cancelled', 'code.definitions was cancelled.'))).toBeUndefined();
    expect(failureOf(new Error('boom'))).toBe('Lo couldn’t ask the syntax index.');
  });
});

describe('a peek', () => {
  it('says where each answer came from, and what sets it apart', () => {
    expect(sourceOf(answer())).toEqual({ source: { kind: 'syntax' }, note: undefined });
    expect(sourceOf(answer({ label: 'Syntax index · same name' }))).toEqual({
      source: { kind: 'syntax' },
      note: 'same name',
    });
    expect(sourceOf(answer({ source: 'server', label: 'TypeScript · overload' }))).toEqual({
      source: { kind: 'server', name: 'TypeScript' },
      note: 'overload',
    });
  });

  it('lists the answers, each with its own key, and shows the code of the one picked', () => {
    const answers = [
      answer(),
      answer({ path: 'test/parser.ts', line: 7, label: 'Syntax index · same name' }),
    ];
    const candidates = candidatesOf(answers);
    expect(candidates.map((each) => [each.key, each.note])).toEqual([
      ['0:src/parser.ts:2:17', undefined],
      ['1:test/parser.ts:7:17', 'same name'],
    ]);
    const code = codeOf({ from: 1, text: ['/** A line. */', 'export interface Line {'] });
    expect(code).toEqual({
      first: 1,
      lines: ['/** A line. */', 'export interface Line {'],
      tokens: undefined,
    });
    expect(peekOf({ name: 'Line', answers, more: false }, 1, code)).toEqual({
      answers: [
        { path: 'src/parser.ts', line: 2, column: 17, source: 'syntax', label: 'Syntax index' },
        {
          path: 'test/parser.ts',
          line: 7,
          column: 17,
          source: 'syntax',
          label: 'Syntax index · same name',
        },
      ],
      shown: 1,
      code,
      label: 'Definitions of Line',
    });
    expect(codeOf(undefined)).toBeUndefined();
  });

  it('says where the answer shown is, at which revision, and whether the PR changes it', () => {
    expect(metaOf(answer(), 'r2')).toBe('src/parser.ts · r2 · changed in this PR');
    expect(metaOf(answer({ changed: false }), undefined)).toBe(
      'src/parser.ts · unchanged in this PR',
    );
  });
});

describe('the references panel', () => {
  const answers = [
    answer({
      path: 'src/format.ts',
      line: 1,
      column: 14,
      lines: { from: 1, text: ["import type { Line } from './parser.ts';"] },
    }),
    answer({ path: 'src/parser.ts', line: 2, column: 17 }),
    answer({ path: 'src/format.ts', line: 6, column: 40 }),
  ];

  it('groups references by file, in the order they come, the name marked in each line', () => {
    const groups = groupsOf(answers, new Map([[2, '  return lines.map((line: Line) => line);']]));
    expect(groups.map((group) => [group.path, group.rows.map((row) => row.line)])).toEqual([
      ['src/format.ts', [1, 6]],
      ['src/parser.ts', [2]],
    ]);
    expect(groups[0]?.rows[0]).toMatchObject({
      text: "import type { Line } from './parser.ts';",
      match: { from: 14, to: 18 },
    });
    expect(groups[0]?.rows[1]).toMatchObject({ match: { from: 40, to: 44 } });
  });

  it('shows the name alone for a reference whose line isn’t read yet', () => {
    expect(groupsOf(answers, new Map())[1]?.rows[0]).toMatchObject({
      text: 'Line',
      match: { from: 0, to: 4 },
    });
  });

  it('fills the lines of the references in the same file that a read around one holds', () => {
    const read = { from: 1, text: ['a', 'b', 'c', 'd', 'e', 'f  Line'] };
    // The first came with its line, and the second is in another file.
    expect(textsFrom(answers, 2, read)).toEqual(new Map([[2, 'f  Line']]));
    expect(textsFrom(answers, 1, read)).toEqual(new Map([[1, 'b']]));
  });
});

describe('the outline', () => {
  const symbols = [
    { name: 'Line', kind: 'interface', line: 2, column: 17, lastLine: 5 },
    { name: 'number', kind: 'property', line: 3, column: 11, lastLine: 3, parent: 0 },
    { name: 'parse', kind: 'function', line: 9, column: 16, lastLine: 12 },
  ] as const;

  it('nests each symbol under its parent', () => {
    expect(outlineRows(symbols).map((row) => [row.symbol.name, row.depth])).toEqual([
      ['Line', 0],
      ['number', 1],
      ['parse', 0],
    ]);
  });

  it('finds symbols by what’s typed, ignoring case, keeping their nesting', () => {
    const rows = outlineRows(symbols);
    expect(filterOutline(rows, 'NUM').map((row) => [row.symbol.name, row.depth])).toEqual([
      ['number', 1],
    ]);
    expect(filterOutline(rows, '  ')).toBe(rows);
  });
});
