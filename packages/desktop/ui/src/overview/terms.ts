/**
 * The overview's glossary, as its document reads it: each defined term by its key, with ids of the
 * document's own for its entry, and the term the reader last went to from the text.
 */

import { createContext, useContext } from 'react';

import type { Definition, OverviewBlock } from '@lo/artifact';

import type { Anchors } from '../markdown/index.ts';

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

/** What the overview's glossary is, and which entry the reader went to. */
export interface GlossaryState {
  glossary: Glossary;
  /** The key of the term the reader went to from the text, drawn as the entry they reached. */
  target: string | undefined;
  /** The reader moved on from that entry. */
  leave: () => void;
  /** Where floating cards are put: an element inside `.lo-app`, or the page's body. */
  container: HTMLElement | null;
}

export const GlossaryContext = createContext<GlossaryState | undefined>(undefined);

export function useGlossary(): GlossaryState {
  const state = useContext(GlossaryContext);
  if (!state) throw new Error("An overview's terms are drawn only inside its document.");
  return state;
}
