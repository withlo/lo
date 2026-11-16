// What the stacks feature offers the others in main: a repository's stacks as an account's poller
// lists its open pull requests, with how fresh and whole that list is; whether a conversion to a
// GitHub stack is changing its base branches; and a way to hold conversions back while Lo merges
// pull requests on their path, since stacks can't ask the feature that merges.

import type { RepoRef } from '@lo/github';
import type { Facts, Plan, Reason, Stacks } from '@lo/stacks';

import { defineService } from '../../main/services.ts';

/** A repository's stacks, as an account's poller lists its open pull requests. */
export interface Forest {
  /**
   * The stacks found among the open pull requests, with the merged ones they link through. Their
   * `gaps` say what the reads left out, which keeps every plan from being made.
   */
  readonly stacks: Stacks;
  /**
   * When GitHub last confirmed the list of open pull requests the stacks were found among, in
   * milliseconds since the Unix epoch: a list read again unchanged confirms it.
   */
  readonly listedAt: number;
  /** The time between lists of the repository's open pull requests now, in milliseconds. */
  readonly listEvery: number;
  /**
   * Whether the list holds every open pull request: false over 1,000, when the oldest are left
   * out and a layer above one of them may sit on its branch as a root.
   */
  readonly whole: boolean;
  /**
   * What `@lo/stacks`' `planConversion` says of making the chain through layer `number` a GitHub
   * stack, given `facts`, which only GitHub knows: its plan, or every reason there's none.
   */
  conversion(number: number, facts: Facts): ForestConversion;
}

/** What {@link Forest.conversion} says. */
export type ForestConversion =
  | {
      readonly kind: 'plan';
      readonly plan: Plan;
      /**
       * What the offer to make it a GitHub stack says: "These PRs share commits but aren't a
       * GitHub stack. As one, they'd merge together."
       */
      readonly offer: string;
    }
  | {
      readonly kind: 'notOffered';
      readonly reasons: readonly Reason[];
      /**
       * Each reason as a sentence, as making a GitHub stack words it. Branch names in them are
       * GitHub's text.
       */
      readonly words: readonly string[];
    };

/**
 * A conversion in a repository: `running` while it sends changes, putting base branches back
 * included; `rollback` once one that failed or stopped has changed base branches the reader may
 * still put back, until they do or close it. `prs` are the pull requests on its plan's path, bottom
 * to top.
 */
export interface Converting {
  readonly kind: 'running' | 'rollback';
  readonly prs: readonly number[];
}

/**
 * Which of `prs`, pull requests in `repo`, Lo is merging now, so their base branches mustn't change
 * under the merge: none, or those numbers.
 */
export type ConversionHold = (repo: RepoRef, prs: readonly number[]) => readonly number[];

/** Each repository's stacks and conversions, for the features that merge. */
export interface ForestService {
  /**
   * `repo`'s stacks as `login`'s poller lists its open pull requests now, worked out from the list
   * and rulesets as they are when asked, so asking again once the poller changes gives the new
   * ones. Nothing until both have been read, which the poller does for the repositories pull
   * requests' tabs are in, and nothing for an account no tab acts as.
   */
  forest(repo: RepoRef, login: string): Forest | undefined;
  /** The conversion in `repo` that's sending changes or waits on a rollback, if there is one. */
  converting(repo: RepoRef): Converting | undefined;
  /**
   * Holds back conversions while `check` names any pull request on their path: planning one is
   * refused, and so are confirming one and putting base branches back. Returns a function that
   * stops it.
   */
  holdConversions(check: ConversionHold): () => void;
}

export const forest = defineService<ForestService>('stacks.forest');
