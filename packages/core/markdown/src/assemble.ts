/**
 * Puts a document together from its parts as they were actually built, under the limits: each
 * part is built, then measured with an explicit stack, and one that nests past the depth limit
 * shows as its plain text instead. Parts are kept while the tree stays within the node limit,
 * and past it, the rest shows as plain text. Each stand-in is one paragraph of one text, room
 * for which is kept, so the tree never passes the limit.
 */

import type { Builder } from './build.ts';
import type { Block, Extension, Footnote, Plain } from './tree.ts';

/** A top-level part of a document: a block, or a run of text between blocks. */
export interface Part<X extends Extension = Plain> {
  build(): Block<X>[];
  /** Its text, shown when it can't show as built. */
  plain(): string;
  /** The line it starts on, from 0, when the source has lines. */
  line?: number;
}

export interface FootnotePart<X extends Extension = Plain> extends Part<X> {
  name: string;
  number: number;
}

/** The nodes of a stand-in: a paragraph and its text. */
export const PLAIN_NODES = 2;

/** Kinds that hold no other nodes, and so add no level of nesting. */
const LEAVES = new Set([
  'text',
  'inlineCode',
  'image',
  'break',
  'mention',
  'footnoteReference',
  'code',
  'rule',
  'suggestion',
]);

/** `text` as one plain paragraph, or nothing when it's empty. */
export function plainBlocks<X extends Extension = Plain>(text: string): Block<X>[] {
  // Trimmed by hand: a regular expression for a run at the end tries again at every newline of a
  // run inside, which takes time in the square of its length.
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === '\n') start += 1;
  while (end > start && text[end - 1] === '\n') end -= 1;
  const value = text.slice(start, end);
  return value === '' ? [] : [{ kind: 'paragraph', children: [{ kind: 'text', value }] }];
}

/**
 * The document made of `parts` and `footnotes`. `rest(index)` is the plain text of the parts from
 * `index` on, shown in their place once the node limit is reached.
 */
export function assemble<X extends Extension>(
  builder: Builder<X>,
  parts: readonly Part<X>[],
  footnotes: readonly FootnotePart<X>[],
  rest: (index: number) => string,
): Block<X>[] {
  const { limits, notes } = builder;
  // Room for two stand-ins: the rest of the text, and the footnotes that didn't fit.
  const budget = limits.nodes - 2 * PLAIN_NODES;
  let nodes = 0;
  const blocks: Block<X>[] = [];
  let cut: { line: number | undefined } | undefined;

  const fit = (part: Part<X>, depth: number): { built: Block<X>[]; nodes: number } => {
    const snapshot = builder.snapshot();
    const built = part.build();
    const measured = measure(built, depth);
    if (measured.depth <= limits.depth) return { built, nodes: measured.nodes };
    // What it used is put back, since what shows instead is only its text.
    builder.restore(snapshot);
    notes.add('deep');
    const plain = plainBlocks<X>(part.plain());
    return { built: plain, nodes: plain.length * PLAIN_NODES };
  };

  for (const [index, part] of parts.entries()) {
    const snapshot = builder.snapshot();
    const { built, nodes: size } = fit(part, 0);
    if (nodes + size > budget) {
      builder.restore(snapshot);
      notes.add('nodes');
      append(blocks, plainBlocks<X>(rest(index)));
      cut = { line: part.line };
      break;
    }
    nodes += size;
    append(blocks, built);
  }

  const items: Footnote<X>[] = [];
  const dropped: string[] = [];
  for (const footnote of footnotes) {
    if (!cut) {
      const snapshot = builder.snapshot();
      const { built, nodes: size } = fit(footnote, 2);
      // The item, and the footnotes block with the first.
      const total = size + 1 + (items.length === 0 ? 1 : 0);
      if (nodes + total <= budget) {
        nodes += total;
        items.push({ name: footnote.name, number: footnote.number, children: built });
        continue;
      }
      builder.restore(snapshot);
      notes.add('nodes');
      cut = { line: undefined };
    }
    // A footnote that doesn't fit shows as its text, unless the rest of the text, already shown,
    // holds it.
    const shown =
      cut.line !== undefined && footnote.line !== undefined && footnote.line >= cut.line;
    if (!shown) dropped.push(footnote.plain());
  }
  if (items.length > 0) blocks.push({ kind: 'footnotes', items });
  append(blocks, plainBlocks<X>(dropped.join('\n\n')));
  return settle(blocks, builder);
}

/**
 * How deep `blocks` nest, starting `depth` levels in, and how many nodes they hold, counted as
 * built: every node, list item, footnote and table cell, with an explicit stack.
 */
export function measure(
  blocks: readonly unknown[],
  depth: number,
): { depth: number; nodes: number } {
  let deepest = depth;
  let nodes = 0;
  const stack: { value: unknown; depth: number }[] = [{ value: blocks, depth }];
  while (stack.length > 0) {
    const { value, depth: at } = stack.pop()!;
    if (Array.isArray(value)) {
      for (const item of value) stack.push({ value: item, depth: at });
      continue;
    }
    if (!isRecord(value)) continue;
    const node = value;
    nodes += 1;
    const kind = node['kind'];
    const level = typeof kind === 'string' && LEAVES.has(kind) ? at : at + 1;
    deepest = Math.max(deepest, level);
    if (kind === 'list' || kind === 'footnotes') {
      // Each item is a level of its own.
      for (const item of asList(node['items'])) {
        nodes += 1;
        deepest = Math.max(deepest, level + 1);
        stack.push({ value: isRecord(item) ? item['children'] : undefined, depth: level + 1 });
      }
      continue;
    }
    if (kind === 'table') {
      // A row, then its cells.
      for (const row of [node['head'], ...asList(node['rows'])]) {
        for (const cell of asList(row)) {
          nodes += 1;
          deepest = Math.max(deepest, level + 2);
          stack.push({ value: cell, depth: level + 2 });
        }
      }
      continue;
    }
    for (const field of Object.values(node)) {
      if (Array.isArray(field)) stack.push({ value: field, depth: level });
    }
  }
  return { depth: deepest, nodes };
}

/** Adds `items` to the end of `list`, however many: spreading a long list into a call overflows. */
export function append<T>(list: T[], items: readonly T[]): void {
  for (const item of items) list.push(item);
}

function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/**
 * `blocks` with every link to an anchor the document no longer has, and every reference to a
 * footnote it left out, made text. A part shown as plain text takes its headings with it.
 */
function settle<X extends Extension>(blocks: Block<X>[], builder: Builder<X>): Block<X>[] {
  const anchors = new Set<string>();
  const footnotes = new Set<string>();
  const stack: unknown[] = [blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    if (!isRecord(value)) continue;
    if (value['kind'] === 'heading' && typeof value['anchor'] === 'string')
      anchors.add(value['anchor']);
    if (value['kind'] === 'footnotes') {
      for (const item of asList(value['items'])) {
        const name = isRecord(item) ? item['name'] : undefined;
        if (typeof name !== 'string') continue;
        anchors.add(name);
        footnotes.add(name);
      }
    }
    for (const field of Object.values(value)) if (Array.isArray(field)) stack.push(field);
  }
  settleList(blocks, anchors, footnotes, builder);
  return blocks;
}

/**
 * Settles `list` in place, and every list inside it. The tree is within the depth limit by now,
 * so this recurses no deeper than that.
 */
function settleList<X extends Extension>(
  list: unknown[],
  anchors: ReadonlySet<string>,
  footnotes: ReadonlySet<string>,
  builder: Builder<X>,
): void {
  const settled: unknown[] = [];
  const add = (node: unknown): void => {
    const last = settled.at(-1);
    if (isText(node) && isText(last)) {
      settled[settled.length - 1] = { kind: 'text', value: last['value'] + node['value'] };
    } else {
      settled.push(node);
    }
  };
  for (const node of list) {
    const target = isRecord(node) ? node['target'] : undefined;
    if (
      isRecord(node) &&
      node['kind'] === 'link' &&
      isRecord(target) &&
      target['kind'] === 'anchor' &&
      !anchors.has(String(target['name']))
    ) {
      for (const child of asList(node['children'])) add(child);
    } else if (
      isRecord(node) &&
      node['kind'] === 'footnoteReference' &&
      !footnotes.has(String(node['name']))
    ) {
      const name = String(node['name']);
      add({ kind: 'text', value: builder.references.get(name) ?? `[${String(node['number'])}]` });
    } else {
      add(node);
    }
  }
  list.length = 0;
  append(list, settled);
  for (const node of list) {
    if (Array.isArray(node)) settleList(node, anchors, footnotes, builder);
    else if (isRecord(node)) {
      for (const field of Object.values(node)) {
        if (Array.isArray(field)) settleList(field, anchors, footnotes, builder);
      }
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(node: unknown): node is { kind: 'text'; value: string } {
  return isRecord(node) && node['kind'] === 'text' && typeof node['value'] === 'string';
}
