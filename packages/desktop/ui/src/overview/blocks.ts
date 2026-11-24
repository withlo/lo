/**
 * The overview's blocks: which of the article's blocks the block keys stop at, and what a focused
 * one says it can do. A block's number is its place among the article's blocks, Lo's own, never a
 * path, an id or a heading from the overview.
 */

import type { OverviewBlock } from '@lo/artifact';

import type { Target } from '../commands/targets.ts';
import { secureLink } from '../markdown/links.ts';
import { isRecord } from '../markdown/scope.ts';

/**
 * One of the buttons on a focused block's chip: a command of the overview's that runs on the block,
 * by its id, which the chip draws with its label and its key.
 */
export interface BlockHint {
  /** The command, by its id: `overview.follow`. */
  readonly command: string;
  /** What it runs on, as a key pressed on the block would: the block, as the app names it. */
  readonly target?: Target | undefined;
}

/**
 * Whether the block keys stop at `block`: it holds something to act on. Code, figures,
 * walkthroughs, tabs and folds always do; prose, the glossary among it, does when it holds a link:
 * to code, a term, a section, a note or a web page Lo opens.
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
    case 'glossary':
      return holdsLink(block);
    case 'heading':
    case 'code':
    case 'rule':
    case 'suggestion':
      return false;
    default:
      block satisfies never;
      throw new Error(`A kind of block Lo doesn’t know: ${JSON.stringify(block)}.`);
  }
}

/**
 * What a focused block's chip offers, by its kind: the commands its keys run there. A fold's one
 * command reads as what it does to the fold, "Expand" or "Collapse".
 */
export function blockHints(block: OverviewBlock): readonly BlockHint[] {
  switch (block.kind) {
    case 'excerpt':
      return [FOLLOW, BESIDE];
    case 'walkthrough':
      return [STEP, FOLLOW, BESIDE];
    case 'figure':
      return block.parts.length > 0 ? [LINK, FOLLOW] : [];
    case 'tabs':
      return [STEP];
    case 'details':
      return [FOLLOW];
    case 'paragraph':
    case 'list':
    case 'table':
    case 'quote':
    case 'alert':
    case 'footnotes':
    case 'glossary':
      return [LINK, FOLLOW];
    case 'heading':
    case 'code':
    case 'rule':
    case 'suggestion':
      return [];
    default:
      block satisfies never;
      throw new Error(`A kind of block Lo doesn’t know: ${JSON.stringify(block)}.`);
  }
}

const FOLLOW: BlockHint = { command: 'overview.follow' };
const BESIDE: BlockHint = { command: 'overview.beside' };
const STEP: BlockHint = { command: 'overview.nextStep' };
const LINK: BlockHint = { command: 'overview.nextLink' };

/**
 * Whether `block` holds a link, however deep: one the overview draws as a link, so a web page only
 * when it's `https://`. It walks with an explicit stack, so no tree can overflow it.
 */
function holdsLink(block: OverviewBlock): boolean {
  const stack: unknown[] = [block];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      for (const item of value as unknown[]) stack.push(item);
      continue;
    }
    if (!isRecord(value)) continue;
    if (isLink(value)) return true;
    for (const field of Object.values(value)) if (typeof field === 'object') stack.push(field);
  }
  return false;
}

/** Whether `node`, in a block, is drawn as a link: a link, an image, a mention or a note's mark. */
function isLink(node: Record<string, unknown>): boolean {
  const { kind, target, url } = node;
  if (kind === 'footnoteReference') return true;
  if ((kind === 'image' || kind === 'mention') && typeof url === 'string') {
    return secureLink(url) !== undefined;
  }
  if (kind !== 'link' || !isRecord(target)) return false;
  if (target['kind'] === 'web') {
    return typeof target['url'] === 'string' && secureLink(target['url']) !== undefined;
  }
  return true;
}
