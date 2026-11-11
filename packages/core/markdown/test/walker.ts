/**
 * The allowlist walker: everything a tree may hold, checked node by node with an explicit stack.
 * It knows Lo's kinds and their fields, and nothing else passes: an unknown kind or field, an
 * address that isn't a web page, an image off GitHub's image hosts, a name no anchor has, or
 * nesting, nodes, images or addresses past the limits.
 */

import { isDeepStrictEqual } from 'node:util';

import {
  DEFAULT_LIMITS,
  imageAddress,
  MAX_DIAGNOSTICS,
  webLink,
  type Limits,
} from '../src/index.ts';

export interface Walked {
  problems: string[];
  /** How many containers deep it nests at the deepest. */
  depth: number;
  nodes: number;
  images: number;
  /** The characters in all its addresses and anchor names. */
  addresses: number;
}

type Shape = 'block' | 'inline';

/** What a field holds when it holds nodes, or parts of nodes. */
type Holds = 'blocks' | 'inlines' | 'head' | 'rows' | 'items' | 'footnotes' | 'target';

interface Field {
  readonly check: (value: unknown) => boolean;
  readonly optional?: boolean;
  readonly holds?: Holds;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype
  );
}

function isList(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.isWellFormed();
}

function whole(min: number, max: number): (value: unknown) => boolean {
  return (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

const string: Field = { check: isString };
const boolean: Field = { check: (value) => typeof value === 'boolean' };
const oneOf = (...values: readonly unknown[]): Field => ({
  check: (value) => values.includes(value),
});
const blocks: Field = { check: isList, holds: 'blocks' };
const inlines: Field = { check: isList, holds: 'inlines' };
const positive = whole(1, Number.MAX_SAFE_INTEGER);

const KINDS: Record<Shape, ReadonlyMap<string, Record<string, Field>>> = {
  block: new Map(
    Object.entries<Record<string, Field>>({
      paragraph: { children: inlines },
      heading: { level: { check: whole(1, 6) }, anchor: string, children: inlines },
      quote: { children: blocks },
      alert: { type: oneOf('note', 'tip', 'important', 'warning', 'caution'), children: blocks },
      list: {
        ordered: boolean,
        start: { check: whole(0, 999_999_999) },
        tight: boolean,
        items: { check: isList, holds: 'items' },
      },
      code: {
        language: {
          check: (value) => isString(value) && /^[A-Za-z0-9][\w+#.-]{0,63}$/.test(value),
          optional: true,
        },
        text: string,
      },
      table: {
        align: {
          check: (value) =>
            isList(value) &&
            value.every((align) => ['left', 'center', 'right', 'none'].includes(String(align))),
        },
        head: { check: isList, holds: 'head' },
        rows: { check: isList, holds: 'rows' },
      },
      rule: {},
      details: { open: boolean, summary: inlines, children: blocks },
      suggestion: { text: string },
      footnotes: { items: { check: isList, holds: 'footnotes' } },
    }),
  ),
  inline: new Map(
    Object.entries<Record<string, Field>>({
      text: { value: string },
      strong: { children: inlines },
      emphasis: { children: inlines },
      strike: { children: inlines },
      inlineCode: { value: string },
      link: { target: { check: isRecord, holds: 'target' }, children: inlines },
      image: { url: string, alt: string },
      break: {},
      sub: { children: inlines },
      sup: { children: inlines },
      kbd: { children: inlines },
      mention: { name: string, url: string },
      footnoteReference: { name: string, number: { check: positive } },
    }),
  ),
};

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

/** Everything wrong with `tree` under `limits`; empty when it holds only what Lo's rules allow. */
export function problems(tree: unknown, limits: Limits = DEFAULT_LIMITS): string[] {
  return walk(tree, limits).problems;
}

interface Entry {
  value: unknown;
  shape: Shape;
  where: string;
  /** How many containers it sits in. */
  depth: number;
}

/** Walks `tree`, checking every node against Lo's rules under `limits`. */
export function walk(tree: unknown, limits: Limits = DEFAULT_LIMITS): Walked {
  const found: string[] = [];
  const problem = (where: string, what: string): void => {
    if (found.length < 50) found.push(`${where}: ${what}`);
  };
  const walked = { depth: 0, nodes: 0, images: 0, addresses: 0 };
  if (!isRecord(tree)) return { problems: ['the tree is not a plain object'], ...walked };
  const keys = Object.keys(tree).toSorted();
  if (!isDeepStrictEqual(keys, ['blocks', 'diagnostics', 'notes']))
    problem('tree', `has ${keys.join(', ')}`);
  checkNotes(tree['notes'], problem);
  checkDiagnostics(tree['diagnostics'], problem);

  // Every name in the document, which links and references must name.
  const anchors = new Set<string>();
  const footnotes = new Set<string>();
  const named: { where: string; name: string; footnote: boolean }[] = [];
  const stack: Entry[] = [];
  const pushAll = (list: unknown, shape: Shape, where: string, depth: number): void => {
    if (!isList(list)) return problem(where, 'is not a list');
    if (Object.keys(list).length !== list.length) problem(where, 'has holes');
    for (let i = list.length - 1; i >= 0; i--) {
      stack.push({ value: list[i], shape, where: `${where}[${i}]`, depth });
    }
  };
  /** A part of a node that holds nodes but has no kind: a list item, a footnote, a cell. */
  const part = (where: string, depth: number): void => {
    walked.nodes += 1;
    walked.depth = Math.max(walked.depth, depth);
    if (depth > limits.depth) problem(where, `nests ${depth} deep`);
  };
  const cells = (row: unknown, where: string, depth: number): void => {
    if (!isList(row)) return problem(where, 'is not a list');
    for (const [i, cell] of row.entries()) {
      part(`${where}[${i}]`, depth);
      pushAll(cell, 'inline', `${where}[${i}]`, depth);
    }
  };
  const holding = (holds: Holds, held: unknown, at: string, level: number): void => {
    switch (holds) {
      case 'blocks':
        return pushAll(held, 'block', at, level);
      case 'inlines':
        return pushAll(held, 'inline', at, level);
      case 'head':
        // A row, then its cells.
        return cells(held, at, level + 2);
      case 'rows':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [r, row] of held.entries()) cells(row, `${at}[${r}]`, level + 2);
        return;
      case 'items':
      case 'footnotes':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [i, item] of held.entries()) {
          const itemAt = `${at}[${i}]`;
          if (!isRecord(item)) {
            problem(itemAt, 'is not a plain object');
            continue;
          }
          if (holds === 'items') checkItem(item, itemAt, problem);
          else checkFootnote(item, itemAt, problem, anchors, footnotes);
          part(itemAt, level + 1);
          pushAll(item['children'], 'block', `${itemAt}.children`, level + 1);
        }
        return;
      case 'target': {
        const target = isRecord(held) ? held : {};
        const fields = Object.keys(target).toSorted().join();
        if (target['kind'] === 'web' && fields === 'kind,url' && isString(target['url'])) {
          if (webLink(target['url']) !== target['url']) problem(at, `goes to ${target['url']}`);
          walked.addresses += target['url'].length;
        } else if (
          target['kind'] === 'anchor' &&
          fields === 'kind,name' &&
          isString(target['name'])
        ) {
          named.push({ where: at, name: target['name'], footnote: false });
          walked.addresses += target['name'].length;
        } else {
          problem(at, `is ${JSON.stringify(target).slice(0, 80)}`);
        }
        return;
      }
      default:
        holds satisfies never;
    }
  };

  pushAll(tree['blocks'], 'block', 'blocks', 0);
  while (stack.length > 0) {
    const { value, shape, where, depth } = stack.pop()!;
    if (!isRecord(value)) {
      problem(where, 'is not a plain object');
      continue;
    }
    const kind = value['kind'];
    const fields = typeof kind === 'string' ? KINDS[shape].get(kind) : undefined;
    if (!fields || typeof kind !== 'string') {
      problem(where, `has the kind ${String(kind)}, which isn't a ${shape} Lo shows`);
      continue;
    }
    walked.nodes += 1;
    const level = LEAVES.has(kind) ? depth : depth + 1;
    walked.depth = Math.max(walked.depth, level);
    if (level > limits.depth) problem(where, `nests ${level} deep`);
    for (const key of Object.keys(value)) {
      if (key !== 'kind' && !Object.hasOwn(fields, key))
        problem(where, `${kind} has a field ${key}`);
    }
    for (const [key, field] of Object.entries(fields)) {
      const at = `${where}.${key}`;
      if (!Object.hasOwn(value, key)) {
        if (!field.optional) problem(at, 'is missing');
        continue;
      }
      const held = value[key];
      if (!field.check(held)) problem(at, `holds ${JSON.stringify(held)?.slice(0, 80)}`);
      else if (field.holds) holding(field.holds, held, at, level);
    }
    const url = value['url'];
    const name = value['name'];
    if (kind === 'heading' && isString(value['anchor'])) {
      if (anchors.has(value['anchor'])) problem(where, `repeats the anchor ${value['anchor']}`);
      anchors.add(value['anchor']);
    }
    if (kind === 'image' && isString(url)) {
      walked.images += 1;
      walked.addresses += url.length;
      if (imageAddress(url) !== url) problem(where, `loads ${url}`);
    }
    if (kind === 'mention' && isString(url) && isString(name)) {
      walked.addresses += url.length;
      const page = name.includes('/')
        ? `https://github.com/orgs/${name.replace('/', '/teams/')}`
        : `https://github.com/${name}`;
      if (url !== page || webLink(url) !== url) problem(where, `links ${url}`);
    }
    if (kind === 'footnoteReference' && isString(name)) named.push({ where, name, footnote: true });
  }
  for (const { where, name, footnote } of named) {
    if (!(footnote ? footnotes : anchors).has(name))
      problem(where, `names ${name}, which nothing in the document is`);
  }
  if (walked.nodes > limits.nodes) problem('tree', `has ${walked.nodes} nodes`);
  if (walked.images > limits.images) problem('tree', `shows ${walked.images} images`);
  if (walked.addresses > limits.addresses)
    problem('tree', `holds ${walked.addresses} characters of addresses`);
  if (found.length === 0) {
    // Plain data: it survives the trip to the window, and JSON's, unchanged.
    if (!isDeepStrictEqual(structuredClone(tree), tree))
      problem('tree', "doesn't survive structuredClone");
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(tree)), tree))
      problem('tree', "doesn't survive JSON");
  }
  return { problems: found, ...walked };
}

type Problem = (where: string, what: string) => void;

function checkItem(item: Record<string, unknown>, where: string, problem: Problem): void {
  const extra = Object.keys(item).filter((key) => key !== 'children' && key !== 'checked');
  if (extra.length > 0) problem(where, `has ${extra.join(', ')}`);
  if ('checked' in item && typeof item['checked'] !== 'boolean') problem(where, 'checked');
}

function checkFootnote(
  item: Record<string, unknown>,
  where: string,
  problem: Problem,
  anchors: Set<string>,
  footnotes: Set<string>,
): void {
  const keys = Object.keys(item).toSorted().join();
  if (keys !== 'children,name,number') problem(where, `has ${keys}`);
  if (!positive(item['number'])) problem(where, 'number');
  const name = item['name'];
  if (!isString(name)) return problem(where, 'name');
  if (anchors.has(name)) return problem(where, `repeats the name ${name}`);
  anchors.add(name);
  footnotes.add(name);
}

function checkNotes(notes: unknown, problem: Problem): void {
  if (!isList(notes)) return problem('notes', 'is not a list');
  const allowed = ['cut', 'deep', 'nodes'];
  if (
    notes.some((note) => !allowed.includes(String(note))) ||
    new Set(notes).size !== notes.length
  ) {
    problem('notes', JSON.stringify(notes));
  }
}

function checkDiagnostics(diagnostics: unknown, problem: Problem): void {
  if (!isList(diagnostics)) return problem('diagnostics', 'is not a list');
  if (diagnostics.length > MAX_DIAGNOSTICS) problem('diagnostics', `${diagnostics.length} of them`);
  for (const [i, diagnostic] of diagnostics.entries()) {
    const ok =
      isRecord(diagnostic) &&
      ['html', 'image', 'link'].includes(String(diagnostic['code'])) &&
      Object.keys(diagnostic).every((key) => key === 'code' || key === 'line') &&
      (!('line' in diagnostic) || positive(diagnostic['line']));
    if (!ok) problem(`diagnostics[${i}]`, JSON.stringify(diagnostic));
  }
}
