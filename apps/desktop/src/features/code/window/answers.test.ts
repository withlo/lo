// What the window shows of the code port's answers: a peek's answers and code, where each came
// from and why a language server didn't give them, the references panel's rows, the hover card's
// declaration and docs, the outline's nesting and filter, and what the status bar says when there's
// nothing to show, `gh`'s reasons among it.

import { markdownTree } from '@lo/markdown';
import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Servers, Status } from '../contract.ts';
import type { CodeAnswer } from '../port.ts';
import {
  allOutside,
  candidatesOf,
  cardOf,
  codeOf,
  failureOf,
  filterOutline,
  groupsOf,
  metaOf,
  noDefinition,
  noHints,
  noneFound,
  NOT_YET,
  notYet,
  outlineRows,
  peekOf,
  peekSource,
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
  it('names what has no definition, and why a language server didn’t answer', () => {
    expect(noDefinition('parse')).toBe('No definition of `parse` found');
    expect(noneFound(noDefinition('parse'), undefined)).toBe('No definition of `parse` found');
    expect(noneFound(noDefinition('parse'), 'TypeScript is starting.')).toBe(
      'No definition of `parse` found. TypeScript is starting.',
    );
  });

  it('counts references a language server found only outside the repository', () => {
    expect(allOutside('parse', 3)).toBe('`parse` has 3 references, all outside this repository.');
    expect(allOutside('parse', 1)).toBe('`parse` has 1 reference, outside this repository.');
  });

  it('says why code features can’t answer before the local copy, or without git', () => {
    expect(notYet(undefined)).toBe('waiting');
    expect(notYet({ kind: 'fetching', progress: null, attempt: 1 })).toBe('waiting');
    expect(
      notYet({ kind: 'noGit', git: { status: 'missing', install: { commands: [], page: null } } }),
    ).toBe('noGit');
    // What Git said is the local copy's own Details, never in the line.
    expect(notYet({ kind: 'failed', failure: 'diskFull', details: 'the disk is full' })).toBe(
      'notFetched',
    );
    expect(NOT_YET.notFetched).toBe('The local copy couldn’t be fetched');
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
  it('says in its head where a single answer came from, or why the index answered', () => {
    const server = answer({ source: 'server', label: 'TypeScript' });
    expect(peekSource({ answers: [server] })).toEqual({
      source: { kind: 'server', name: 'TypeScript' },
      note: undefined,
    });
    expect(peekSource({ answers: [answer({ from: 'zod' })] })).toEqual({
      source: { kind: 'syntax' },
      note: "From zod, which Lo doesn't install",
    });
    // Several, whose list says where each came from.
    expect(peekSource({ answers: [server, server] })).toBeUndefined();
    expect(
      peekSource({ answers: [answer(), answer()], fallback: 'TypeScript is starting.' }),
    ).toEqual({ source: { kind: 'syntax' }, note: 'TypeScript is starting.' });
  });

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
      waiting: false,
      label: 'Definitions of Line',
    });
    expect(codeOf(undefined)).toBeUndefined();
    // Before its code comes, the peek waits for it, as tall as code gets.
    expect(peekOf({ name: 'Line', answers, more: false }, 0, undefined).waiting).toBe(true);
  });

  it('lists an answer outside the repository with no file, nothing to go to and no code to wait for', () => {
    const outside = {
      outside: true,
      name: 'Array',
      source: 'server',
      label: 'TypeScript',
    } as const;
    const answers = [outside, answer({ source: 'server', label: 'TypeScript' })];
    expect(candidatesOf(answers)[0]).toEqual({
      key: '0:outside:Array',
      outside: true,
      source: { kind: 'server', name: 'TypeScript' },
      note: undefined,
    });
    expect(peekOf({ name: 'Array', answers, more: false }, 0, undefined).waiting).toBe(false);
    expect(metaOf(outside, 'r2')).toBe('Outside this repository');
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

/** A server's hover in Markdown, as the background process reads it. */
function hoverIn(text: string) {
  return { text, markdown: true, tree: markdownTree(text, { breaks: false }) };
}

describe('the card over a word', () => {
  it('draws a server’s code blocks at the start as the declaration, in order, and the rest as docs', () => {
    const card = cardOf(
      hoverIn(
        '```rust\nlo::parse\n```\n\n```rust\npub fn parse(input: &str)\n```\n\n---\n\nReads a line.',
      ),
    );
    // A module's path, then the signature, as rust-analyzer writes them.
    expect(card?.signature).toBe('lo::parse\npub fn parse(input: &str)');
    expect(card?.docs?.blocks.map((block) => block.kind)).toEqual(['paragraph']);
    expect(JSON.stringify(card?.docs)).toContain('Reads a line.');
  });

  it('draws a hover without a code block as its docs alone, never as Markdown text', () => {
    const card = cardOf(hoverIn('**Line**: a line of the input.'));
    expect(card?.signature).toBeUndefined();
    expect(card?.docs?.blocks[0]?.kind).toBe('paragraph');
    expect(JSON.stringify(card)).not.toContain('**');
    // Markdown that came without its tree, or reads as nothing, draws nothing.
    expect(cardOf({ text: '**Line**', markdown: true })).toBeUndefined();
    expect(cardOf(hoverIn('---'))).toBeUndefined();
  });

  it('draws the syntax index’s line as it is', () => {
    expect(cardOf({ text: '  export interface Line {', markdown: false })).toEqual({
      signature: '  export interface Line {',
      docs: undefined,
    });
    expect(cardOf({ text: ' ', markdown: false })).toBeUndefined();
  });
});

describe('gh with no type hints', () => {
  const view = 'a'.repeat(32);
  const status = (trust: Status['trust'], head: Status['head'] = { kind: 'base' }): Status => ({
    view,
    repo: 'rozed-dev/e2e',
    pull: 80,
    head,
    trust,
    dismissed: false,
  });
  const trusted = status({ kind: 'trusted', by: 'repo' });
  const servers = (state: Servers['servers'][number]['state']): Servers => ({
    view,
    off: false,
    servers: [{ id: 'typescript', name: 'TypeScript', state }],
  });
  const ready = servers({ kind: 'ready' });

  it('says nothing once one came', () => {
    const hint = { line: 1, column: 1, label: ': string' };
    expect(noHints([{ hints: [] }, { hints: [hint], label: 'TypeScript' }], trusted, ready)).toBe(
      undefined,
    );
  });

  it('says why the server that reads the code gave none', () => {
    const asked = { hints: [], label: 'TypeScript' };
    expect(noHints([asked], trusted, ready)).toBe(
      'TypeScript gives no type hints for the code on screen.',
    );
    expect(noHints([{ ...asked, fallback: 'TypeScript is starting.' }], trusted, null)).toBe(
      'TypeScript is starting.',
    );
    expect(noHints([{ ...asked, none: 'Pyright has no type hints.' }], trusted, ready)).toBe(
      'Pyright has no type hints.',
    );
    const failed = servers({ kind: 'failed', why: { kind: 'error', message: 'It exited.' } });
    expect(noHints([{ ...asked, fallback: 'TypeScript stopped.' }], trusted, failed)).toBe(
      'TypeScript failed. Restart it from the status bar.',
    );
    const missing = servers({ kind: 'missing', needs: 'Go 1.24 or newer' });
    expect(noHints([asked], trusted, missing)).toBe('TypeScript needs Go 1.24 or newer.');
    const why = 'The checkout’s tsconfig.json names a plugin, so Lo won’t run vtsls on it.';
    expect(noHints([asked], trusted, servers({ kind: 'refused', why }))).toBe(why);
    // A file whose server says why comes before one that doesn't.
    expect(noHints([asked, { ...asked, fallback: 'TypeScript is starting.' }], trusted, null)).toBe(
      'TypeScript is starting.',
    );
  });

  it('says why no server reads the code, from the view’s trust', () => {
    expect(noHints([{ hints: [] }], trusted, ready)).toBe(
      'No language server reads the code on screen.',
    );
    expect(noHints([], status({ kind: 'untrusted', why: 'unnamed' }), null)).toBe(
      'Type hints need a language server, which Lo runs only on repos you trust.',
    );
    expect(
      noHints(
        [],
        status({ kind: 'untrusted', why: 'unnamed' }, { kind: 'fork', repo: 'sam/e2e' }),
        null,
      ),
    ).toBe('Type hints need a language server, which Lo runs only on PRs you trust.');
    // The banner's cause: Lo can't tell whose code it is.
    expect(noHints([], status({ kind: 'untrusted', why: 'unnamed' }, { kind: 'gone' }), null)).toBe(
      'Type hints need a language server. GitHub no longer has this PR’s fork, so Lo can’t tell whose code it is.',
    );
    expect(noHints([], status({ kind: 'checking' }), null)).toBe(
      'Type hints wait for Lo to work out whether this repo is trusted.',
    );
    expect(noHints([], null, null)).toBe('Type hints need a language server.');
  });
});
