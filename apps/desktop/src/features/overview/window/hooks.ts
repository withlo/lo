// What the overview's views read of a tab, re-rendering as it changes.

import { useEffect, useMemo, useState } from 'react';

import { usePull, useTabState } from '../../tab/window/shared.ts';
import { definitionsOf, glossaryOf, type Definitions, type Subject } from './definitions.ts';
import { standingOf, type Standing } from './facts.ts';
import { stackChecked, stackStates, subjects, withLayersShown, type Showing } from './stack.ts';
import { checked, states } from './store.ts';
import { terms, type RepoTerms } from './terms.ts';

/** What tab `tab`'s overview is now, from what main said and what the check found. */
export function useStanding(tab: string): Standing {
  const state = useTabState(states, tab);
  const result = useTabState(checked, tab);
  return useMemo(() => standingOf(state, result), [state, result]);
}

/**
 * What the overview of the stack tab `tab`'s layer is in is now, as {@link useStanding} says, with
 * its Layers section in its tree once it shows.
 */
export function useStackStanding(tab: string): Standing {
  const state = useTabState(stackStates, tab);
  const result = useTabState(stackChecked, tab);
  return useMemo(() => withLayersShown(standingOf(state, result)), [state, result]);
}

/** What tab `tab`'s Overview shows: its stack's overview only while the stack has one. */
export function useSubject(tab: string): Showing {
  const subject = useTabState(subjects, tab);
  const present = useTabState(stackStates, tab, (state) => (state?.overview ?? null) !== null);
  return subject === 'stack' && present ? 'stack' : 'pull';
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
export function useDefinitions(tab: string, showing: Showing = 'pull'): Definitions | undefined {
  const own = useStanding(tab);
  const stack = useStackStanding(tab);
  const standing = showing === 'stack' ? stack : own;
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
