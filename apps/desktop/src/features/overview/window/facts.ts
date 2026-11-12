// What a tab's overview is, as the window knows it: read from what main said of it and what the
// window's check found. The view, the view switch's mark, the status bar and the prompts all draw
// from this, so they never disagree. Plain functions, each tested alone.

import type { Finding, Header, ParsedArtifact, Sizes } from '@lo/artifact';

import type { ComparisonView } from '../../revisions/contract.ts';
import type { PullView } from '../../tab/contract.ts';
import type { OverviewCommit, OverviewState, Problem } from '../contract.ts';
import type { CheckedOverview } from './checking.ts';
import type { PromptKind } from './prompts.ts';

/** An overview checked, which Lo shows. */
export type Checked = Extract<CheckedOverview, { kind: 'checked' }>;

/**
 * A tab's overview, as far as the window knows:
 *
 * - `reading`: main hasn't said what the ref holds yet, and kept nothing from before;
 * - `none`: the ref holds no overview: nothing, or something other than a commit (`notCommit`);
 * - `failed`: main couldn't read the ref, and has nothing to show;
 * - `checking`: main read the overview, and the window hasn't checked it yet;
 * - `unchecked`: the window couldn't check it, and why;
 * - `invalid`, `tooLarge`, `newer`: it can't be shown, as its check found;
 * - `shown`: it shows, as its check left it.
 */
export type Standing =
  | { kind: 'reading' }
  | { kind: 'none'; notCommit: boolean }
  | { kind: 'failed'; problem: Problem }
  | { kind: 'checking'; commit: OverviewCommit }
  | { kind: 'unchecked'; commit: OverviewCommit; why: string }
  | { kind: 'invalid'; commit: OverviewCommit; findings: readonly Finding[] }
  | {
      kind: 'tooLarge';
      commit: OverviewCommit;
      what: 'text' | 'entries' | 'bytes';
      sizes: Sizes;
    }
  | { kind: 'newer'; commit: OverviewCommit; format: number }
  | {
      kind: 'shown';
      commit: OverviewCommit;
      header: Header;
      parsed: ParsedArtifact;
      result: Checked;
    };

/** What a tab's overview is, from what main last said of it and what the window's check found. */
export function standingOf(
  state: OverviewState | undefined,
  result: CheckedOverview | undefined,
): Standing {
  const commit = state?.overview ?? undefined;
  if (!state || !commit) {
    // What the last read that went through found stands while a later one fails.
    if (state?.found === 'none') return { kind: 'none', notCommit: false };
    if (state?.found === 'notCommit') return { kind: 'none', notCommit: true };
    if (state?.problem) return { kind: 'failed', problem: state.problem };
    return { kind: 'reading' };
  }
  // A result for another commit is the last one's, and says nothing of this one yet.
  if (result?.commit.id !== commit.id || result.commit.source !== commit.source) {
    return { kind: 'checking', commit };
  }
  if (result.kind === 'failed') return { kind: 'unchecked', commit, why: result.why };
  const { outcome, findings } = result.checked;
  switch (outcome.kind) {
    case 'invalid':
      return { kind: 'invalid', commit, findings };
    case 'tooLarge':
      return { kind: 'tooLarge', commit, what: outcome.what, sizes: outcome.sizes };
    case 'newer':
      return { kind: 'newer', commit, format: outcome.format };
    case 'shown':
      // A shown overview was parsed: its text is what was checked.
      if (!result.parsed) {
        return { kind: 'unchecked', commit, why: "Lo couldn't read artifact.md." };
      }
      return { kind: 'shown', commit, header: outcome.header, parsed: result.parsed, result };
    default:
      // From the background process: say so, rather than show what Lo doesn't know.
      outcome satisfies never;
      return { kind: 'unchecked', commit, why: "Lo couldn't tell what the check found." };
  }
}

/**
 * What the tab can tell from `standing` about opening on the overview: nothing yet (`unknown`),
 * that it shows (`shown`), or that it doesn't (`other`): there's none, it can't be shown, or it
 * couldn't be read. A check that failed says nothing yet: it's tried again when main next speaks,
 * as when main can hand over the overview's files only once it knows the tab's account.
 */
export type Known = 'unknown' | 'shown' | 'other';

export function knownOf(standing: Standing): Known {
  switch (standing.kind) {
    case 'reading':
    case 'checking':
    case 'unchecked':
      return 'unknown';
    case 'shown':
      return 'shown';
    case 'none':
    case 'failed':
    case 'invalid':
    case 'tooLarge':
    case 'newer':
      return 'other';
    default:
      standing satisfies never;
      throw new Error(`An overview's standing Lo doesn't know: ${JSON.stringify(standing)}.`);
  }
}

/**
 * The view switch's mark for the overview: there's none (`none`), it's there and describes the
 * newest push (`current`), it's out of date (`stale`), or it can't be shown (`error`). None while
 * Lo is still finding out.
 */
export type MarkKind = 'none' | 'current' | 'stale' | 'error';

/** The pull request's newest head, as its tab knows it: a newer push, else the head on screen. */
export function newestHead(pull: PullView | undefined): string | undefined {
  return pull?.newer ?? pull?.shown ?? undefined;
}

export function markOf(standing: Standing, newest: string | undefined): MarkKind | undefined {
  switch (standing.kind) {
    case 'reading':
    case 'checking':
      return undefined;
    case 'none':
    case 'failed':
      return 'none';
    case 'unchecked':
    case 'invalid':
    case 'tooLarge':
    case 'newer':
      return 'error';
    case 'shown':
      return newest !== undefined && standing.header.commit !== newest ? 'stale' : 'current';
    default:
      standing satisfies never;
      throw new Error(`An overview's standing Lo doesn't know: ${JSON.stringify(standing)}.`);
  }
}

/** What the view switch's mark says, to a screen reader and on hover. */
export function markWords(mark: MarkKind): string {
  switch (mark) {
    case 'none':
      return 'No overview yet';
    case 'current':
      return 'Overview';
    case 'stale':
      return 'Overview, out of date';
    case 'error':
      return "Overview, can't be shown";
    default:
      mark satisfies never;
      throw new Error(`A mark Lo doesn't know: ${String(mark)}.`);
  }
}

/** The prompt each standing offers: to write, update, fix or shrink the overview, or none. */
export function promptKindOf(standing: Standing): PromptKind | undefined {
  switch (standing.kind) {
    case 'none':
      return 'write';
    case 'shown':
      return 'update';
    case 'invalid':
      return 'fix';
    case 'tooLarge':
      return 'shrink';
    case 'reading':
    case 'checking':
    case 'failed':
    case 'unchecked':
    case 'newer':
      return undefined;
    default:
      standing satisfies never;
      throw new Error(`An overview's standing Lo doesn't know: ${JSON.stringify(standing)}.`);
  }
}

/** A revision, by its head, with its number when Lo numbered it: `r3` is number 3. */
export interface Revision {
  readonly head: string;
  readonly number: number | undefined;
}

/** The revision whose head is `head`, if the tab's revisions have one. */
export function revisionAt(
  revisions: ComparisonView | undefined,
  head: string | undefined,
): Revision | undefined {
  if (head === undefined) return undefined;
  const found = revisions?.revisions.find((each) => each.head === head);
  return found && { head, number: found.number ?? undefined };
}
