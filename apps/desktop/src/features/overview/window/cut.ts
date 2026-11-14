// The start of what an overview says, as its blocks: the words a marker's note shows in the diff,
// as rich text, cut short as the note's plain text is, at a word, with an ellipsis. Words are
// counted as the plain text counts them, every run of space as one, so the rich text is never
// longer. A block that can't be cut part way, such as a table, comes whole or not at all, and a
// block of the overview's own, such as a figure, which says nothing in plain text, is left out.

import type { Overview, OverviewBlock } from '@lo/artifact';
import { plainText, type Inline, type ListItem } from '@lo/markdown';

type OverviewInline = Inline<Overview>;

/** What's left of the words to keep, and whether the text was cut. */
interface Budget {
  readonly limit: number;
  left: number;
  cut: boolean;
}

const ELLIPSIS = '…';

/**
 * `blocks`, cut so their words come to at most `limit` characters, and end with an ellipsis where
 * they're cut: at a word, unless that would leave less than half of them.
 */
export function cutBlocks(blocks: readonly OverviewBlock[], limit: number): OverviewBlock[] {
  return cutList(blocks, { limit, left: limit, cut: false });
}

function cutList(blocks: readonly OverviewBlock[], budget: Budget): OverviewBlock[] {
  const kept: OverviewBlock[] = [];
  for (const node of blocks) {
    if (budget.cut) break;
    // The space between one block's words and the next's.
    if (kept.length > 0) budget.left -= 1;
    const block = cutBlock(node, budget);
    if (block) kept.push(block);
  }
  return kept;
}

function cutBlock(node: OverviewBlock, budget: Budget): OverviewBlock | undefined {
  switch (node.kind) {
    case 'paragraph':
    case 'heading': {
      const children = cutInlines(node.children, budget);
      return children.length > 0 ? { ...node, children } : undefined;
    }
    case 'quote':
    case 'alert': {
      const children = cutList(node.children, budget);
      return children.length > 0 ? { ...node, children } : undefined;
    }
    case 'list': {
      const items = cutItems(node.items, budget);
      return items.length > 0 ? { ...node, items } : undefined;
    }
    case 'footnotes': {
      const items = cutItems(node.items, budget);
      return items.length > 0 ? { ...node, items } : undefined;
    }
    case 'code':
    case 'suggestion': {
      const words = node.text.replace(/\s+/g, ' ');
      if (words.length <= budget.left) {
        budget.left -= words.length;
        return node;
      }
      // Fewer characters of the code as written than of its words: never longer.
      const text = `${keep(node.text, budget.left - 1).trimEnd()}${ELLIPSIS}`;
      budget.left = 0;
      budget.cut = true;
      return { ...node, text };
    }
    case 'rule':
      return node;
    case 'table':
    case 'details': {
      const length = plainText(
        { blocks: [node], notes: [], diagnostics: [] },
        budget.left + 1,
      ).length;
      if (length <= budget.left) {
        budget.left -= length;
        return node;
      }
      budget.cut = true;
      return { kind: 'paragraph', children: [{ kind: 'text', value: ELLIPSIS }] };
    }
    case 'excerpt':
    case 'figure':
    case 'walkthrough':
    case 'tabs':
    case 'glossary':
      // The overview's own blocks, whose words aren't in its plain text.
      return undefined;
    default:
      node satisfies never;
      return undefined;
  }
}

function cutItems<I extends ListItem<Overview>>(items: readonly I[], budget: Budget): I[] {
  const kept: I[] = [];
  for (const item of items) {
    if (budget.cut) break;
    if (kept.length > 0) budget.left -= 1;
    const children = cutList(item.children, budget);
    if (children.length > 0) kept.push({ ...item, children });
  }
  return kept;
}

function cutInlines(inlines: readonly OverviewInline[], budget: Budget): OverviewInline[] {
  const kept: OverviewInline[] = [];
  for (const node of inlines) {
    if (budget.cut) break;
    switch (node.kind) {
      case 'text': {
        const words = cutWords(node.value, budget);
        kept.push({ kind: 'text', value: budget.cut ? `${words}${ELLIPSIS}` : node.value });
        break;
      }
      case 'inlineCode': {
        const words = cutWords(node.value, budget);
        if (!budget.cut) kept.push(node);
        else {
          if (words) kept.push({ kind: 'inlineCode', value: words });
          kept.push({ kind: 'text', value: ELLIPSIS });
        }
        break;
      }
      case 'image':
      case 'mention':
      case 'footnoteReference': {
        const length = wordsOf(node).length;
        if (length <= budget.left) {
          budget.left -= length;
          kept.push(node);
        } else {
          budget.cut = true;
          kept.push({ kind: 'text', value: ELLIPSIS });
        }
        break;
      }
      case 'break':
        budget.left -= 1;
        kept.push(node);
        break;
      case 'strong':
      case 'emphasis':
      case 'strike':
      case 'link':
      case 'sub':
      case 'sup':
      case 'kbd': {
        const children = cutInlines(node.children, budget);
        if (children.length > 0) kept.push({ ...node, children });
        break;
      }
      default:
        node satisfies never;
    }
  }
  return kept;
}

/** The words of a node that can't be cut, as the plain text has them. */
function wordsOf(
  node: Extract<OverviewInline, { kind: 'image' | 'mention' | 'footnoteReference' }>,
): string {
  if (node.kind === 'image') return node.alt;
  return node.kind === 'mention' ? `@${node.name}` : `[${node.number}]`;
}

/**
 * `value`'s words, every run of space as one, all of them while they fit, and else as many as fit
 * with room for the ellipsis, cut at a word unless that would leave less than half the text.
 */
function cutWords(value: string, budget: Budget): string {
  const words = value.replace(/\s+/g, ' ');
  if (words.length <= budget.left) {
    budget.left -= words.length;
    return words;
  }
  const room = Math.max(0, budget.left - 1);
  const before = budget.limit - budget.left;
  const space = words.lastIndexOf(' ', room);
  const end = space >= 0 && before + space > budget.limit / 2 ? space : room;
  budget.left = 0;
  budget.cut = true;
  return keep(words, end).trimEnd();
}

/** The first `end` characters of `text`, never half of a character a surrogate pair makes. */
function keep(text: string, end: number): string {
  let at = Math.max(0, end);
  if (/[\uD800-\uDBFF]/.test(text.charAt(at - 1))) at -= 1;
  return text.slice(0, at);
}
