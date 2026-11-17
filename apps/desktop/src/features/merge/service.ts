// What the merge feature offers the others in main: one merge write to a pull request at a time,
// app-wide and whatever the account, so two never race on one pull request. Merging, joining or
// leaving the merge queue, moving to its front, turning auto-merge on or off, and approve and ship
// each take a pull request's turn before they send anything, and give it back once GitHub says how
// it ended.

import type { RepoRef } from '@lo/github';

import { defineService } from '../../main/services.ts';

/** A merge write's turn, taken: `give` gives it back, once, for the next write to take. */
export interface MergeTurn {
  give(): void;
}

/** The turns of merge writes to pull requests, for every feature that sends one. */
export interface MergeWrites {
  /**
   * Takes the turn for a merge write to each of `prs`, pull requests in `repo`, as one: all, or,
   * while a write to any of them is under way, none, and the first such pull request, `busy`,
   * which "Lo is already merging #4821." names.
   */
  take(repo: RepoRef, prs: readonly number[]): MergeTurn | { readonly busy: number };
  /** Which of `prs`, pull requests in `repo`, have a merge write under way now. */
  busy(repo: RepoRef, prs: readonly number[]): readonly number[];
}

export const writes = defineService<MergeWrites>('merge.writes');
