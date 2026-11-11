import type { Extension, Plain, Tree } from './tree.ts';

/** Inline nodes whose text runs on into the text around them. */
const RUNS_ON = new Set(['strong', 'emphasis', 'strike', 'link', 'sub', 'sup', 'kbd']);

/** Set apart from the text around it. */
const APART = Symbol('apart');

/**
 * A tree's text on one line, for a summary: its words with every run of space, newline or break
 * as one space, an image as its alt text, a mention as `@name`. It reads no further than `max`
 * characters, so a summary of a huge tree costs no more than a short one's, and walks the tree
 * with an explicit stack, so no tree can overflow it.
 */
export function plainText<X extends Extension = Plain>(tree: Tree<X>, max = Infinity): string {
  let text = '';
  let space = false;
  const add = (value: string): void => {
    const pieces = value.split(/\s+/);
    for (let i = 0; i < pieces.length && text.length < max; i++) {
      // Pieces after the first had space before them.
      if (i > 0) space = text !== '';
      const piece = pieces[i]!;
      if (piece === '') continue;
      if (space) text += ' ';
      text += piece;
      space = false;
    }
  };
  // Nodes, lists of nodes and gaps still to read, the next on top.
  const stack: unknown[] = [tree.blocks];
  while (stack.length > 0 && text.length < max) {
    const node = stack.pop();
    if (node === APART) {
      space = text !== '';
      continue;
    }
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
      continue;
    }
    if (typeof node !== 'object' || node === null || !('kind' in node)) continue;
    const field = (name: string): unknown => (node as Record<string, unknown>)[name];
    const kind = node.kind;
    if (typeof kind !== 'string') continue;
    if (RUNS_ON.has(kind)) {
      stack.push(field('children'));
      continue;
    }
    switch (kind) {
      case 'text':
      case 'inlineCode':
        add(asString(field('value')));
        break;
      case 'image':
        add(asString(field('alt')));
        break;
      case 'mention':
        add(`@${asString(field('name'))}`);
        break;
      case 'footnoteReference': {
        const number = field('number');
        if (typeof number === 'number') add(`[${number}]`);
        break;
      }
      case 'break':
        space = text !== '';
        break;
      case 'code':
      case 'suggestion':
        stack.push(APART, { kind: 'text', value: asString(field('text')) }, APART);
        break;
      case 'list':
      case 'footnotes':
        stack.push(
          APART,
          asArray(field('items')).map((item) => [APART, childrenOf(item)]),
          APART,
        );
        break;
      case 'table': {
        const rows = [asArray(field('head')), ...asArray(field('rows'))];
        stack.push(
          APART,
          rows.map((row) => asArray(row).map((cell) => [APART, cell])),
          APART,
        );
        break;
      }
      case 'details':
        stack.push(APART, field('children'), APART, field('summary'), APART);
        break;
      default:
        // A block with children, Lo's or an extension's.
        stack.push(APART, field('children'), APART);
    }
  }
  return text.slice(0, max);
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function childrenOf(item: unknown): unknown {
  return typeof item === 'object' && item !== null && 'children' in item ? item.children : [];
}
