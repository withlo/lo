// Answers from the syntax index, on a local copy built in memory and indexed as main indexes it: a
// name's definitions, ranked, with the lines around them; where it's used, by name; the hover's
// line; a file's outline; and refusals for a tree the view doesn't show or a line past the end.

import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { BYTES_PER_JOB } from '../jobs.ts';
import { MAX_REFERENCES } from '../port.ts';
import {
  definitions,
  hover,
  nameAt,
  outline,
  references,
  snippet,
  type Answering,
} from './answers.ts';
import { buildTree } from './build.ts';
import type { ViewSides } from './indexer.ts';
import { commitOf, fakeBackground, fakeRepo, memoryStore } from './test/fake.ts';

const PARSE = `export interface Line { text: string }
export function parse(input: string) { return input.split('\\n') }
`;
const FORMAT = `import { parse } from './parse.ts'
export function format(input: string) { return parse(input).join(' ') }
`;
const OTHER = `export function parse() { return 'another' }
`;

/** A view comparing `base` with `head`, both indexed; `more` adds files to both. */
async function view(more: Readonly<Record<string, string>> = {}) {
  const repo = fakeRepo({
    commits: {
      base: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT, ...more },
      head: {
        'src/parse.ts': PARSE,
        'src/format.ts': `${FORMAT}// later\n`,
        'lib/other.ts': OTHER,
        ...more,
      },
    },
  });
  const background = fakeBackground();
  const store = memoryStore();
  const trees: Record<string, string> = {};
  for (const side of ['head', 'base']) {
    const built = await buildTree({
      repo,
      commit: commitOf(side),
      changed: ['src/format.ts', 'lib/other.ts'],
      store,
      read: (files) => background.symbols(files),
      version: 'v1',
      progress: { all: new Set(), done: new Set() },
    });
    trees[side] = built.tree;
  }
  const sides: ViewSides = {
    clone: () => Promise.resolve(repo),
    new: { commit: commitOf('head'), tree: trees.head },
    old: { commit: commitOf('base'), tree: trees.base },
  };
  const answering: Answering = {
    store,
    version: async () => 'v1',
    read: (files) => background.symbols(files),
    find: (name, files) => background.find(name, files),
    render: () => Promise.reject(new Error('The syntax index reads no hover’s Markdown.')),
  };
  return { sides, answering, background };
}

const head = commitOf('head');

/** How a question went: `answered`, or the code it was refused with. */
const code = (asked: Promise<unknown>) =>
  asked.then(
    () => 'answered',
    (error: unknown) => (error instanceof IpcError ? error.code : String(error)),
  );

describe('nameAt', () => {
  it('takes the name under the cursor, or just before it', () => {
    expect(nameAt('return parse(input)', 9)).toBe('parse');
    expect(nameAt('return parse(input)', 12)).toBe('parse');
    expect(nameAt('return parse(input)', 6)).toBe('return');
    expect(nameAt('a  b', 2)).toBe(undefined);
    expect(nameAt('x = 42', 4)).toBe(undefined);
  });
});

describe('answers from the syntax index', () => {
  it('finds a name’s definitions, the one its file imports first, with the lines around it', async () => {
    const { sides, answering } = await view();
    const found = await definitions(answering, sides, {
      key: head,
      path: 'src/format.ts',
      line: 2,
      column: 48,
    });
    expect(found.name).toBe('parse');
    expect(found.answers).toMatchObject([
      {
        key: head,
        side: 'new',
        path: 'src/parse.ts',
        line: 2,
        kind: 'function',
        source: 'syntax',
        label: 'Code index',
        changed: false,
        lines: { from: 1, text: PARSE.trimEnd().split('\n') },
      },
      { path: 'lib/other.ts', label: 'Code index · same name', changed: true },
    ]);
    expect(found.more).toBe(false);
  });

  it('finds where a name is used, by name, and says so', async () => {
    const { sides, answering } = await view();
    const found = await references(answering, sides, {
      key: head,
      path: 'src/parse.ts',
      line: 2,
      column: 17,
    });
    expect(found.name).toBe('parse');
    expect(found.note).toBe('By name: may include other things called this.');
    expect(found.answers.map(({ path, line, column }) => ({ path, line, column }))).toEqual([
      { path: 'src/format.ts', line: 1, column: 9 },
      // The stand-in for tree-sitter finds the name in the import's path too.
      { path: 'src/format.ts', line: 1, column: 25 },
      { path: 'src/format.ts', line: 2, column: 47 },
    ]);
    expect(found.answers[0]).toMatchObject({ label: 'Code index · same name', changed: true });
  });

  it('looks through a file once however many paths hold it, within a job’s bytes, and caps its uses', async () => {
    // About 100 KB using `parse` 100 times, at 60 paths: 6 MB and 6,000 uses, were each path its own.
    const copy = `${'parse()\n'.repeat(100)}${`// ${'x'.repeat(97)}\n`.repeat(1000)}`;
    const copies = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [`copies/${index}.ts`, copy]),
    );
    const { sides, answering, background } = await view(copies);
    const found = await references(answering, sides, {
      key: head,
      path: 'src/parse.ts',
      line: 2,
      column: 17,
    });
    expect(background.looked.filter((text) => text === copy)).toHaveLength(1);
    for (const bytes of background.finds) expect(bytes).toBeLessThanOrEqual(BYTES_PER_JOB);
    expect(found.answers).toHaveLength(MAX_REFERENCES);
    expect(found.more).toBe(true);
    // The first 50 paths, in path order, each with its 100 uses.
    expect(new Set(found.answers.map((answer) => answer.path)).size).toBe(50);
  });

  it('shows the top definition’s line in the hover, and a file’s outline', async () => {
    const { sides, answering } = await view();
    expect(
      await hover(answering, sides, { key: head, path: 'src/format.ts', line: 2, column: 48 }),
    ).toMatchObject({
      name: 'parse',
      kind: 'function',
      text: "export function parse(input: string) { return input.split('\\n') }",
      label: 'Code index',
    });
    expect(await outline(answering, sides, { key: head, path: 'src/parse.ts' })).toMatchObject({
      symbols: [
        { name: 'Line', kind: 'interface', line: 1 },
        { name: 'parse', kind: 'function', line: 2 },
      ],
      more: false,
    });
    expect(await snippet(sides, { key: head, path: 'src/parse.ts', line: 1 })).toEqual({
      from: 1,
      text: PARSE.trimEnd().split('\n'),
    });
  });

  it('refuses a tree the view doesn’t show, a file that isn’t there and a line past the end', async () => {
    const { sides, answering } = await view();
    const place = { path: 'src/format.ts', line: 1, column: 0 };
    expect(
      await code(definitions(answering, sides, { ...place, key: commitOf('elsewhere') })),
    ).toBe('refused');
    expect(
      await code(definitions(answering, sides, { ...place, key: head, path: 'src/none.ts' })),
    ).toBe('missing');
    expect(await code(references(answering, sides, { ...place, key: head, line: 4 }))).toBe(
      'invalid',
    );
    expect(await code(snippet(sides, { key: head, path: 'src/parse.ts', line: 3 }))).toBe(
      'invalid',
    );
    // The old side's tree is the view's too.
    expect(
      await code(definitions(answering, sides, { ...place, key: commitOf('base'), line: 1 })),
    ).toBe('answered');
  });
});
