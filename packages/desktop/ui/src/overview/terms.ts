/**
 * The overview's glossary, as its document reads it: each defined term by its key, with ids of the
 * document's own for its entry; what shows for each with the repo's definitions, and whether the
 * reader ignores it; the term's menu and its card's hints; and the term the reader last went to
 * from the text.
 */

import { createContext, useContext, type ReactNode, type RefObject } from 'react';

import type { Definition, OverviewBlock } from '@lo/artifact';

import type { Anchors } from '../markdown/index.ts';
import type { TermBylineShown } from './TermByline.tsx';
import type { TermHint } from './TermCard.tsx';
import type { TermMarks } from './TermTags.tsx';

export interface Glossary {
  /** The term `key` names, when the glossary defines it. */
  definition(key: string): Definition | undefined;
  /** The id of `key`'s entry, its term, when the glossary defines it. */
  termId(key: string): string | undefined;
  /** The id of `key`'s definition in the glossary, which its uses are described by. */
  definitionId(key: string): string | undefined;
}

/**
 * The glossary of `blocks`, an overview's: the terms of its `glossary` blocks, each key once, the
 * first definition kept.
 */
export function readGlossary(blocks: readonly OverviewBlock[], anchors: Anchors): Glossary {
  const terms = new Map<string, { definition: Definition; number: number }>();
  for (const block of blocks) {
    if (block.kind !== 'glossary') continue;
    for (const definition of block.terms) {
      if (!terms.has(definition.key)) terms.set(definition.key, { definition, number: terms.size });
    }
  }
  return {
    definition: (key) => terms.get(key)?.definition,
    termId: (key) => {
      const term = terms.get(key);
      return term && anchors.own(`term${term.number}`);
    },
    definitionId: (key) => {
      const term = terms.get(key);
      return term && anchors.own(`definition${term.number}`);
    },
  };
}

/** `terms` in alphabetical order, by name: the glossary's order, whatever order they were written. */
export function alphabetical(terms: readonly Definition[]): Definition[] {
  return terms.toSorted((a, b) => COLLATOR.compare(a.name, b.name));
}

const COLLATOR = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/**
 * What an overview shows for one of its terms, as whoever reads the repo's definitions says: whose
 * definition shows, its tags, the definition a Changed term replaces, and who it's by.
 */
export interface TermShown {
  /**
   * Whose definition shows: the repo's (`store`), which its card shows whole, or the overview's
   * own (`overview`), which its card shows the first paragraph of.
   */
  readonly source: 'store' | 'overview';
  /** Its name: as the overview's glossary writes it, else as the repo's definitions do. */
  readonly name: string;
  /** The definition that shows. */
  readonly blocks: readonly OverviewBlock[];
  /** Its tags: New or Changed, Locked, and the suggestions waiting on it. */
  readonly marks: TermMarks;
  /** On a Changed term, the definition it replaces, where that's known. */
  readonly before?: readonly OverviewBlock[] | undefined;
  /**
   * Who the definition is by, or that the repo's definitions are still being read. None for a term
   * they don't hold.
   */
  readonly byline?: TermBylineShown | undefined;
  /**
   * The reader ignores it, in this repo or every repo: it's plain text wherever it's used, with no
   * underline, card or stop for `Tab`, and its row waits in the Glossary section's Ignored group.
   */
  readonly ignored?: boolean | undefined;
}

/**
 * A term's menu, kept by whoever shows the overview: what a right-click on a term or its row lists,
 * and what its card's `⋯` and a right-click on its card open, since the card is put elsewhere in
 * the page. A term's card stays open while its menu is.
 */
export interface TermMenu {
  /**
   * Opens the menu of the term `key` names at `at`, for the term `from`, as drawn in the text. Says
   * whether it did.
   */
  readonly open: (key: string, from: Element | null, at: { x: number; y: number }) => boolean;
  /**
   * Whether the menu of the term `key` names is open now, for its use `element` in the text: a term
   * used more than once has its menu on one use at a time.
   */
  readonly isOpen: (key: string, element: Element | null) => boolean;
  /** Calls `listener` as a term's menu opens or closes. Returns a function that stops it. */
  readonly subscribe: (listener: () => void) => () => void;
}

/** The repo's definitions, as an overview shows its terms with them. */
export interface OverviewTerms {
  /**
   * What shows for the term `key` names. None for a term only the overview defines that nothing
   * tags: its own definition shows, as with no repo definitions at all.
   */
  of(key: string): TermShown | undefined;
  /**
   * What the Glossary section says under its heading, before its terms: why the repo's
   * definitions can't be used, so each definition is the overview's own.
   */
  readonly note?: ReactNode;
  /** The terms' menu. Without it, a term has none, and its card and row no `⋯`. */
  readonly menu?: TermMenu | undefined;
  /**
   * The hints in the foot of the card of the term `key` names: "Edit…" `i`. Each shows only while
   * its command can run.
   */
  readonly hints?: ((key: string) => readonly TermHint[]) | undefined;
  /**
   * "Stop ignoring" was pressed on the row of the term `key` names, in the Ignored group: both its
   * switches turn off.
   */
  readonly stopIgnoring?: ((key: string) => void) | undefined;
}

/** What marks a term the reader can act on, in the text or as a glossary's row: its key. */
export const TERM_ATTRIBUTE = 'data-lo-term';

/** A term as a key or a right-click finds it in the page. */
export interface TermAt {
  /** Its key, as `term:` links name it. */
  readonly key: string;
  /** What's drawn for it: the term in the text, or its row. */
  readonly element: HTMLElement;
  /** It's a glossary's row, not a use in the text. */
  readonly row: boolean;
}

/**
 * The term `element` is, or is in: a use of one in the text, or a glossary's row, the innermost,
 * as a term in a row's definition is. A term shown as plain text, which the reader ignores, isn't
 * one.
 */
export function termAt(element: Element | null): TermAt | undefined {
  const found = element?.closest<HTMLElement>(`[${TERM_ATTRIBUTE}]`);
  const key = found?.getAttribute(TERM_ATTRIBUTE);
  if (!found || key === null || key === undefined) return undefined;
  return { key, element: found, row: found.hasAttribute('data-lo-term-row') };
}

/** What the overview's glossary is, and where its terms' cards go. */
export interface GlossaryState {
  glossary: Glossary;
  /** The repo's definitions, as the overview shows them, once whoever shows it knows them. */
  terms?: OverviewTerms | undefined;
  /**
   * Where floating cards are put: an element inside `.lo-app`, or the page's body. A ref, read as
   * a card opens, so finding it after the document is drawn draws nothing again.
   */
  container: RefObject<HTMLElement | null>;
}

/**
 * The entry the reader went to from a term in the text, kept apart from the glossary itself so
 * that only the glossary draws again when it changes, not every term.
 */
export interface Reached {
  /** The key of the term the reader went to, drawn as the entry they reached. */
  target: string | undefined;
  /** The reader moved on from that entry. */
  leave: () => void;
}

export const GlossaryContext = createContext<GlossaryState | undefined>(undefined);
export const ReachedContext = createContext<Reached>({ target: undefined, leave: () => undefined });

export function useGlossary(): GlossaryState {
  const state = useContext(GlossaryContext);
  if (!state) throw new Error('An overview’s terms are drawn only inside its document.');
  return state;
}
