/**
 * Builds the format's nodes from the tokens `Reading` marked, through `@lo/markdown`'s handlers,
 * which get each block's contents already built. A step, a tab, a glossary item and a figure's
 * parts aren't blocks of their own: each is built as a stand-in, which the block holding it takes
 * in. `settle` then takes any stand-in left anywhere out of the tree, so what's returned holds only
 * the kinds the tree's types list.
 */

import type { Block, Extension, Syntax, Tree } from '@lo/markdown';

import type { BlockMeta, Reading } from './reading.ts';
import { fences, GLOSSARY_OPEN, OPEN, PART_OPEN, PARTS_OPEN, TERM_OPEN } from './syntax.ts';
import type {
  Definition,
  FigurePart,
  Overview,
  OverviewBlock,
  OverviewTree,
  Step,
  Tab,
} from './tree.ts';

const STEP = 'lo:step';
const TAB = 'lo:tab';
const DEFINITION = 'lo:definition';
const PARTS = 'lo:parts';
const PART = 'lo:part';

type Standin =
  | { kind: typeof STEP; step: Step }
  | { kind: typeof TAB; tab: Tab }
  | { kind: typeof DEFINITION; definition: Definition }
  | { kind: typeof PARTS; parts: FigurePart[] }
  | { kind: typeof PART; part: FigurePart };

/** The tree as it's built: the format's nodes, and the stand-ins on their way into them. */
export interface Building extends Extension {
  block: Overview['block'] | Standin;
  inline: never;
  target: Overview['target'];
}

type Built = Block<Building>;

/** The syntax `markdownTree` reads an overview with, marked and checked by `reading`. */
export function syntax(reading: Reading): Syntax<Building> {
  return {
    plugins: [
      fences,
      (md) => {
        // Before markdown-it joins the text, which would hide an escape: `\[a\](b c)` isn't a link.
        md.core.ruler.before('text_join', 'lo_unread', (state) => {
          reading.unreadLinks(state.tokens);
        });
        md.core.ruler.push('lo_reading', (state) => {
          reading.read(state.tokens);
        });
      },
    ],
    blocks: {
      [OPEN]: (token, children) => block(reading.blocks.get(token), children),
      [GLOSSARY_OPEN]: (_token, children) => ({
        kind: 'glossary',
        terms: children.flatMap((child) => (child.kind === DEFINITION ? [child.definition] : [])),
      }),
      [TERM_OPEN]: (token, children) => {
        const term = reading.terms.get(token);
        if (!term) return undefined;
        return { kind: DEFINITION, definition: { ...term, children: settled(children) } };
      },
      [PARTS_OPEN]: (_token, children) => ({
        kind: PARTS,
        parts: children.flatMap((child) => (child.kind === PART ? [child.part] : [])),
      }),
      [PART_OPEN]: (token, children) => {
        const id = reading.parts.get(token);
        const paragraph = children.length === 1 ? children[0] : undefined;
        const link = paragraph?.kind === 'paragraph' ? paragraph.children : [];
        const only = link.length === 1 ? link[0] : undefined;
        // A link Lo didn't keep, such as one to a section that isn't there, leaves no part.
        if (id === undefined || only?.kind !== 'link') return undefined;
        return { kind: PART, part: { id, target: only.target } };
      },
    },
    // Only the links to code and terms reading kept, each address read once.
    link: (href) => reading.claim(href),
  };
}

/** The block `meta` describes, holding `children`; or, without one, its children in its place. */
function block(meta: BlockMeta | undefined, children: Built[]): Built | undefined {
  if (!meta) return undefined;
  switch (meta.kind) {
    case 'code':
      return { kind: 'excerpt', target: meta.target };
    case 'figure':
      return {
        kind: 'figure',
        path: meta.path,
        caption: settled(children.filter((child) => child.kind !== PARTS)),
        parts: children.flatMap((child) => (child.kind === PARTS ? child.parts : [])),
      };
    case 'walkthrough':
      return {
        kind: 'walkthrough',
        title: meta.title,
        steps: children.flatMap((child) => (child.kind === STEP ? [child.step] : [])),
      };
    case 'step':
      return { kind: STEP, step: { target: meta.target, children: settled(children) } };
    case 'tabs':
      return {
        kind: 'tabs',
        tabs: children.flatMap((child) => (child.kind === TAB ? [child.tab] : [])),
      };
    case 'tab':
      return { kind: TAB, tab: { title: meta.title, children: settled(children) } };
    case 'fold':
      return {
        kind: 'details',
        open: false,
        summary: meta.title === '' ? [] : [{ kind: 'text', value: meta.title }],
        children,
      };
    default:
      meta satisfies never;
      throw new Error(`Unknown block ${JSON.stringify(meta)}`);
  }
}

/**
 * `children` as the finished tree's blocks: without stand-ins, which only the blocks that take
 * them in hold. One inside them is taken out by `settle` before the tree is returned.
 */
function settled(children: Built[]): OverviewBlock[] {
  return children.filter(isSettled);
}

function isSettled(built: Built): built is OverviewBlock {
  return !isStandin(built);
}

const STANDINS = new Set<unknown>([STEP, TAB, DEFINITION, PARTS, PART]);

/**
 * `tree` with every stand-in left in it replaced: a step, tab or glossary item by its contents,
 * and a figure's parts by nothing. None should be left, as each is built inside the block that
 * takes it in; this makes sure, with an explicit stack.
 */
export function settle(tree: Tree<Building>): OverviewTree {
  const stack: unknown[] = [tree.blocks];
  while (stack.length > 0) {
    const value = stack.pop();
    if (Array.isArray(value)) {
      const items: unknown[] = value;
      if (items.some(isStandin)) {
        const kept = items.flatMap((item) => (isStandin(item) ? contents(item) : [item]));
        items.length = 0;
        for (const item of kept) items.push(item);
      }
      for (const item of items) stack.push(item);
    } else if (typeof value === 'object' && value !== null) {
      for (const field of Object.values(value)) {
        if (typeof field === 'object' && field !== null) stack.push(field);
      }
    }
  }
  return { blocks: settled(tree.blocks), notes: tree.notes, diagnostics: tree.diagnostics };
}

function isStandin(value: unknown): value is Standin {
  return typeof value === 'object' && value !== null && 'kind' in value && STANDINS.has(value.kind);
}

function contents(standin: Standin): OverviewBlock[] {
  switch (standin.kind) {
    case STEP:
      return standin.step.children;
    case TAB:
      return standin.tab.children;
    case DEFINITION:
      return standin.definition.children;
    case PARTS:
    case PART:
      return [];
    default:
      standin satisfies never;
      throw new Error(`Unknown stand-in ${JSON.stringify(standin)}`);
  }
}
