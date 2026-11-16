// The code port: what the window asks main of a file's code, over a port main hands it with each
// load of the page, in the jobs protocol's shapes (`{ id, job, input }`, replies, `{ cancel }`).
// Main checks every message and input as the background process does, answers only about an open
// view, a tree that view shows and a line that file has, and caps each reply. On the new side of a
// view the reader trusts, a language server's answer within its deadline wins; otherwise, and
// always on the old side, the syntax index answers, saying why when a server didn't.

import type { Tree } from '@lo/markdown';
import { z } from 'zod';

import { reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';
import { oid, tabId } from '../tab/contract.ts';
import type { DefinitionKind } from './jobs.ts';

/** The most definitions an answer lists. */
export const MAX_DEFINITIONS = 100;
/** The most references an answer lists. */
export const MAX_REFERENCES = 5_000;
/** The most files references are looked for in. */
export const MAX_REFERENCE_FILES = 2_000;
/** The most type hints an answer holds. */
export const MAX_HINTS = 2_000;
/** The most symbols an outline lists. */
export const MAX_SYMBOLS = 5_000;
// The longest a hover's text may be, which `code.render` reads too.
export { MAX_HOVER } from './jobs.ts';
/** How many answers come with the lines around them. */
export const SNIPPETS = 10;
/** How many lines around an answer it comes with. */
export const SNIPPET_LINES = 30;
/** The longest line a snippet holds, in UTF-16 code units; a longer one is cut. */
export const SNIPPET_LINE = 2_000;

/** A file of a view: the view, the commit of the side it's on (its tree's key), and its path. */
const file = {
  view: tabId,
  key: oid,
  path: z.string().min(1).max(4096),
};

const line = z.number().int().min(1).max(100_000_000);

/** A place in a file: its line, from 1, and its column, from 0 in UTF-16 code units. */
const place = z.strictObject({ ...file, line, column: z.number().int().min(0).max(100_000_000) });
export type Place = z.output<typeof place>;

/** Lines of a file, from line `from`. */
export interface Lines {
  from: number;
  text: string[];
}

/** One answer: a place somewhere in the view's tree, what found it, and what's around it. */
export interface CodeAnswer {
  /** The tree's key, as asked, and which side of the view it's on. */
  key: string;
  side: 'old' | 'new';
  path: string;
  /** From 1. */
  line: number;
  /** From 0, in UTF-16 code units. */
  column: number;
  /** The name it's for. */
  name: string;
  /** What's defined there, for a definition. */
  kind?: DefinitionKind;
  source: 'server' | 'syntax';
  /** What says where it came from: "TypeScript", "Syntax index · same name". */
  label: string;
  /** Whether the pull request changes its file. */
  changed: boolean;
  /** The lines around it, for the first {@link SNIPPETS} answers. */
  lines?: Lines;
  /**
   * The module the name is imported from, when this is the asking file's import of it, shown
   * because the language server found nothing in the repository: "zod".
   */
  from?: string;
}

/**
 * An answer a language server gave outside the repository, such as a toolchain's own sources or a
 * `jdt://` address. Lo never reads one, and names no file for it.
 */
export interface OutsideAnswer {
  outside: true;
  name: string;
  source: 'server';
  label: string;
}

/**
 * A name's definitions, best first: `name` is the word at the place asked, `null` when there's
 * none; `more` when there were more than are listed. A language server's come alone; the syntax
 * index's come with `fallback` saying why the server didn't answer, when one could have: "TypeScript
 * is starting."
 */
export interface Definitions {
  name: string | null;
  answers: (CodeAnswer | OutsideAnswer)[];
  more: boolean;
  fallback?: string;
}

/**
 * Where a name is used: a language server's answer, or the syntax index's, by name alone, with
 * `note` saying so. `outside` counts the uses a server found outside the repository, which aren't
 * listed.
 */
export interface References {
  name: string | null;
  answers: CodeAnswer[];
  more: boolean;
  /** "By name: may include other things called this." */
  note?: string;
  outside?: number;
  fallback?: string;
}

/**
 * What the hover card shows: a language server's hover, as Markdown, or its plain text; or the
 * name's top definition's line from the syntax index, with its kind and where it is.
 */
export interface Hover {
  name: string;
  kind: DefinitionKind | undefined;
  text: string;
  /** Whether `text` is Markdown, as a server's hover is, rather than a line of code or plain text. */
  markdown: boolean;
  /**
   * A server's Markdown as Lo's tree, which the background process reads by `@lo/markdown`'s rules
   * for text from anyone (`code.render`): what the card draws, never `text` itself. Every hover in
   * Markdown has one.
   */
  tree?: Tree;
  source: 'server' | 'syntax';
  label: string;
  at?: CodeAnswer;
  fallback?: string;
}

/**
 * No hover for the name at a place: nothing's known of it, with why a language server didn't
 * answer, when one could have: "TypeScript is starting."
 */
export interface NoHover {
  none: true;
  fallback?: string;
}

/** An inlay hint: a label after a place, with a space before or after it where it asks. */
export interface Hint {
  line: number;
  column: number;
  label: string;
  paddingLeft?: boolean;
  paddingRight?: boolean;
}

/**
 * A file's type hints, from the language server that reads it: none without one, on the old side,
 * or when it gave none.
 */
export interface Hints {
  hints: Hint[];
  /** The server that reads the file, by name, when one does: "TypeScript". */
  label?: string;
  /** Why it gave none, when it could have: "TypeScript is starting." */
  fallback?: string;
  /**
   * Why it never gives any, so Lo didn't ask: it doesn't offer them ("Python has no type
   * hints."), or its adapter says it has none to give Lo.
   */
  none?: string;
}

/** A symbol of a file's outline, nested by `parent`, its place in the list. */
export interface OutlineSymbol {
  name: string;
  kind: DefinitionKind;
  line: number;
  column: number;
  lastLine: number;
  parent?: number;
}

export interface Outline {
  symbols: OutlineSymbol[];
  more: boolean;
  source: 'server' | 'syntax';
  /** The server's name, for a server's outline. */
  label?: string;
  fallback?: string;
}

export const contract = defineJobs('code', {
  /** The definitions of the name at a place: a server's, or ranked as `@lo/syntax` ranks them. */
  definitions: { input: place, reply: reply<Definitions>() },
  /** Where the name at a place is used, in files of the same tree. */
  references: { input: place, reply: reply<References>() },
  /** What the hover card says of the name at a place, or that there's nothing, and why. */
  hover: { input: place, reply: reply<Hover | NoHover>() },
  /** A language server's type hints for lines `from` to `to`, or why there are none. */
  hints: {
    input: z.strictObject({ ...file, from: line, to: line }),
    reply: reply<Hints>(),
  },
  /** A file's symbols, nested. */
  outline: { input: z.strictObject(file), reply: reply<Outline>() },
  /** The lines around line `line` of a file, as an answer past the first few comes without. */
  snippet: { input: z.strictObject({ ...file, line }), reply: reply<Lines>() },
});
