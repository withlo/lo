// What the overview's views read of a tab, re-rendering as it changes.

import { useEffect, useMemo, useState } from 'react';

import type { PullState } from '../../tab/contract.ts';
import { pullOf, usePull, useTabState, type PullTab } from '../../tab/window/shared.ts';
import { definitionsOf, glossaryOf, type Definitions, type Subject } from './definitions.ts';
import { standingOf, type Standing } from './facts.ts';
import { ignoredKeys, ignoring, useIgnoredKeys } from './ignored.ts';
import { repoOf } from './sections.ts';
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
 * what a changed one replaces, and whether the reader ignores it in the tab's repo. None until the
 * overview shows. Until GitHub has said what state the pull request is in, it's taken as open.
 */
export function useDefinitions(tab: PullTab): Definitions | undefined {
  const standing = useStanding(tab.id);
  const read = useTerms(tab.id);
  const state = usePull(tab.id)?.header?.state ?? 'open';
  const ignored = useIgnoredKeys(repoOf(tab));
  const shown = standing.kind === 'shown' ? standing : undefined;
  const blocks = shown?.parsed.tree.blocks;
  const entries = shown?.parsed.glossary;
  const pr = shown?.header.pr;
  return useMemo(() => {
    if (!blocks || !entries) return undefined;
    return definitionsOf(glossaryOf(blocks), entries, read, subjectOf(pr, state), ignored);
  }, [blocks, entries, pr, state, read, ignored]);
}

/** As {@link useDefinitions}, read once: what a command on one of its terms acts on. */
export function definitionsNow(tab: PullTab): Definitions | undefined {
  const standing = standingOf(states.get(tab.id), checked.get(tab.id));
  if (standing.kind !== 'shown') return undefined;
  const state = pullOf(tab.id)?.header?.state ?? 'open';
  const ignored = ignoredKeys(ignoring.shownNow(), repoOf(tab));
  const { parsed, header } = standing;
  return definitionsOf(
    glossaryOf(parsed.tree.blocks),
    parsed.glossary,
    terms.get(tab.id),
    subjectOf(header.pr, state),
    ignored,
  );
}

/** What an overview is of, for its terms' tags: pull request `pr`, in `state`, or else a stack. */
function subjectOf(pr: number | undefined, state: PullState): Subject {
  return pr === undefined ? { kind: 'stack' } : { kind: 'pull', number: pr, state };
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
