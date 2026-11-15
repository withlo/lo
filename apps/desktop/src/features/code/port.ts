// The code port: what the window asks main of a file's code, over a port main hands it with each
// load of the page, in the jobs protocol's shapes (`{ id, job, input }`, replies, `{ cancel }`).
// Main checks every message and input as the background process does, answers only about an open
// view, a tree that view shows and a line that file has, and caps each reply. Every answer comes
// from the syntax index, which has no type hints, so `hints` answers none.

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
/** The longest a hover's text may be, in UTF-16 code units. */
export const MAX_HOVER = 64 * 1024;
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
  /** What says where it came from: "Syntax index · same name". */
  label: string;
  /** Whether the pull request changes its file. */
  changed: boolean;
  /** The lines around it, for the first {@link SNIPPETS} answers. */
  lines?: Lines;
}

/**
 * A name's definitions, best first: `name` is the word at the place asked, `null` when there's
 * none; `more` when there were more than are listed.
 */
export interface Definitions {
  name: string | null;
  answers: CodeAnswer[];
  more: boolean;
}

/** Where a name is used, by name alone, with what says so. */
export interface References {
  name: string | null;
  answers: CodeAnswer[];
  more: boolean;
  /** "By name: may include other things called this." */
  note: string;
}

/** What the hover card shows: the name's top definition's line, its kind and where it is. */
export interface Hover {
  name: string;
  kind: DefinitionKind | undefined;
  text: string;
  source: 'server' | 'syntax';
  label: string;
  at: CodeAnswer;
}

/** An inlay hint: a label after a place. */
export interface Hint {
  line: number;
  column: number;
  label: string;
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
}

export const contract = defineJobs('code', {
  /** The definitions of the name at a place, ranked as `@lo/syntax` ranks them. */
  definitions: { input: place, reply: reply<Definitions>() },
  /** Where the name at a place is used, in files of the same tree. */
  references: { input: place, reply: reply<References>() },
  /** What the hover card says of the name at a place, or nothing. */
  hover: { input: place, reply: reply<Hover | null>() },
  /** Type hints for lines `from` to `to`: none without a language server. */
  hints: {
    input: z.strictObject({ ...file, from: line, to: line }),
    reply: reply<Hint[]>(),
  },
  /** A file's symbols, nested. */
  outline: { input: z.strictObject(file), reply: reply<Outline>() },
  /** The lines around line `line` of a file, as an answer past the first few comes without. */
  snippet: { input: z.strictObject({ ...file, line }), reply: reply<Lines>() },
});
