// What the overview's views read of a tab, re-rendering as it changes.

import { useEffect, useMemo, useState } from 'react';

import { usePull, useTabState } from '../../tab/window/shared.ts';
import { definitionsOf, glossaryOf, type Definitions, type Subject } from './definitions.ts';
import { standingOf, type Standing } from './facts.ts';
import { checked, states } from './store.ts';
import { terms, type RepoTerms } from './terms.ts';

/** What tab `tab`'s overview is now, from what main said and what the check found. */
export function useStanding(tab: string): Standing {
  const state = useTabState(states, tab);
  const result = useTabState(checked, tab);
  return useMemo(() => standingOf(state, result), [state, result]);
}

/** Tab `tab`'s repository's definitions, as far as the window knows. */
export function useTerms(tab: string): RepoTerms {
  return useTabState(terms, tab);
}

/**
 * The definitions tab `tab`'s overview shows, once it shows: which shows for each term, its tags,
 * and what a changed one replaces. None until the overview shows. Until GitHub has said what state
 * the pull request is in, it's taken as open.
 */
export function useDefinitions(tab: string): Definitions | undefined {
  const standing = useStanding(tab);
  const read = useTerms(tab);
  const state = usePull(tab)?.header?.state ?? 'open';
  const shown = standing.kind === 'shown' ? standing : undefined;
  const blocks = shown?.parsed.tree.blocks;
  const entries = shown?.parsed.glossary;
  const pr = shown?.header.pr;
  return useMemo(() => {
    if (!blocks || !entries) return undefined;
    const subject: Subject =
      pr === undefined ? { kind: 'stack' } : { kind: 'pull', number: pr, state };
    return definitionsOf(glossaryOf(blocks), entries, read, subject);
  }, [blocks, entries, pr, state, read]);
}

/** The time now, ticking every `every` milliseconds while `ticking`, for what counts or ages. */
export function useNow(ticking: boolean, every = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return undefined;
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [ticking, every]);
  return now;
}
