// Which answers win: a ready server's within its deadline, alone, on the new side; the syntax
// index's, saying why, when the server is starting, slow or stopped; the asking file's import and
// then the index's when the server found nothing; the index's always on the old side, and for a
// file whose checkout isn't the head's blob. Places outside the checkout are never read. The server
// here stands in, answering what each test says.

import type { Answer, Method } from '@lo/lsp';
import { markdownTree } from '@lo/markdown';
import { describe, expect, it } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import type { Answering, RenderHover } from './answers.ts';
import { buildTree } from './build.ts';
import type { ViewSides } from './indexer.ts';
import {
  hintsOf,
  hoverText,
  locationsOf,
  outlineOf,
  servedDefinitions,
  servedHints,
  servedHover,
  servedOutline,
  servedReferences,
  type NotServing,
  type Serving,
} from './served.ts';
import { commitOf, fakeBackground, fakeRepo, memoryStore } from './test/fake.ts';

const PARSE = `export interface Line { text: string }
export function parse(input: string) { return input.split('\\n') }
`;
const FORMAT = `import { parse } from './parse.ts'
export function format(input: string) { return parse(input).join(' ') }
`;
const OTHER = `export function parse() { return 'another' }
`;

const head = commitOf('head');
const base = commitOf('base');

/** A hover's Markdown read as the background process reads it. */
const READ: RenderHover = (_view, markdown) =>
  Promise.resolve(markdownTree(markdown, { breaks: false }));

/** A view comparing `base` with `head`, both indexed, whose hovers `render` reads. */
async function view(render: RenderHover = READ) {
  const repo = fakeRepo({
    commits: {
      base: { 'src/parse.ts': PARSE, 'src/format.ts': FORMAT },
      head: {
        'src/parse.ts': PARSE,
        'src/format.ts': `${FORMAT}// later\n`,
        'lib/other.ts': OTHER,
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
    new: { commit: head, tree: trees.head },
    old: { commit: base, tree: trees.base },
  };
  const answering: Answering = {
    store,
    version: async () => 'v1',
    read: (files) => background.symbols(files),
    find: (name, files) => background.find(name, files),
    render,
  };
  return { sides, answering };
}

const CHECKOUT = 'file:///cache/checkouts/pull-1/head';

/**
 * A ready server that answers each method as `answers` says, noting what it's asked, and offering
 * inline hints unless `hints` says otherwise.
 */
function standIn(
  answers: Partial<Record<Method, Answer>>,
  matches = true,
  hints: { offered?: boolean; none?: string } = {},
) {
  const asked: Method[] = [];
  const opened: string[] = [];
  const serving: Serving = {
    kind: 'ready',
    name: 'TypeScript',
    languageId: 'typescript',
    noHints: hints.none,
    server: {
      capabilities: { hoverProvider: true, inlayHintProvider: hints.offered ?? true },
      open(path) {
        opened.push(path);
        return true;
      },
      request(method) {
        asked.push(method);
        return Promise.resolve(answers[method] ?? { ok: true, value: null });
      },
      pathOf: (uri) =>
        uri.startsWith(`${CHECKOUT}/`) ? uri.slice(CHECKOUT.length + 1) : undefined,
    },
    matches: () => Promise.resolve(matches),
  };
  return { serving, asked, opened, serverOf: () => serving };
}

/** A place in a location's answer, at line `line` (from 1) and `column` of `path`. */
function at(path: string, line: number, column: number) {
  const start = { line: line - 1, character: column };
  return { uri: `${CHECKOUT}/${path}`, range: { start, end: start } };
}

/** `parse` in src/format.ts's second line, on the new side. */
const PARSE_CALL = {
  view: 'v1',
  key: head,
  path: 'src/format.ts',
  line: 2,
  column: FORMAT.split('\n')[1]?.indexOf('parse(') ?? 0,
};

describe('definitions', () => {
  it('takes a ready server’s answer alone, within its deadline, labelled with its name', async () => {
    const { sides, answering } = await view();
    const { serverOf, asked, opened } = standIn({
      'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] },
    });
    const found = await servedDefinitions(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(asked).toEqual(['textDocument/definition']);
    expect(opened).toEqual(['src/format.ts']);
    expect(found).toMatchObject({
      name: 'parse',
      more: false,
      answers: [
        {
          key: head,
          side: 'new',
          path: 'src/parse.ts',
          line: 2,
          column: 16,
          source: 'server',
          label: 'TypeScript',
          changed: false,
          lines: { from: 1 },
        },
      ],
    });
    expect(found.answers).toHaveLength(1);
    expect(found.fallback).toBeUndefined();
  });

  it('shows a place outside the checkout as outside the repository, after the file’s import', async () => {
    const { sides, answering } = await view();
    const { serverOf } = standIn({
      'textDocument/definition': {
        ok: true,
        value: [
          { uri: 'file:///Users/someone/toolchain/lib.d.ts', range: at('x', 1, 0).range },
          // In the checkout, but not in the head's tree, as a build's output.
          at('dist/parse.js', 1, 0),
        ],
      },
    });
    const found = await servedDefinitions(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(found.answers).toEqual([
      expect.objectContaining({ path: 'src/format.ts', line: 1, from: './parse.ts' }),
      { outside: true, name: 'parse', source: 'server', label: 'TypeScript' },
    ]);
  });

  it('gives the file’s import of the name, then the index’s answers, when the server found nothing', async () => {
    const { sides, answering } = await view();
    const { serverOf } = standIn({ 'textDocument/definition': { ok: true, value: [] } });
    const found = await servedDefinitions(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(found.answers.map((each) => ('outside' in each ? 'outside' : each.path))).toEqual([
      'src/format.ts',
      'src/parse.ts',
      'lib/other.ts',
    ]);
    expect(found.answers[0]).toMatchObject({ from: './parse.ts', source: 'syntax', line: 1 });
    expect(found.answers[1]).toMatchObject({ source: 'syntax' });
  });

  it('answers from the index, saying why, when the server is starting, slow or stopped', async () => {
    const { sides, answering } = await view();
    const starting: NotServing = { kind: 'starting', name: 'TypeScript' };
    const failed: NotServing = { kind: 'failed', name: 'TypeScript' };
    const slow = standIn({ 'textDocument/definition': { ok: false, why: 'deadline' } });
    const cases = [
      [() => starting, 'TypeScript is starting.'],
      [() => failed, 'TypeScript stopped.'],
      [slow.serverOf, "TypeScript didn't answer in time."],
      [
        standIn({ 'textDocument/definition': { ok: false, why: 'notReady' } }).serverOf,
        'TypeScript is starting.',
      ],
    ] as const;
    for (const [serverOf, fallback] of cases) {
      const found = await servedDefinitions(answering, sides, PARSE_CALL, undefined, serverOf);
      expect(found.fallback).toBe(fallback);
      expect(found.answers[0]).toMatchObject({ source: 'syntax', path: 'src/parse.ts' });
    }
  });

  it('answers from the index on the old side, and for a file whose checkout isn’t the head’s', async () => {
    const { sides, answering } = await view();
    const server = standIn({
      'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] },
    });
    const old = await servedDefinitions(
      answering,
      sides,
      { ...PARSE_CALL, key: base },
      undefined,
      server.serverOf,
    );
    expect(old.answers[0]).toMatchObject({ source: 'syntax', side: 'old' });
    expect(server.asked).toEqual([]);

    const differs = standIn(
      { 'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] } },
      false,
    );
    const found = await servedDefinitions(
      answering,
      sides,
      PARSE_CALL,
      undefined,
      differs.serverOf,
    );
    expect(found.answers[0]).toMatchObject({ source: 'syntax' });
    expect(found.fallback).toBeUndefined();
    expect(differs.asked).toEqual([]);
    expect(differs.opened).toEqual([]);
  });
});

describe('the other questions', () => {
  it('takes the server’s references, counting those outside, and its hover', async () => {
    const { sides, answering } = await view();
    const { serverOf } = standIn({
      'textDocument/references': {
        ok: true,
        value: [
          at('src/format.ts', 2, 48),
          at('src/parse.ts', 2, 16),
          { uri: 'jdt://x', range: at('x', 1, 0).range },
        ],
      },
      'textDocument/hover': {
        ok: true,
        value: {
          contents: { kind: 'markdown', value: '```ts\nfunction parse(input: string)\n```' },
        },
      },
    });
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(references).toMatchObject({ name: 'parse', outside: 1, more: false });
    expect(references.answers.map((each) => `${each.path}:${each.line} ${each.label}`)).toEqual([
      'src/format.ts:2 TypeScript',
      'src/parse.ts:2 TypeScript',
    ]);
    expect(references.note).toBeUndefined();
    const hovered = await servedHover(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(hovered).toMatchObject({
      name: 'parse',
      kind: undefined,
      text: '```ts\nfunction parse(input: string)\n```',
      markdown: true,
      source: 'server',
      label: 'TypeScript',
      // Read as Lo's tree, which is what the card draws.
      tree: { blocks: [{ kind: 'code', language: 'ts', text: 'function parse(input: string)' }] },
    });
  });

  it('falls back to the index’s hover, saying why, when its Markdown can’t be read', async () => {
    const { sides, answering } = await view(() =>
      Promise.reject(new IpcError('restarted', 'The background process stopped.')),
    );
    const { serverOf } = standIn({
      'textDocument/hover': { ok: true, value: { contents: { kind: 'markdown', value: '**x**' } } },
    });
    const hovered = await servedHover(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(hovered).toMatchObject({
      source: 'syntax',
      markdown: false,
      fallback: "Lo couldn't read TypeScript's hover.",
    });
    // Markdown that draws nothing is no hover.
    const { answering: reading } = await view();
    const blank = standIn({
      'textDocument/hover': {
        ok: true,
        value: { contents: { kind: 'markdown', value: '<!-- nothing -->' } },
      },
    });
    const none = await servedHover(reading, sides, PARSE_CALL, undefined, blank.serverOf);
    expect(none).toMatchObject({ source: 'syntax' });
    expect(none?.fallback).toBeUndefined();
  });

  it('falls back to the index’s hover when the server has none, and its references when slow', async () => {
    const { sides, answering } = await view();
    const { serverOf } = standIn({
      'textDocument/references': { ok: false, why: 'deadline' },
      'textDocument/hover': { ok: true, value: null },
    });
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(references.fallback).toBe("TypeScript didn't answer in time.");
    expect(references.answers.every((each) => each.source === 'syntax')).toBe(true);
    const hovered = await servedHover(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(hovered).toMatchObject({ source: 'syntax', markdown: false, label: 'Syntax index' });
  });

  it('gives the server’s hints on the new side only, and its outline, nested', async () => {
    const { sides, answering } = await view();
    const range = at('x', 2, 0).range;
    const { serverOf } = standIn({
      'textDocument/inlayHint': {
        ok: true,
        value: [
          { position: { line: 1, character: 37 }, label: ': string[]', paddingLeft: true },
          { position: { line: 40, character: 0 }, label: 'past the lines asked' },
        ],
      },
      'textDocument/documentSymbol': {
        ok: true,
        value: [
          {
            name: 'format',
            kind: 12,
            range,
            selectionRange: range,
            children: [{ name: 'input', kind: 13, range, selectionRange: range }],
          },
        ],
      },
    });
    const file = { view: 'v1', key: head, path: 'src/format.ts', from: 1, to: 2 };
    expect(await servedHints(sides, file, undefined, serverOf)).toEqual({
      hints: [{ line: 2, column: 37, label: ': string[]', paddingLeft: true }],
      label: 'TypeScript',
    });
    expect(await servedHints(sides, { ...file, key: base }, undefined, serverOf)).toEqual({
      hints: [],
    });
    expect(await servedOutline(answering, sides, file, undefined, serverOf)).toEqual({
      symbols: [
        { name: 'format', kind: 'function', line: 2, column: 0, lastLine: 2 },
        { name: 'input', kind: 'variable', line: 2, column: 0, lastLine: 2, parent: 0 },
      ],
      more: false,
      source: 'server',
      label: 'TypeScript',
    });
  });
});

describe('type hints', () => {
  const file = { view: 'v1', key: head, path: 'src/format.ts', from: 1, to: 2 };

  it('asks a server with no inline hints for none, and says why', async () => {
    const { sides } = await view();
    const unoffered = standIn({}, true, { offered: false });
    expect(await servedHints(sides, file, undefined, unoffered.serverOf)).toEqual({
      hints: [],
      label: 'TypeScript',
      none: 'TypeScript has no inline hints.',
    });
    // Its adapter's word comes first, as for a paid feature the server would refuse.
    const paid = standIn({}, true, { none: 'Its free version has no inline hints.' });
    expect(await servedHints(sides, file, undefined, paid.serverOf)).toEqual({
      hints: [],
      label: 'TypeScript',
      none: 'Its free version has no inline hints.',
    });
    expect([...unoffered.asked, ...paid.asked]).toEqual([]);
  });

  it('says why a server that reads the file gave none, and names none where none reads it', async () => {
    const { sides } = await view();
    const starting: NotServing = { kind: 'starting', name: 'TypeScript' };
    expect(await servedHints(sides, file, undefined, () => starting)).toEqual({
      hints: [],
      label: 'TypeScript',
      fallback: 'TypeScript is starting.',
    });
    const slow = standIn({ 'textDocument/inlayHint': { ok: false, why: 'deadline' } });
    expect(await servedHints(sides, file, undefined, slow.serverOf)).toEqual({
      hints: [],
      label: 'TypeScript',
      fallback: "TypeScript didn't answer in time.",
    });
    expect(await servedHints(sides, file, undefined, () => undefined)).toEqual({ hints: [] });
  });
});

describe('reading what a server says', () => {
  it('takes locations and links, drops what’s malformed, and stops at the limit', () => {
    const place = at('a.ts', 1, 2);
    const link = {
      targetUri: place.uri,
      targetRange: place.range,
      targetSelectionRange: place.range,
    };
    expect(locationsOf([place, link, { uri: 3 }, place], 3)).toEqual([
      { uri: place.uri, line: 0, character: 2 },
      { uri: place.uri, line: 0, character: 2 },
    ]);
    expect(locationsOf(place, 10)).toHaveLength(1);
    expect(locationsOf(null, 10)).toEqual([]);
    expect(locationsOf([{ nothing: true }], 10)).toBeUndefined();
  });

  it('reads hovers in each of the protocol’s shapes', () => {
    expect(hoverText({ contents: { kind: 'plaintext', value: 'a' } })).toEqual({
      text: 'a',
      markdown: false,
    });
    expect(hoverText({ contents: ['a', { language: 'ts', value: 'x ``` y' }] })).toEqual({
      text: 'a\n\n````ts\nx ``` y\n````',
      markdown: true,
    });
    expect(hoverText({ nothing: 1 })).toBeUndefined();
  });

  it('keeps hints to their lines and drops control characters', () => {
    expect(
      hintsOf(
        [{ position: { line: 0, character: 1 }, label: [{ value: 'a\u001b' }, { value: 'b' }] }],
        1,
        1,
      ),
    ).toEqual([{ line: 1, column: 1, label: 'ab' }]);
  });

  it('reads deeply nested symbols without recursion, keeping what’s at most 32 deep', () => {
    const range = at('x', 1, 0).range;
    let node: Record<string, unknown> = { name: 'leaf', kind: 13, range, selectionRange: range };
    for (let depth = 0; depth < 10_000; depth += 1) {
      node = { name: `n${depth}`, kind: 5, range, selectionRange: range, children: [node] };
    }
    const found = outlineOf([node]);
    expect(found?.symbols).toHaveLength(33);
  });
});
