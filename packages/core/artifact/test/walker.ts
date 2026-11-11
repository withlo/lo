/**
 * The allowlist walker: everything an overview's tree may hold, checked node by node with an
 * explicit stack, by rules written apart from the parser's. It knows `@lo/markdown`'s kinds and the
 * format's, and nothing else passes: an unknown kind or field, a target the format doesn't allow, a
 * path that isn't plain, nesting or nodes past the limits. With `counts`, which holds for an
 * overview without errors, it also checks what the format counts: steps, tabs, titles, figures,
 * targets, and that every term linked is defined once.
 */

import { isDeepStrictEqual } from 'node:util';

import { imageAddress, webLink } from '@lo/markdown';

import { LIMITS } from '../src/index.ts';

export interface Walked {
  problems: string[];
  /** How many containers deep it nests at the deepest. */
  depth: number;
  nodes: number;
  /** The code, term and section targets it holds. */
  targets: number;
  figures: number;
}

export interface WalkOptions {
  /** Whether to check what the format counts, which only an overview without errors keeps to. */
  counts?: boolean;
}

type Shape = 'block' | 'inline';
type Holds =
  | 'blocks'
  | 'inlines'
  | 'head'
  | 'rows'
  | 'items'
  | 'footnotes'
  | 'target'
  | 'range'
  | 'parts'
  | 'steps'
  | 'tabs'
  | 'terms';

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
const blocks: Field = { check: isList, holds: 'blocks' };
const inlines: Field = { check: isList, holds: 'inlines' };
const positive = whole(1, Number.MAX_SAFE_INTEGER);
const listOf = (holds: Holds): Field => ({ check: isList, holds });

const KINDS: Record<Shape, ReadonlyMap<string, Record<string, Field>>> = {
  block: new Map(
    Object.entries<Record<string, Field>>({
      paragraph: { children: inlines },
      heading: { level: { check: whole(1, 6) }, anchor: string, children: inlines },
      quote: { children: blocks },
      alert: {
        type: {
          check: (value) =>
            ['note', 'tip', 'important', 'warning', 'caution'].includes(String(value)),
        },
        children: blocks,
      },
      list: {
        ordered: boolean,
        start: { check: whole(0, 999_999_999) },
        tight: boolean,
        items: listOf('items'),
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
        head: listOf('head'),
        rows: listOf('rows'),
      },
      rule: {},
      details: { open: boolean, summary: inlines, children: blocks },
      suggestion: { text: string },
      footnotes: { items: listOf('footnotes') },
      // The format's.
      excerpt: { target: { check: isRecord, holds: 'range' } },
      figure: { path: { check: isFigurePath }, caption: blocks, parts: listOf('parts') },
      walkthrough: { title: string, steps: listOf('steps') },
      tabs: { tabs: listOf('tabs') },
      glossary: { terms: listOf('terms') },
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
  'excerpt',
]);

/** Whether `path` is a path in the repository as the format allows one, by its own reading. */
export function isPlainPath(path: unknown): path is string {
  if (!isString(path) || path === '' || new TextEncoder().encode(path).length > LIMITS.argument) {
    return false;
  }
  if (path.startsWith('/') || path.includes('\\')) return false;
  for (const char of path) {
    const code = char.codePointAt(0)!;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return path
    .split('/')
    .every((part) => part !== '' && part !== '.' && part !== '..' && part.toLowerCase() !== '.git');
}

function isFigurePath(path: unknown): boolean {
  return (
    isPlainPath(path) && /^figures\/[^/]*[^/.][^/]*\.(?:svg|png|jpg|jpeg|gif|webp)$/.test(path)
  );
}

function isLines(value: unknown, most: number): boolean {
  if (!isRecord(value)) return false;
  const keys = Object.keys(value).toSorted().join();
  const { start, end } = value;
  return (
    keys === 'end,start' &&
    whole(1, 999_999_999)(start) &&
    whole(1, 999_999_999)(end) &&
    Number(end) >= Number(start) &&
    Number(end) - Number(start) < most
  );
}

/** A term's key, by the format's rule: lower case, each run of white space one space, trimmed. */
function isKey(key: unknown): key is string {
  return (
    isString(key) &&
    key !== '' &&
    key === key.toLowerCase() &&
    key === key.trim() &&
    !/\s\s|[\t\n\r\f\v\u00A0]/.test(key) &&
    !/\p{Cc}/u.test(key)
  );
}

/** Everything wrong with `tree`; empty when it holds only what the format allows. */
export function problems(tree: unknown, options: WalkOptions = {}): string[] {
  return walk(tree, options).problems;
}

interface Entry {
  value: unknown;
  shape: Shape;
  where: string;
  depth: number;
}

/** Walks `tree`, checking every node against the format's rules. */
export function walk(tree: unknown, options: WalkOptions = {}): Walked {
  const counts = options.counts ?? false;
  const found: string[] = [];
  const problem = (where: string, what: string): void => {
    if (found.length < 50) found.push(`${where}: ${what}`);
  };
  const walked = { depth: 0, nodes: 0, targets: 0, figures: 0 };
  if (!isRecord(tree)) return { problems: ['the tree is not a plain object'], ...walked };
  const keys = Object.keys(tree).toSorted();
  if (!isDeepStrictEqual(keys, ['blocks', 'diagnostics', 'notes'])) {
    problem('tree', `has ${keys.join(', ')}`);
  }
  if (!isList(tree['notes']) || !isList(tree['diagnostics'])) problem('tree', 'notes, diagnostics');

  const anchors = new Set<string>();
  const footnotes = new Set<string>();
  const named: { where: string; name: string; footnote: boolean }[] = [];
  const terms: { where: string; key: string }[] = [];
  const defined = new Set<string>();
  let glossaries = 0;
  const stack: Entry[] = [];
  const pushAll = (list: unknown, shape: Shape, where: string, depth: number): void => {
    if (!isList(list)) return problem(where, 'is not a list');
    if (Object.keys(list).length !== list.length) problem(where, 'has holes');
    for (let i = list.length - 1; i >= 0; i--) {
      stack.push({ value: list[i], shape, where: `${where}[${i}]`, depth });
    }
  };
  const part = (where: string, depth: number): void => {
    walked.nodes += 1;
    walked.depth = Math.max(walked.depth, depth);
    if (depth > LIMITS.depth) problem(where, `nests ${depth} deep`);
  };
  /**
   * A record without a kind: a list item, a step, a tab, a definition, a figure's part. It holds
   * each of `fields` but the `optional` ones, and nothing else.
   */
  const record = (
    item: unknown,
    where: string,
    fields: Record<string, (value: unknown) => boolean>,
    optional: readonly string[] = [],
  ): Record<string, unknown> | undefined => {
    if (!isRecord(item)) {
      problem(where, 'is not a plain object');
      return undefined;
    }
    for (const key of Object.keys(item)) {
      if (!Object.hasOwn(fields, key)) problem(where, `has a field ${key}`);
    }
    for (const [key, check] of Object.entries(fields)) {
      if (!Object.hasOwn(item, key)) {
        if (!optional.includes(key)) problem(where, `has no ${key}`);
      } else if (!check(item[key])) {
        problem(`${where}.${key}`, `holds ${JSON.stringify(item[key])?.slice(0, 80)}`);
      }
    }
    return item;
  };
  const cells = (row: unknown, where: string, depth: number): void => {
    if (!isList(row)) return problem(where, 'is not a list');
    for (const [i, cell] of row.entries()) {
      part(`${where}[${i}]`, depth);
      pushAll(cell, 'inline', `${where}[${i}]`, depth);
    }
  };
  const target = (held: unknown, at: string, allowed: readonly string[]): void => {
    const value = isRecord(held) ? held : {};
    const fields = Object.keys(value).toSorted().join();
    const kind = value['kind'];
    if (!allowed.includes(String(kind))) return problem(at, `is a ${String(kind)} target here`);
    if (kind === 'web' && fields === 'kind,url' && isString(value['url'])) {
      if (webLink(value['url']) !== value['url']) problem(at, `goes to ${value['url']}`);
      return;
    }
    walked.targets += 1;
    if (kind === 'anchor' && fields === 'kind,name' && isString(value['name'])) {
      named.push({ where: at, name: value['name'], footnote: false });
      return;
    }
    if (kind === 'code' && (fields === 'kind,path' || fields === 'kind,lines,path')) {
      if (!isPlainPath(value['path']))
        problem(at, `names the path ${JSON.stringify(value['path'])}`);
      if ('lines' in value && !isLines(value['lines'], Infinity)) problem(at, 'has bad lines');
      return;
    }
    if (kind === 'term' && fields === 'key,kind' && isKey(value['key'])) {
      terms.push({ where: at, key: value['key'] });
      return;
    }
    problem(at, `is ${JSON.stringify(value).slice(0, 80)}`);
  };
  const range = (held: unknown, at: string): void => {
    target(held, at, ['code']);
    if (!isRecord(held) || !isLines(held['lines'], LIMITS.lines)) {
      problem(at, 'needs at most 200 lines');
    }
  };
  const holding = (holds: Holds, held: unknown, at: string, level: number): void => {
    switch (holds) {
      case 'blocks':
        return pushAll(held, 'block', at, level);
      case 'inlines':
        return pushAll(held, 'inline', at, level);
      case 'head':
        return cells(held, at, level + 2);
      case 'rows':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [r, row] of held.entries()) cells(row, `${at}[${r}]`, level + 2);
        return;
      case 'items':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [i, item] of held.entries()) {
          const kept = record(
            item,
            `${at}[${i}]`,
            { checked: (value) => typeof value === 'boolean', children: isList },
            ['checked'],
          );
          part(`${at}[${i}]`, level + 1);
          if (kept) pushAll(kept['children'], 'block', `${at}[${i}].children`, level + 1);
        }
        return;
      case 'footnotes':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [i, item] of held.entries()) {
          const kept = record(item, `${at}[${i}]`, {
            name: isString,
            number: positive,
            children: isList,
          });
          part(`${at}[${i}]`, level + 1);
          if (!kept) continue;
          const name = String(kept['name']);
          if (anchors.has(name)) problem(`${at}[${i}]`, `repeats the name ${name}`);
          anchors.add(name);
          footnotes.add(name);
          pushAll(kept['children'], 'block', `${at}[${i}].children`, level + 1);
        }
        return;
      case 'target':
        return target(held, at, ['web', 'anchor', 'code', 'term']);
      case 'range':
        return range(held, at);
      case 'parts': {
        if (!isList(held)) return problem(at, 'is not a list');
        const ids = new Set<string>();
        for (const [i, item] of held.entries()) {
          const where = `${at}[${i}]`;
          const kept = record(item, where, { id: isString, target: isRecord });
          part(where, level + 1);
          if (!kept) continue;
          const id = String(kept['id']);
          if (id.length > 64 || !/^[A-Za-z_][\w.-]*$/.test(id)) problem(where, `has the id ${id}`);
          if (ids.has(id)) problem(where, `repeats the id ${id}`);
          ids.add(id);
          target(kept['target'], `${where}.target`, ['anchor', 'code', 'term']);
        }
        return;
      }
      case 'steps':
        if (!isList(held)) return problem(at, 'is not a list');
        if (counts && (held.length < 3 || held.length > LIMITS.steps)) {
          problem(at, `has ${held.length} steps`);
        }
        for (const [i, item] of held.entries()) {
          const where = `${at}[${i}]`;
          const kept = record(item, where, { target: isRecord, children: isList });
          part(where, level + 1);
          if (!kept) continue;
          range(kept['target'], `${where}.target`);
          pushAll(kept['children'], 'block', `${where}.children`, level + 1);
        }
        return;
      case 'tabs':
        if (!isList(held)) return problem(at, 'is not a list');
        if (counts && (held.length < 2 || held.length > LIMITS.tabs)) {
          problem(at, `has ${held.length} tabs`);
        }
        for (const [i, item] of held.entries()) {
          const where = `${at}[${i}]`;
          const kept = record(item, where, { title: isString, children: isList });
          part(where, level + 1);
          if (!kept) continue;
          if (counts && kept['title'] === '') problem(where, 'has no title');
          pushAll(kept['children'], 'block', `${where}.children`, level + 1);
        }
        return;
      case 'terms':
        if (!isList(held)) return problem(at, 'is not a list');
        for (const [i, item] of held.entries()) {
          const where = `${at}[${i}]`;
          const kept = record(item, where, { name: isString, key: isKey, children: isList });
          part(where, level + 1);
          if (!kept) continue;
          const key = String(kept['key']);
          if (key !== String(kept['name']).replace(/\s+/g, ' ').trim().toLowerCase()) {
            problem(where, `has the key ${key} for ${String(kept['name'])}`);
          }
          if (defined.has(key)) problem(where, `defines ${key} again`);
          defined.add(key);
          pushAll(kept['children'], 'block', `${where}.children`, level + 1);
        }
        return;
      default:
        holds satisfies never;
        throw new Error(`Unknown field ${String(holds)}`);
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
      problem(where, `has the kind ${String(kind)}, which isn't a ${shape} an overview holds`);
      continue;
    }
    walked.nodes += 1;
    const level = LEAVES.has(kind) ? depth : depth + 1;
    walked.depth = Math.max(walked.depth, level);
    if (level > LIMITS.depth) problem(where, `nests ${level} deep`);
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
    if (kind === 'heading' && isString(value['anchor'])) {
      if (anchors.has(value['anchor'])) problem(where, `repeats the anchor ${value['anchor']}`);
      anchors.add(value['anchor']);
    }
    if (kind === 'image' && isString(value['url']) && imageAddress(value['url']) !== value['url']) {
      problem(where, `loads ${value['url']}`);
    }
    if (kind === 'footnoteReference' && isString(value['name'])) {
      named.push({ where, name: value['name'], footnote: true });
    }
    if (kind === 'figure') {
      walked.figures += 1;
      if (counts && isList(value['caption']) && value['caption'].length === 0) {
        problem(where, 'has no caption');
      }
      // Only an SVG has parts to link.
      const { path, parts } = value;
      if (isString(path) && !path.endsWith('.svg') && isList(parts) && parts.length > 0) {
        problem(where, `links parts of ${path}, which isn't an SVG`);
      }
    }
    if (kind === 'glossary') glossaries += 1;
    if (counts) {
      if (kind === 'heading' && value['level'] === 1) problem(where, 'is a # heading');
      if (kind === 'walkthrough' && value['title'] === '') problem(where, 'has no title');
      if (kind === 'details' && isList(value['summary']) && value['summary'].length === 0) {
        problem(where, 'has no title');
      }
    }
  }
  for (const { where, name, footnote } of named) {
    if (!(footnote ? footnotes : anchors).has(name)) {
      problem(where, `names ${name}, which nothing in the document is`);
    }
  }
  if (walked.nodes > LIMITS.nodes) problem('tree', `has ${walked.nodes} nodes`);
  if (counts) {
    if (walked.targets > LIMITS.targets) problem('tree', `has ${walked.targets} targets`);
    if (walked.figures > LIMITS.figures) problem('tree', `has ${walked.figures} figures`);
    if (glossaries > 1) problem('tree', `has ${glossaries} glossaries`);
    for (const { where, key } of terms) {
      if (!defined.has(key))
        problem(where, `names the term ${key}, which the glossary doesn't define`);
    }
  }
  if (found.length === 0) {
    if (!isDeepStrictEqual(structuredClone(tree), tree)) {
      problem('tree', "doesn't survive structuredClone");
    }
    if (!isDeepStrictEqual(JSON.parse(JSON.stringify(tree)), tree)) {
      problem('tree', "doesn't survive JSON");
    }
  }
  return { problems: found, ...walked };
}
