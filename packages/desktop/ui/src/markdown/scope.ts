/**
 * A document's anchors, scoped to it. A heading's anchor and a footnote's name are names the text
 * chose, so they never become ids: each is given a number, and its id is the document's prefix and
 * that number. Two documents on one page, or a heading named like one of Lo's own ids, can't
 * reach each other's elements or Lo's.
 */

export class Anchors {
  readonly prefix: string;
  private readonly numbers = new Map<string, number>();

  /**
   * `blocks`' anchors under `prefix`, which is Lo's own and unique on the page. Every heading and
   * footnote counts, however deep, in an extension's blocks too.
   */
  constructor(prefix: string, blocks: readonly unknown[]) {
    this.prefix = prefix;
    for (const name of anchorNames(blocks)) {
      if (!this.numbers.has(name)) this.numbers.set(name, this.numbers.size);
    }
  }

  /** The id of the element `name` names, or undefined when the document has no such anchor. */
  id(name: string): string | undefined {
    const number = this.numbers.get(name);
    return number === undefined ? undefined : `${this.prefix}-a${number}`;
  }

  /** An id of the document's own for something Lo draws in it, such as a tab and its panel. */
  own(part: string): string {
    return `${this.prefix}-${part}`;
  }
}

/**
 * Every heading's anchor and footnote's name in `blocks`, in the order they come. It walks with an
 * explicit stack, so no tree can overflow it, and reads only the two fields it wants from nodes of
 * those two kinds: anything else is only looked into.
 */
export function anchorNames(blocks: readonly unknown[]): string[] {
  const names: string[] = [];
  const stack: unknown[] = [blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (let i = value.length - 1; i >= 0; i--) stack.push(value[i]);
      continue;
    }
    if (!isRecord(value)) continue;
    const node = value;
    if (node['kind'] === 'heading' && typeof node['anchor'] === 'string') {
      names.push(node['anchor']);
    }
    const items: unknown = node['items'];
    if (node['kind'] === 'footnotes' && Array.isArray(items)) {
      for (const item of items) {
        if (isRecord(item) && typeof item['name'] === 'string') names.push(item['name']);
      }
    }
    // What's inside, last first so the stack gives it back in order.
    const inner = Object.values(node).filter((field) => typeof field === 'object');
    for (let i = inner.length - 1; i >= 0; i--) stack.push(inner[i]);
  }
  return names;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Lo's own prefix for a document's ids, from a React id, which is unique on the page. */
export function scopePrefix(reactId: string): string {
  return `lo-md${reactId.replace(/[^\w-]/g, '')}`;
}

const generations = new WeakMap<object, number>();
let lastGeneration = 0;

/**
 * A number of Lo's own for a tree, the same for as long as it's the same tree. Keying what's
 * drawn from a tree by it means a new tree's folds, tabs and the like start fresh, rather than
 * taking on the state of what sat in their place before.
 */
export function generationOf(tree: object): number {
  let generation = generations.get(tree);
  if (generation === undefined) {
    lastGeneration += 1;
    generation = lastGeneration;
    generations.set(tree, generation);
  }
  return generation;
}
