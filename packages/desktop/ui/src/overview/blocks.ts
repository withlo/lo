/**
 * The overview's blocks: which of the article's blocks the block keys stop at, and what a focused
 * one says it can do. A block's number is its place among the article's blocks, Lo's own, never a
 * path, an id or a heading from the overview.
 */

import type { OverviewBlock } from '@lo/artifact';

import { isRecord } from '../markdown/scope.ts';

/** A key, or keys that each do it, and what it does: `{ keys: [['←'], ['→']], label: 'Step' }`. */
export interface BlockHint {
  /** Each key that does it, as `Key` shows one: `['⏎']`, or `[']', 'b']` for a sequence. */
  keys: readonly (readonly string[])[];
  label: string;
}

/**
 * Whether the block keys stop at `block`: it holds something to act on. Code, figures,
 * walkthroughs, tabs and folds always do; prose does when it links to code or a term.
 */
export function isStop(block: OverviewBlock): boolean {
  switch (block.kind) {
    case 'excerpt':
    case 'figure':
    case 'walkthrough':
    case 'tabs':
    case 'details':
      return true;
    case 'paragraph':
    case 'list':
    case 'table':
    case 'quote':
    case 'alert':
    case 'footnotes':
      return linksToCodeOrTerm(block);
    case 'heading':
    case 'code':
    case 'rule':
    case 'suggestion':
    case 'glossary':
      return false;
    default:
      block satisfies never;
      throw new Error(`A kind of block Lo doesn't know: ${JSON.stringify(block)}.`);
  }
}

/** What a focused block's chip says, by its kind. */
export function blockHints(block: OverviewBlock): readonly BlockHint[] {
  switch (block.kind) {
    case 'excerpt':
      return [GO_TO_CODE, OPEN_BESIDE];
    case 'walkthrough':
      return [{ keys: [['←'], ['→']], label: 'Step' }, GO_TO_CODE, OPEN_BESIDE];
    case 'figure':
      return block.parts.length > 0 ? [{ keys: [['Tab']], label: 'Next part' }, FOLLOW] : [];
    case 'tabs':
      return [{ keys: [['←'], ['→']], label: 'Switch tabs' }];
    case 'details':
      return [{ keys: [['⏎']], label: 'Open or close' }];
    case 'paragraph':
    case 'list':
    case 'table':
    case 'quote':
    case 'alert':
    case 'footnotes':
      return [{ keys: [['Tab']], label: 'Next link' }, FOLLOW];
    case 'heading':
    case 'code':
    case 'rule':
    case 'suggestion':
    case 'glossary':
      return [];
    default:
      block satisfies never;
      throw new Error(`A kind of block Lo doesn't know: ${JSON.stringify(block)}.`);
  }
}

const GO_TO_CODE: BlockHint = { keys: [['⏎']], label: 'Go to code' };
const OPEN_BESIDE: BlockHint = { keys: [['o']], label: 'Open beside' };
const FOLLOW: BlockHint = { keys: [['⏎']], label: 'Follow' };

/**
 * Whether `block` holds a link to code or a term, however deep. It walks with an explicit stack,
 * so no tree can overflow it.
 */
function linksToCodeOrTerm(block: OverviewBlock): boolean {
  const stack: unknown[] = [block];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) stack.push(item);
      continue;
    }
    if (!isRecord(value)) continue;
    const node = value;
    const target = node['target'];
    if (node['kind'] === 'link' && isRecord(target)) {
      if (target['kind'] === 'code' || target['kind'] === 'term') return true;
    }
    for (const field of Object.values(node)) if (typeof field === 'object') stack.push(field);
  }
  return false;
}
