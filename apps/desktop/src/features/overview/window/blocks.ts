// An overview's blocks as the keys, menus and history know them: by an id of Lo's own, the
// overview's tree and the block's place in it, never a path, a part's id or a heading from the
// overview; what code each block points at, which following goes to and the code beside shows; and
// where that code is in the head the diff shows. Plain functions, each tested alone.

import type { CodeTarget, Lines, OverviewBlock, Walkthrough } from '@lo/artifact';

/**
 * A block's id: the number Lo gave the tree it's in, and its place among the tree's blocks. A
 * newer overview is another tree, so a place its reader left in an older one isn't taken for one
 * of its own blocks.
 */
export function blockId(tree: number, block: number): string {
  return `${tree}.${block}`;
}

/** The block an id names in tree `tree`, by its place, if the id is of that tree's. */
export function blockIn(id: string, tree: number): number | undefined {
  const match = /^(\d+)\.(\d+)$/.exec(id);
  if (!match || Number(match[1]) !== tree) return undefined;
  return Number(match[2]);
}

/**
 * The step each walkthrough shows, by its block, as the reader left it: what following the
 * walkthrough goes to, and what it shows again when it's drawn again. A tree's blocks are its own
 * objects, the same for as long as the tree is on screen.
 */
const steps = new WeakMap<Walkthrough, number>();
const stepListeners = new Set<() => void>();
let stepCount = 0;

/** The step walkthrough `node` shows: its first, until the reader moves on. */
export function stepOf(node: Walkthrough): number {
  const at = steps.get(node) ?? 0;
  return Math.max(0, Math.min(at, node.steps.length - 1));
}

/** Records the step walkthrough `node` shows, and tells those listening when it's another. */
export function setStep(node: Walkthrough, at: number): void {
  if (stepOf(node) === at && steps.has(node)) return;
  steps.set(node, at);
  stepCount += 1;
  for (const listener of stepListeners) listener();
}

/** Calls `listener` as any walkthrough's step changes. Returns a function that stops it. */
export function onStep(listener: () => void): () => void {
  stepListeners.add(listener);
  return () => {
    stepListeners.delete(listener);
  };
}

/** How many times a step has changed, which changes with each. */
export function stepsChanged(): number {
  return stepCount;
}

/** Code a block points at: a file, and some of its lines unless it's the whole file. */
export interface CodeAt {
  readonly path: string;
  readonly lines?: Lines | undefined;
}

/**
 * The code `block` points at, if it points at any: a code block's lines; the step a walkthrough
 * shows; otherwise the first code its figure's parts or its links name, in the order written.
 */
export function codeOf(block: OverviewBlock): CodeAt | undefined {
  switch (block.kind) {
    case 'excerpt':
      return codeAt(block.target);
    case 'walkthrough': {
      const step = block.steps[stepOf(block)];
      return step && codeAt(step.target);
    }
    case 'figure': {
      for (const part of block.parts) {
        if (part.target.kind === 'code') return codeAt(part.target);
      }
      return firstLink(block.caption);
    }
    case 'paragraph':
    case 'list':
    case 'table':
    case 'quote':
    case 'alert':
    case 'footnotes':
    case 'glossary':
    case 'tabs':
    case 'details':
      return firstLink(block);
    case 'heading':
    case 'code':
    case 'rule':
    case 'suggestion':
      return undefined;
    default:
      block satisfies never;
      throw new Error(`A kind of block Lo doesn't know: ${JSON.stringify(block)}.`);
  }
}

/** The code a link to code points at. */
export function codeAt(target: CodeTarget): CodeAt {
  return target.lines ? { path: target.path, lines: target.lines } : { path: target.path };
}

/**
 * The first link to code in `tree`, in the order written. It walks with an explicit stack, so no
 * tree can overflow it.
 */
function firstLink(tree: unknown): CodeAt | undefined {
  const stack: unknown[] = [tree];
  while (stack.length > 0) {
    const value = stack.pop();
    if (typeof value !== 'object' || value === null) continue;
    if (Array.isArray(value)) {
      for (let at = value.length - 1; at >= 0; at--) stack.push(value[at]);
      continue;
    }
    const target: unknown = Reflect.get(value, 'target');
    if (Reflect.get(value, 'kind') === 'link' && isCode(target)) return codeAt(target);
    const fields = Object.values(value);
    for (let at = fields.length - 1; at >= 0; at--) stack.push(fields[at]);
  }
  return undefined;
}

function isCode(value: unknown): value is CodeTarget {
  return (
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === 'code' &&
    typeof Reflect.get(value, 'path') === 'string'
  );
}

/** Code at the head the diff shows: a file there, and the lines the block's lines are there. */
export interface CodeOnHead {
  readonly path: string;
  /** The first line, which following goes to. */
  readonly line: number | undefined;
  /** Every line, which the whole file picks out. */
  readonly lines: { readonly from: number; readonly to: number } | undefined;
}

/**
 * Where `code`, at the overview's commit, is at the head the diff shows. The lines are taken as
 * they are, which holds when the overview's commit is that head; mapping lines from an older
 * commit across what changed since, and a file renamed since, goes here.
 */
export function onHead(code: CodeAt): CodeOnHead {
  const { path, lines } = code;
  return {
    path,
    line: lines?.start,
    lines: lines && { from: lines.start, to: lines.end },
  };
}
