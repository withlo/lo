// A term's tags, wherever it's drawn: its card's head and its row in a glossary. Each is a word,
// and a status tone only where it says one: what this pull request does to the term, whether it's
// locked, and the suggestions waiting on it.

import type { ReactNode } from 'react';

import { Icon } from '../Icon.tsx';
import { Tag } from '../Tag.tsx';

/** What a pull request does to a term: defines it for the first time, or changes its definition. */
export type TermMark = 'new' | 'changed';

/** What a term's tags say. */
export interface TermMarks {
  /**
   * New or Changed, on an open or draft pull request as the store is now, and on a merged or closed
   * one, or with no store, as the writer marked it. Nothing for a term this pull request leaves.
   */
  mark?: TermMark | undefined;
  /** Merged pull requests can't change it: they add suggestions instead. */
  locked?: boolean | undefined;
  /** How many suggestions merged pull requests left on it, a locked term: "2 suggestions". */
  suggestions?: number | undefined;
}

/** "1 suggestion", "2 suggestions". */
export function suggestionsCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'suggestion' : 'suggestions'}`;
}

/** A term's tags, in one order: New or Changed, then Locked, then its suggestions. */
export function TermTags({ mark, locked = false, suggestions = 0 }: TermMarks) {
  return (
    <>
      {mark === 'new' && <Tag tone="ok">New</Tag>}
      {mark === 'changed' && <Tag tone="warning">Changed</Tag>}
      {locked && (
        <Tag>
          <Icon name="lock" size={12} />
          Locked
        </Tag>
      )}
      {suggestions > 0 && <Tag tone="info">{suggestionsCount(suggestions)}</Tag>}
    </>
  );
}

/**
 * The definition a Changed term's replaces, under its own: the "Before" tag, then its words in
 * `lo-fg-muted`, running on from the tag as one paragraph, `lo-sp-6` under what's above it.
 */
export function TermBefore({ children }: { children: ReactNode }) {
  return (
    <div className="mt-6 text-fg-muted" data-lo-before="">
      <Tag>Before</Tag> {children}
    </div>
  );
}
