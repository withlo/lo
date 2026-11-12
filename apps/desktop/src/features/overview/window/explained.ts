// What an overview says of the lines of code it points at, for the diff's markers: each code block,
// walkthrough step, figure part and link to lines of code, with the section it's in and the words
// that point there, as plain text. Each is known by its block's place in the article, and a step's
// in its walkthrough, as "Read it in the overview" goes back to it. Plain functions, each tested
// alone.

import type { CodeRange, Overview, OverviewBlock, OverviewTree } from '@lo/artifact';
import { plainText, type Block, type Inline } from '@lo/markdown';

/** The most characters of a note's words: a longer paragraph is cut at a word, with an ellipsis. */
export const NOTE_LIMIT = 600;

/** The most characters of a section's name in a note's label. */
const SECTION_LIMIT = 120;

/** Lines of code the overview points at, and what it says of them. */
export interface Explanation {
  /** The article's block that points there, by its place among the tree's blocks. */
  readonly block: number;
  /** The walkthrough step that points there, or holds the link that does, by its place. */
  readonly step?: number | undefined;
  readonly target: CodeRange;
  /** The section it's in: the last `##` heading before its block, as plain text; or none. */
  readonly section: string;
  /**
   * What points there, as plain text: the paragraph a link is in, the prose around a code block,
   * a step's words or a figure's caption.
   */
  readonly text: string;
}

/** Where in the article what's read is. */
interface Where {
  readonly block: number;
  readonly step?: number | undefined;
  readonly section: string;
}

/** What's left to read: a block among its siblings, or inlines, with the words of what holds them. */
type Work =
  | {
      readonly kind: 'block';
      readonly blocks: readonly OverviewBlock[];
      readonly at: number;
      readonly where: Where;
    }
  | {
      readonly kind: 'inlines';
      readonly inlines: readonly Inline<Overview>[];
      readonly where: Where;
      readonly text: string;
    };

type Add = (where: Where, target: CodeRange, text: string) => void;

/** What a code block says with no prose around it. */
const BLOCK_WORDS = 'A code block in the overview shows these lines.';
/** What a walkthrough's step says with no words of its own. */
const STEP_WORDS = 'A step of a walkthrough in the overview shows these lines.';
/** What a figure's part says with no caption. */
const FIGURE_WORDS = 'A figure in the overview points at these lines.';

/**
 * Everything in `tree` that points at lines of code, each once for its block and step, block by
 * block. It walks with an explicit stack, so no tree can overflow it.
 */
export function explanationsOf(tree: OverviewTree): Explanation[] {
  const found: Explanation[] = [];
  const seen = new Set<string>();
  const add: Add = (where, { path, lines: { start, end } }, text) => {
    const key = JSON.stringify([where.block, where.step, path, start, end]);
    if (seen.has(key)) return;
    seen.add(key);
    found.push({ ...where, target: { kind: 'code', path, lines: { start, end } }, text });
  };
  let section = '';
  tree.blocks.forEach((node, block) => {
    if (node.kind === 'heading' && node.level === 2) section = textOf([node], SECTION_LIMIT);
    const stack: Work[] = [
      { kind: 'block', blocks: tree.blocks, at: block, where: { block, section } },
    ];
    while (stack.length > 0) {
      const work = stack.pop()!;
      if (work.kind === 'inlines') {
        readInlines(work, add);
        continue;
      }
      // What's inside, last first, so the stack gives it back in order.
      const inside = read(work, add);
      for (let at = inside.length - 1; at >= 0; at--) stack.push(inside[at]!);
    }
  });
  return found;
}

/** The blocks in `blocks`, each among its siblings, to read. */
function each(blocks: readonly OverviewBlock[], where: Where): Work[] {
  return blocks.map((_, at) => ({ kind: 'block', blocks, at, where }));
}

/**
 * Reads a block: what it points at itself, as a code block, step or figure part does. Returns
 * what's left to read inside it, in order.
 */
function read(work: Extract<Work, { kind: 'block' }>, add: Add): Work[] {
  const { blocks, at, where } = work;
  const node = blocks[at];
  if (!node) return [];
  switch (node.kind) {
    case 'paragraph':
    case 'heading':
      return [{ kind: 'inlines', inlines: node.children, where, text: textOf([node]) }];
    case 'quote':
    case 'alert':
      return each(node.children, where);
    case 'list':
    case 'footnotes':
      return node.items.flatMap((item) => each(item.children, where));
    case 'table':
      return [node.head, ...node.rows].flatMap((row) => {
        const text = textOf(row.map((cell) => paragraph(cell)));
        return row.map((cell): Work => ({ kind: 'inlines', inlines: cell, where, text }));
      });
    case 'details':
      return [
        { kind: 'inlines', inlines: node.summary, where, text: textOf([paragraph(node.summary)]) },
        ...each(node.children, where),
      ];
    case 'excerpt':
      add(where, node.target, proseAround(blocks, at) || BLOCK_WORDS);
      return [];
    case 'walkthrough':
      return node.steps.flatMap((step, index) => {
        const inStep = { ...where, step: index };
        add(inStep, step.target, textOf(step.children) || STEP_WORDS);
        return each(step.children, inStep);
      });
    case 'figure': {
      const caption = textOf(node.caption);
      for (const { target } of node.parts) {
        if (target.kind === 'code' && target.lines) {
          add(where, { ...target, lines: target.lines }, caption || FIGURE_WORDS);
        }
      }
      return each(node.caption, where);
    }
    case 'tabs':
      return node.tabs.flatMap((tab) => each(tab.children, where));
    case 'glossary':
      return node.terms.flatMap((term) => each(term.children, where));
    case 'code':
    case 'rule':
    case 'suggestion':
      return [];
    default:
      // From the parse, which makes only the kinds above: nothing to point at.
      node satisfies never;
      return [];
  }
}

/** Reads inlines for links to lines of code, each said with the words of what holds it. */
function readInlines(work: Extract<Work, { kind: 'inlines' }>, add: Add): void {
  const { where, text } = work;
  // Last first, so the first written is read first.
  const pending = work.inlines.toReversed();
  while (pending.length > 0) {
    const inline = pending.pop()!;
    if (inline.kind === 'link' && inline.target.kind === 'code' && inline.target.lines) {
      add(where, { ...inline.target, lines: inline.target.lines }, text);
    }
    if ('children' in inline) {
      for (let at = inline.children.length - 1; at >= 0; at--) pending.push(inline.children[at]!);
    }
  }
}

/**
 * The prose a code block at `at` among `blocks` goes with: the paragraph, list or quote nearest
 * before it within its section, or else after it; none when there's none.
 */
function proseAround(blocks: readonly OverviewBlock[], at: number): string {
  for (const step of [-1, 1]) {
    for (let index = at + step; index >= 0 && index < blocks.length; index += step) {
      const node = blocks[index]!;
      if (node.kind === 'heading') break;
      if (isProse(node)) return textOf([node]);
    }
  }
  return '';
}

function isProse(node: OverviewBlock): boolean {
  return (
    node.kind === 'paragraph' ||
    node.kind === 'list' ||
    node.kind === 'quote' ||
    node.kind === 'alert'
  );
}

function paragraph(children: Inline<Overview>[]): Block<Overview> {
  return { kind: 'paragraph', children };
}

/**
 * `blocks`' words on one line, at most `limit` characters of them: a longer text is cut at a word,
 * with an ellipsis.
 */
function textOf(blocks: readonly Block<Overview>[], limit = NOTE_LIMIT): string {
  const text = plainText({ blocks: [...blocks], notes: [], diagnostics: [] }, limit + 1);
  if (text.length <= limit) return text;
  const space = text.lastIndexOf(' ', limit - 1);
  let end = space > limit / 2 ? space : limit - 1;
  // Never half of a character a surrogate pair makes.
  if (/[\uD800-\uDBFF]/.test(text.charAt(end - 1))) end -= 1;
  return `${text.slice(0, end).trimEnd()}…`;
}

/**
 * The id a marker gives back for what explains its lines, as "Read it in the overview" asks for
 * it: the number Lo gave the tree, the block's place in it, and a step's in its walkthrough.
 */
export function explainedId(
  tree: number,
  explanation: Pick<Explanation, 'block' | 'step'>,
): string {
  const { block, step } = explanation;
  return step === undefined ? `${tree}.${block}` : `${tree}.${block}.${step}`;
}

/** What an id `explainedId` made names, if it's one. */
export function readExplainedId(
  id: string,
): { readonly tree: number; readonly block: number; readonly step?: number } | undefined {
  const match = /^(\d{1,9})\.(\d{1,9})(?:\.(\d{1,9}))?$/.exec(id);
  if (!match) return undefined;
  const [, tree, block, step] = match;
  return step === undefined
    ? { tree: Number(tree), block: Number(block) }
    : { tree: Number(tree), block: Number(block), step: Number(step) };
}
