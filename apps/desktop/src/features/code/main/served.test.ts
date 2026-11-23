// Which answers win: a ready server's within its deadline, alone, on the new side; the syntax
// index's, saying why, when the server is starting, slow or stopped; the asking file's import and
// then the index's when the server found nothing; the index's always on the old side, and for a
// file whose checkout isn't the head's blob. Places outside the checkout are never read. The server
// here stands in, answering what each test says.

import type { Answer, Method } from '@lo/lsp';
import { markdownTree } from '@lo/markdown';
import { describe, expect, it, onTestFinished, vi } from 'vitest';

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
 * A ready server that answers each method as `answers` says, or as it says for what's asked,
 * noting what it's asked and with what, and offering type hints unless `hints` says otherwise. It
 * finds references only from a declaration when `options` says so, and reads each file as the
 * language `options.languages` gives its path, `typescript` for any other.
 */
function standIn(
  answers: Partial<Record<Method, Answer | ((given: unknown) => Answer)>>,
  matches: Awaited<ReturnType<Serving['matches']>> = true,
  hints: { offered?: boolean; none?: string } = {},
  options: {
    referencesFromDefinition?: boolean;
    noReferences?: string;
    languages?: Readonly<Record<string, string | undefined>>;
  } = {},
) {
  const asked: Method[] = [];
  const params: unknown[] = [];
  const deadlines: number[] = [];
  const opened: string[] = [];
  const openedAs: string[] = [];
  const { languages = {} } = options;
  const serving: Serving = {
    kind: 'ready',
    name: 'TypeScript',
    languageOf: (path) => (Object.hasOwn(languages, path) ? languages[path] : 'typescript'),
    noHints: hints.none,
    referencesFromDefinition: options.referencesFromDefinition,
    noReferences: options.noReferences,
    server: {
      capabilities: { hoverProvider: true, inlayHintProvider: hints.offered ?? true },
      open(path, languageId) {
        opened.push(path);
        openedAs.push(`${path} ${languageId}`);
        return true;
      },
      request(method, given, { deadline }): Promise<Answer> {
        asked.push(method);
        params.push(given);
        deadlines.push(deadline);
        const answer: Answer | ((asked: unknown) => Answer) | undefined = answers[method];
        if (typeof answer === 'function') return Promise.resolve(answer(given));
        return Promise.resolve(answer ?? { ok: true, value: null });
      },
      pathOf: (uri) =>
        uri.startsWith(`${CHECKOUT}/`) ? uri.slice(CHECKOUT.length + 1) : undefined,
    },
    matches: () => Promise.resolve(matches),
  };
  return { serving, asked, params, deadlines, opened, openedAs, serverOf: () => serving };
}

/** A place in a location's answer, at line `line` (from 1) and `column` of `path`. */
/** Asked for the server of a file, finds `serving`, which can't answer. */
function not(serving: NotServing): () => NotServing {
  return () => serving;
}

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

  it('answers from the index, saying why, when the server is starting, waiting, refused, slow, failed or stopped', async () => {
    const { sides, answering } = await view();
    const name = 'TypeScript';
    const why = 'The checkout’s tsconfig.json names a plugin, so Lo won’t run vtsls on it.';
    const slow = standIn({ 'textDocument/definition': { ok: false, why: 'deadline' } });
    const cases = [
      [not({ kind: 'starting', name }), 'TypeScript is starting.'],
      [
        not({ kind: 'waiting', name, count: 4 }),
        'TypeScript is waiting to start. Lo runs 4 language servers at once at most.',
      ],
      [not({ kind: 'refused', name, why }), why],
      [
        not({ kind: 'missing', name, needs: 'Go 1.24 or newer' }),
        'TypeScript needs Go 1.24 or newer.',
      ],
      [not({ kind: 'failed', name }), 'TypeScript failed. Restart it from the status bar.'],
      [not({ kind: 'stopped', name }), 'TypeScript stopped.'],
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

  it('answers from the index, saying why, when the server’s checkout isn’t usable', async () => {
    const { sides, answering } = await view();
    const notes: (string | undefined)[] = [];
    for (const matches of ['remaking', 'unusable'] as const) {
      const server = standIn(
        { 'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] } },
        matches,
      );
      const found = await servedDefinitions(
        answering,
        sides,
        PARSE_CALL,
        undefined,
        server.serverOf,
      );
      expect(found.answers[0]).toMatchObject({ source: 'syntax', path: 'src/parse.ts' });
      expect(server.asked).toEqual([]);
      notes.push(found.fallback);
    }
    expect(notes).toEqual([
      "TypeScript can't run: this PR's checkout isn't usable. Lo is making it again.",
      "TypeScript can't run: this PR's checkout isn't usable.",
    ]);
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
    expect(none.fallback).toBeUndefined();
  });

  it('says it took too long when its Markdown isn’t read in time', async () => {
    const { sides, answering } = await view(() =>
      Promise.reject(new IpcError('unanswered', 'The background process didn’t answer in time.')),
    );
    const { serverOf } = standIn({
      'textDocument/hover': { ok: true, value: { contents: { kind: 'markdown', value: '**x**' } } },
    });
    const hovered = await servedHover(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(hovered).toMatchObject({
      source: 'syntax',
      fallback: "Lo took too long to read TypeScript's hover.",
    });
  });

  it('says why a server didn’t answer when the index knows nothing of the name either', async () => {
    const { sides, answering } = await view();
    const join = { ...PARSE_CALL, column: FORMAT.split('\n')[1]?.indexOf('join') ?? 0 };
    const starting: NotServing = { kind: 'starting', name: 'TypeScript' };
    expect(await servedHover(answering, sides, join, undefined, () => starting)).toEqual({
      none: true,
      fallback: 'TypeScript is starting.',
    });
    // No server reads the file, so there's nothing to say why.
    expect(await servedHover(answering, sides, join, undefined, () => undefined)).toEqual({
      none: true,
    });
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
    const { serverOf, params } = standIn({
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
    expect(params.at(-1)).toMatchObject({ range: { end: { line: 2, character: 0 } } });
    // Lines to the file's last end where it does, never past it, where JDT LS would answer nothing.
    await servedHints(sides, { ...file, to: 3 }, undefined, serverOf);
    expect(params.at(-1)).toEqual({
      path: 'src/format.ts',
      range: { start: { line: 0, character: 0 }, end: { line: 2, character: 8 } },
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

/**
 * `parse`'s references as a server finding them only from a declaration answers them: asked in
 * src/parse.ts, which declares it, both places; asked anywhere else, none.
 */
function FOUND_AT_DECLARATION(given: unknown): Answer {
  return given !== null &&
    typeof given === 'object' &&
    'path' in given &&
    given.path === 'src/parse.ts'
    ? { ok: true, value: [at('src/parse.ts', 2, 16), at('src/format.ts', 2, 48)] }
    : { ok: true, value: [] };
}

describe('references from a definition', () => {
  /** A server that finds references only from a declaration, as terraform-ls does. */
  const FROM_DEFINITION = { referencesFromDefinition: true };

  /** `parse` where src/parse.ts declares it. */
  const PARSE_DECLARATION = { ...PARSE_CALL, path: 'src/parse.ts', column: 16 };

  it('takes what such a server finds where the reader is, as at a declaration', async () => {
    const { sides, answering } = await view();
    const { serverOf, asked, params } = standIn(
      {
        // As it may, it finds no definition at a declaration: it's never asked for one.
        'textDocument/definition': { ok: true, value: null },
        'textDocument/references': FOUND_AT_DECLARATION,
      },
      true,
      {},
      FROM_DEFINITION,
    );
    const references = await servedReferences(
      answering,
      sides,
      PARSE_DECLARATION,
      undefined,
      serverOf,
    );
    expect(asked).toEqual(['textDocument/references']);
    expect(params[0]).toEqual({
      path: 'src/parse.ts',
      position: { line: 1, character: 16 },
      context: { includeDeclaration: true },
    });
    expect(references.fallback).toBeUndefined();
    expect(references.answers.map((each) => `${each.path}:${each.line} ${each.label}`)).toEqual([
      'src/parse.ts:2 TypeScript',
      'src/format.ts:2 TypeScript',
    ]);
  });

  it('asks such a server finding none at a use for the definition, then for the references there', async () => {
    const { sides, answering } = await view();
    const { serverOf, asked, params, opened } = standIn(
      {
        'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] },
        'textDocument/references': FOUND_AT_DECLARATION,
      },
      true,
      {},
      FROM_DEFINITION,
    );
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(asked).toEqual([
      'textDocument/references',
      'textDocument/definition',
      'textDocument/references',
    ]);
    expect(params[0]).toMatchObject({ path: 'src/format.ts', position: { line: 1 } });
    expect(params[2]).toEqual({
      path: 'src/parse.ts',
      position: { line: 1, character: 16 },
      context: { includeDeclaration: true },
    });
    // The definition's file is open on the server, with its text from git, before it's asked.
    expect(opened).toContain('src/parse.ts');
    expect(references.fallback).toBeUndefined();
    expect(references.answers.map((each) => `${each.path}:${each.line} ${each.label}`)).toEqual([
      'src/parse.ts:2 TypeScript',
      'src/format.ts:2 TypeScript',
    ]);
  });

  it('takes its empty answer when the definition is where the reader is', async () => {
    const { sides, answering } = await view();
    const { serverOf, asked } = standIn(
      {
        'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] },
        'textDocument/references': { ok: true, value: [] },
      },
      true,
      {},
      FROM_DEFINITION,
    );
    const references = await servedReferences(
      answering,
      sides,
      PARSE_DECLARATION,
      undefined,
      serverOf,
    );
    expect(asked).toEqual(['textDocument/references', 'textDocument/definition']);
    expect(references).toMatchObject({ name: 'parse', answers: [] });
    expect(references.fallback).toBeUndefined();
  });

  it('opens each file on the server as its own language', async () => {
    const { sides, answering } = await view();
    // As a `.tfvars` file asking about the variable a `.tf` file declares.
    const { serverOf, openedAs } = standIn(
      {
        'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] },
        'textDocument/references': FOUND_AT_DECLARATION,
      },
      true,
      {},
      { ...FROM_DEFINITION, languages: { 'src/format.ts': 'typescript-vars' } },
    );
    await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(new Set(openedAs)).toEqual(
      new Set(['src/format.ts typescript-vars', 'src/parse.ts typescript']),
    );
  });

  it('says it found no references there, with no definition to go through, as at a declaration nothing uses', async () => {
    const { sides, answering } = await view();
    for (const definition of [
      { ok: true, value: null },
      { ok: true, value: [] },
    ] as const) {
      const { serverOf, asked } = standIn(
        {
          'textDocument/definition': definition,
          'textDocument/references': { ok: true, value: [] },
        },
        true,
        {},
        FROM_DEFINITION,
      );
      const references = await servedReferences(
        answering,
        sides,
        PARSE_DECLARATION,
        undefined,
        serverOf,
      );
      expect(asked).toEqual(['textDocument/references', 'textDocument/definition']);
      expect(references.fallback).toBe('TypeScript found no references there.');
      expect(references.answers.length).toBeGreaterThan(0);
      expect(references.answers.every((each) => each.source === 'syntax')).toBe(true);
    }
  });

  it('asks everything within one deadline, a single question’s, and lets the index answer once it passes', async () => {
    const { sides, answering } = await view();
    vi.useFakeTimers({ toFake: ['performance'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { serverOf, asked, deadlines } = standIn(
      {
        'textDocument/references': (given) => {
          vi.advanceTimersByTime(9_000);
          return FOUND_AT_DECLARATION(given);
        },
        'textDocument/definition': () => {
          vi.advanceTimersByTime(1_000);
          return { ok: true, value: [at('src/parse.ts', 2, 16)] };
        },
      },
      true,
      {},
      FROM_DEFINITION,
    );
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    // The definition has what's left, and nothing's left to ask for the references there.
    expect(asked).toEqual(['textDocument/references', 'textDocument/definition']);
    expect(deadlines).toEqual([10_000, 1_000]);
    expect(references.fallback).toBe("TypeScript didn't answer in time.");
    expect(references.answers.length).toBeGreaterThan(0);
    expect(references.answers.every((each) => each.source === 'syntax')).toBe(true);
  });

  it('lets the index answer, saying why, when its definition is out of reach', async () => {
    const { sides, answering } = await view();
    for (const [definition, why] of [
      [
        { ok: true, value: [{ uri: 'jdt://x', range: at('x', 1, 0).range }] },
        'TypeScript found its definition outside the repository.',
      ],
      [
        { ok: true, value: [at('build/out.ts', 1, 0)] },
        'TypeScript found its definition outside the repository.',
      ],
      [{ ok: false, why: 'deadline' }, "TypeScript didn't answer in time."],
    ] as const) {
      const { serverOf, asked } = standIn(
        {
          'textDocument/definition': definition,
          'textDocument/references': { ok: true, value: [] },
        },
        true,
        {},
        FROM_DEFINITION,
      );
      const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
      expect(asked).toEqual(['textDocument/references', 'textDocument/definition']);
      expect(references.fallback).toBe(why);
      expect(references.answers.length).toBeGreaterThan(0);
      expect(references.answers.every((each) => each.source === 'syntax')).toBe(true);
    }
    // A definition in a file of the repository it doesn't read, which it's never asked about.
    const { serverOf, opened } = standIn(
      { 'textDocument/definition': { ok: true, value: [at('src/parse.ts', 2, 16)] } },
      true,
      {},
      { ...FROM_DEFINITION, languages: { 'src/parse.ts': undefined } },
    );
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(opened).not.toContain('src/parse.ts');
    expect(references.fallback).toBe("TypeScript found its definition in a file it doesn't read.");
  });

  it('takes any other server’s empty references as its answer, asked where the reader is', async () => {
    const { sides, answering } = await view();
    const { serverOf, asked, params } = standIn({
      'textDocument/references': { ok: true, value: [] },
    });
    const references = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(asked).toEqual(['textDocument/references']);
    expect(params[0]).toMatchObject({ path: 'src/format.ts', position: { line: 1 } });
    expect(references).toMatchObject({ name: 'parse', answers: [] });
    expect(references.fallback).toBeUndefined();
  });
});

describe('references from the index alone', () => {
  it('never asks a server that finds none Lo can use, and says why', async () => {
    const { sides, answering } = await view();
    const why = 'SourceKit-LSP finds references only from a build, which Lo never runs.';
    const { serverOf, asked } = standIn(
      { 'textDocument/references': { ok: true, value: [at('src/parse.ts', 2, 16)] } },
      true,
      {},
      { noReferences: why },
    );
    const found = await servedReferences(answering, sides, PARSE_CALL, undefined, serverOf);
    expect(asked).toEqual([]);
    expect(found.fallback).toBe(why);
    expect(found.answers.length).toBeGreaterThan(0);
    expect(found.answers.every((each) => 'outside' in each || each.source === 'syntax')).toBe(true);
  });
});

describe('type hints', () => {
  const file = { view: 'v1', key: head, path: 'src/format.ts', from: 1, to: 2 };

  it('asks a server with no type hints for none, and says why', async () => {
    const { sides } = await view();
    const unoffered = standIn({}, true, { offered: false });
    expect(await servedHints(sides, file, undefined, unoffered.serverOf)).toEqual({
      hints: [],
      label: 'TypeScript',
      none: 'TypeScript has no type hints.',
    });
    // Its adapter's word comes first, as for a paid feature the server would refuse.
    const paid = standIn({}, true, { none: 'Its free version has no type hints.' });
    expect(await servedHints(sides, file, undefined, paid.serverOf)).toEqual({
      hints: [],
      label: 'TypeScript',
      none: 'Its free version has no type hints.',
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
