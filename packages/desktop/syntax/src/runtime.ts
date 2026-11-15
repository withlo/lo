// The tree-sitter runtime a worker thread parses in, which highlighting and tagging share: one
// WebAssembly memory, capped, a count of the parses a grammar's scanner has aborted, and whether
// a fault has left the memory broken. What stops one of the thread's highlighters and taggers
// stops them all.

import { Parser, type ParseOptions, type Tree } from 'web-tree-sitter';

/** The part of WebAssembly's API this needs, which the background process's types leave out. */
declare const WebAssembly: {
  Memory: new (descriptor: { initial: number; maximum: number }) => {
    readonly buffer: ArrayBuffer;
  };
  RuntimeError: ErrorConstructor;
};

/** WebAssembly memory past which a thread's highlighters and taggers should be replaced. */
export const memoryCeiling = 256 * 1024 * 1024;

/**
 * The one WebAssembly memory every parser in this thread parses in, capped at 512 MB, so a parse
 * that runs away fails instead of taking the machine's memory. It never shrinks.
 */
const memory = new WebAssembly.Memory({ initial: 512, maximum: 8192 });

let initialized: Promise<void> | undefined;

/** Starts tree-sitter in this thread, once. */
export function startTreeSitter(): Promise<void> {
  initialized ??= Parser.init({ wasmMemory: memory });
  return initialized;
}

/** How many bytes of WebAssembly memory the thread's parsers hold. */
export function memoryInUse(): number {
  return memory.buffer.byteLength;
}

/**
 * A parse a grammar's scanner stopped: it called `abort()`, as Kotlin's does when strings nest past
 * its limit, or an assertion of its failed. tree-sitter's runtime has neither function, so the
 * call throws. Unlike a fault, it stops the parse at a known place and leaves memory whole, so
 * only its text fails.
 */
export class Aborted extends Error {}

/**
 * How many parses have aborted in this thread. An abort unwinds without giving back the stack the
 * calls into WebAssembly had taken: Kotlin's keeps 0.9 KB of the thread's 64 KB, so its stack runs
 * out after about 75. Past `maxAborts`, the thread's parsers aren't usable.
 */
let aborts = 0;
const maxAborts = 8;

/** Counts a parse that aborted. */
export function countAbort(): void {
  aborts++;
}

/**
 * Whether a parse or query has failed in a way that can leave the memory broken: a fault, the
 * stack running out, or anything else but a scanner's abort.
 */
let broken = false;

/** Marks the thread's memory broken, after which nothing more parses in it. */
export function breakRuntime(): void {
  broken = true;
}

/**
 * Whether the thread can parse again: its memory isn't broken, its scanners haven't aborted too
 * often, and the memory is under the ceiling. Once it can't, it never can, and the thread should
 * be replaced.
 */
export function runtimeUsable(): boolean {
  return !broken && aborts < maxAborts && memoryInUse() <= memoryCeiling;
}

/**
 * Parses `text` with `parser`, which is reset after. A scanner's abort throws `Aborted`; a fault,
 * or the stack running out, throws as it came, and can leave the memory broken.
 */
export function parseText(parser: Parser, text: string, options: ParseOptions): Tree | null {
  try {
    return parser.parse(text, null, options);
  } catch (error) {
    // A fault, or the stack running out, is a `RuntimeError` or a `RangeError`. Anything else
    // was thrown by a call out of WebAssembly, as a scanner's abort is.
    if (error instanceof WebAssembly.RuntimeError || error instanceof RangeError) throw error;
    throw new Aborted('A scanner aborted.', { cause: error });
  } finally {
    parser.reset();
  }
}
