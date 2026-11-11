/** Helpers for writing overviews in tests and reading what the parse made of them. */

import type { Block, Inline } from '@lo/markdown';

import type { Finding, Overview, ParsedArtifact } from '../src/index.ts';
import { isRecord } from './walker.ts';

export const COMMIT = '3f9c2e1d8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e';

/** A header for pull request 4797, five lines long. */
export const HEADER = `---\nformat: 1\npr: 4797\ncommit: ${COMMIT}\n---\n`;

/** The lines the header and the tl;dr {@link overview} adds take. */
export const PREAMBLE_LINES = 10;

/** `body` after a header and a tl;dr, so it starts on line {@link PREAMBLE_LINES} + 1. */
export function overview(body: string): string {
  return `${HEADER}\n## tl;dr\n\nIt changes things.\n\n${body}`;
}

/** The findings, as `code@line`, for comparing at a glance. */
export function found(parsed: ParsedArtifact): string[] {
  return parsed.findings.map(({ code, line }) => (line === undefined ? code : `${code}@${line}`));
}

/** The errors' codes. */
export function errors(parsed: ParsedArtifact): Finding['code'][] {
  return parsed.findings.filter((finding) => finding.severity === 'error').map(({ code }) => code);
}

type Node = Block<Overview> | Inline<Overview>;

function isKind<K extends string>(value: unknown, kind: K): value is Extract<Node, { kind: K }> {
  return isRecord(value) && value['kind'] === kind;
}

/** Every node in `parsed`'s tree of kind `kind`, in document order. */
export function collect<K extends Node['kind']>(
  parsed: ParsedArtifact,
  kind: K,
): Extract<Node, { kind: K }>[] {
  const matches: Extract<Node, { kind: K }>[] = [];
  const stack: unknown[] = [parsed.tree.blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isRecord(value)) continue;
    if (isKind(value, kind)) matches.push(value);
    const fields = Object.values(value).filter((field) => typeof field === 'object');
    for (let i = fields.length - 1; i >= 0; i--) stack.push(fields[i]);
  }
  return matches;
}

/** The text of `nodes` and everything in them, as written, without separators. */
export function textOf(nodes: unknown): string {
  let text = '';
  const stack: unknown[] = [nodes];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isRecord(value)) continue;
    if (typeof value['value'] === 'string') text += value['value'];
    const fields = Object.values(value).filter((field) => typeof field === 'object');
    for (let i = fields.length - 1; i >= 0; i--) stack.push(fields[i]);
  }
  return text;
}

/** Times `make`, in milliseconds. */
export function timed<T>(make: () => T): { made: T; elapsed: number } {
  const started = performance.now();
  const made = make();
  return { made, elapsed: performance.now() - started };
}
