/** Helpers for reading trees in tests. */

import type { Block, Inline, Tree } from '../src/index.ts';
import { isRecord } from './walker.ts';

type Node = Block | Inline;

function isKind<K extends string>(value: unknown, kind: K): value is Extract<Node, { kind: K }> {
  return isRecord(value) && value['kind'] === kind;
}

/** Every node in `tree` (blocks, inlines, items' and cells' contents) of kind `kind`, in order. */
export function collect<K extends Node['kind']>(tree: Tree, kind: K): Extract<Node, { kind: K }>[] {
  const found: Extract<Node, { kind: K }>[] = [];
  const stack: unknown[] = [tree.blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isRecord(value)) continue;
    if (isKind(value, kind)) found.push(value);
    // Pushed so they're read in document order: a summary before its details, a head before rows.
    for (const key of ['children', 'items', 'rows', 'head', 'summary']) {
      if (key in value) stack.push(value[key]);
    }
  }
  return found;
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
    if ('children' in value) stack.push(value['children']);
  }
  return text;
}
