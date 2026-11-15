// The syntax index's jobs in the background process, which only main sends, over its own port and
// behind the window's jobs: each file's definitions, the names it refers to and its imports, read
// with tree-sitter's tags (`symbols`); and where files use a name (`find`). Main reads the files'
// blobs from the local copy and sends their bytes; the process reads nothing itself.

import { z } from 'zod';

import { reply } from '../../ipc/contract.ts';
import { defineJobs } from '../../ipc/jobs.ts';

/** The most files one job reads. */
export const FILES_PER_JOB = 500;

/** The most bytes of files one job reads, all its files together. */
export const BYTES_PER_JOB = 4 * 1024 * 1024;

/** The largest file the index reads, in bytes. */
export const FILE_BYTES = 1024 * 1024;

/** The most files the index reads of one tree. */
export const TREE_FILES = 20_000;

/** The most bytes the index downloads for one tree. */
export const TREE_BYTES = 200 * 1024 * 1024;

/** A file to read: the language it's read as, by `@lo/syntax`'s name, and its bytes, UTF-8. */
export const fileJob = z.strictObject({
  language: z
    .string()
    .regex(/^[a-z]+$/)
    .max(32),
  bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.byteLength <= FILE_BYTES),
});
export type FileJob = z.output<typeof fileJob>;

/** What a definition is, as `@lo/syntax`'s tags name it. */
export type DefinitionKind =
  | 'class'
  | 'constant'
  | 'enum'
  | 'field'
  | 'function'
  | 'interface'
  | 'macro'
  | 'method'
  | 'module'
  | 'property'
  | 'type'
  | 'variable';

/** A definition in a file, as `@lo/syntax` reads it: where its name is, and what holds it. */
export interface Definition {
  name: string;
  kind: DefinitionKind;
  /** From 1. */
  line: number;
  /** From 0, in UTF-16 code units. */
  column: number;
  /** The whole definition's last line, from 1. */
  lastLine: number;
  /** The definition it's inside, by its place in the file's list. */
  parent?: number;
}

/** An import, as `@lo/syntax` reads it. */
export interface Import {
  line: number;
  module: string;
  names: readonly { name: string; as?: string }[] | 'all';
}

/** What the index keeps of a file. */
export interface FileSymbols {
  definitions: Definition[];
  /** The names it refers to, each once. */
  references: string[];
  imports: Import[];
  namespace?: string;
}

/**
 * Why a file wasn't read: `@lo/syntax`'s reasons, or `language` for one it has no tags for, or
 * `text` for bytes that aren't UTF-8.
 */
export type Skip =
  | 'too-long'
  | 'binary'
  | 'minified'
  | 'too-deep'
  | 'too-many'
  | 'timed-out'
  | 'out-of-memory'
  | 'failed'
  | 'language'
  | 'text';

/**
 * What a job says of each file, in the order given: what it read, why it skipped it, or `null` when
 * it didn't get to it, as once its reader stopped being usable, so main sends it again in a new job.
 * The first file of a job is always read or skipped.
 */
export type Tagged = { symbols: FileSymbols } | { skipped: Skip } | null;

/** Where a file uses a name, or why it wasn't read; `null` as for {@link Tagged}. */
export type Uses = { uses: { line: number; column: number }[] } | { skipped: Skip } | null;

export const contract = defineJobs('code', {
  /**
   * Reads files' symbols. `version` stamps what read them: the grammars and queries the index
   * reads with, so a change to either makes the index read its files again. With no files, it only
   * says the version.
   */
  symbols: {
    input: z.strictObject({ files: z.array(fileJob).max(FILES_PER_JOB) }),
    reply: reply<{ version: string; files: Tagged[] }>(),
  },
  /** Finds where files use `name`, as the names they refer to count them. */
  find: {
    input: z.strictObject({
      name: z.string().min(1).max(256),
      files: z.array(fileJob).min(1).max(FILES_PER_JOB),
    }),
    reply: reply<Uses[]>(),
  },
});
