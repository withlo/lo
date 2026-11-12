// The overview's jobs in the background process: reading `artifact.md`, and checking the overview
// against what main read of its commit and its code. The window sends them what main read, as it
// does the diff's texts, and keeps what comes back. The check takes nothing the window worked out:
// it reads `artifact.md` again, rather than take a parse, and answers its readers only from what
// main read. Nothing here calls Node or Electron, or loads `@lo/artifact`, which the window
// doesn't bundle.

import type { CheckedArtifact, CodeReference, ParsedArtifact, TreeEntry } from '@lo/artifact';
import { z } from 'zod';

import { reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';
import { oid } from '../tab/contract.ts';
import { CODE_LIMIT, entry, PATH_LIMIT, type Entry } from './contract.ts';

/**
 * The most bytes of `artifact.md` the checks read, its limit and a byte-order mark: `@lo/artifact`'s
 * `ARTIFACT_READ`. A larger one is too large, and isn't read.
 */
export const ARTIFACT_BYTES = 256 * 1024 + 3;

/**
 * The most bytes of a file the checks read: `@lo/artifact`'s `SIZE_ONLY`. A larger file comes with
 * its size alone.
 */
export const FILE_BYTES = 10 * 1024 * 1024;

/** How much of a figure the checks read first: `@lo/artifact`'s `FIGURE_HEAD`. */
export const FIGURE_HEAD = 4 * 1024;

/** The most bytes in an SVG figure, which the checks read whole: `@lo/artifact`'s `LIMITS.svg`. */
export const SVG_BYTES = 512 * 1024;

/** The most figures an overview shows: `@lo/artifact`'s `LIMITS.figures`. */
export const FIGURES_LIMIT = 100;

/**
 * The most files and folders main lists of an overview's commit: one past `@lo/artifact`'s
 * `LIMITS.entries`, and `artifact.md` wherever it is.
 */
export const ENTRIES_LIMIT = 500 + 2;

/** Bytes, at most `limit` of them. */
const byteArray = (limit: number) =>
  z.custom<Uint8Array>(
    (value) => value instanceof Uint8Array && value.length <= limit,
    `bytes, at most ${limit} of them`,
  );

/** A path an overview names: a target's, or a figure's. */
const namedPath = z.string().min(1).max(PATH_LIMIT);

/** A file of the overview's commit, as main's `files` answers it. */
const overviewFile = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('file'),
    size: z.number().int().nonnegative(),
    bytes: byteArray(FILE_BYTES).nullable(),
  }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('notFile'), is: z.enum(['link', 'folder', 'submodule']) }),
  z.strictObject({ kind: z.literal('refused') }),
  z.strictObject({ kind: z.literal('unread'), why: z.string() }),
]);

/** A file the overview's code names, as main's `code` answers it. */
const codeAnswer = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('file'),
    size: z.number().int().nonnegative().nullable(),
    bytes: byteArray(FILE_BYTES),
  }),
  z.strictObject({ kind: z.literal('tooLarge') }),
  z.strictObject({ kind: z.literal('missing') }),
  z.strictObject({ kind: z.literal('notFile'), is: z.enum(['link', 'folder', 'submodule']) }),
  z.strictObject({ kind: z.literal('noCommit') }),
  z.strictObject({ kind: z.literal('unread'), why: z.string() }),
]);

/** What `overview.check` takes. */
export const checkInput = z.strictObject({
  /** `artifact.md` as main read it, whole; null when it wasn't read. */
  artifact: byteArray(ARTIFACT_BYTES).nullable(),
  /** The overview's commit: its files and folders, as main listed them. */
  entries: z.array(entry).max(ENTRIES_LIMIT),
  /** The pull request whose ref holds the overview. */
  pr: z.number().int().positive(),
  /** Its figures, by path, as main's `files` answered them. */
  figures: z.array(z.strictObject({ path: namedPath, file: overviewFile })).max(FIGURES_LIMIT),
  /**
   * Its code, by path, as main's `code` answered it, at the commit main read it at; null when
   * main hasn't read it.
   */
  code: z
    .strictObject({
      commit: oid,
      files: z.array(z.strictObject({ path: namedPath, answer: codeAnswer })).max(CODE_LIMIT),
    })
    .nullable(),
});
export type CheckInput = z.output<typeof checkInput>;

/** A file an overview's code names, and whether it names its lines, as main's `code` reads it. */
export interface CodeFile {
  path: string;
  lines: boolean;
}

/**
 * What reading `artifact.md` found: the parse, and what main reads for the checks: the files its
 * code names, each once, in the order the overview first names it, as the checks read them; and
 * its figures, each once, in the order it first shows them.
 */
export interface Parsed {
  parsed: ParsedArtifact;
  code: CodeFile[];
  figures: string[];
}

export const contract = defineJobs('overview', {
  /** Reads `artifact.md`, as main read it, whole. */
  parse: {
    input: z.strictObject({ artifact: byteArray(ARTIFACT_BYTES) }),
    reply: reply<Parsed>(),
  },
  /**
   * Checks an overview: reads `artifact.md` again and checks it against what main read of its
   * commit and its code. Each figure's and code block's state follows the parse's order: the
   * outcome's code is the parse's `references`, and its figures its `figures`, one for one.
   */
  check: {
    input: checkInput,
    reply: reply<CheckedArtifact>(),
  },
});

/**
 * The files `references` name, as the checks read them: each once, in the order of the line that
 * first names it, with whether any names its lines.
 */
export function codeFiles(references: readonly CodeReference[]): CodeFile[] {
  const files = new Map<string, CodeFile>();
  for (const { target } of references) {
    const known = files.get(target.path);
    if (known) known.lines ||= target.lines !== undefined;
    else files.set(target.path, { path: target.path, lines: target.lines !== undefined });
  }
  return [...files.values()];
}

/** What GitHub writes in place of bytes of a path that aren't UTF-8. */
const REPLACEMENT = '�';

/**
 * The bytes of `path`, a path as GitHub's listing writes it, as the commit stores it as far as
 * can be told: its UTF-8, with a byte that's never UTF-8 for each U+FFFD, which GitHub writes for
 * bytes that weren't. Such a path isn't UTF-8 to the checks, as it isn't in the commit.
 */
export function pathBytes(path: string): Uint8Array {
  if (!path.includes(REPLACEMENT)) return new TextEncoder().encode(path);
  const encoder = new TextEncoder();
  const parts = path.split(REPLACEMENT).map((part) => encoder.encode(part));
  const bytes = new Uint8Array(
    parts.reduce((sum, part) => sum + part.length, 0) + parts.length - 1,
  );
  let at = 0;
  for (const [index, part] of parts.entries()) {
    if (index > 0) bytes[at++] = 0xff;
    bytes.set(part, at);
    at += part.length;
  }
  return bytes;
}

/** `entries` as the overview's checks take a commit's. */
export function treeEntries(entries: readonly Entry[]): TreeEntry[] {
  return entries.map(({ path, kind, size }): TreeEntry => {
    const bytes = pathBytes(path);
    // A file or link GitHub gives no size for has none: the checks refuse such a commit.
    if (kind === 'file' || kind === 'link') return { path: bytes, kind, size: size ?? Number.NaN };
    return { path: bytes, kind };
  });
}
