// What holds conversions back: the checks other features register through `stacks.forest`, each
// naming the pull requests Lo is merging now, whose base branches a conversion mustn't change
// meanwhile. Nothing here calls Electron.

import type { RepoRef } from '@lo/github';

import type { ConversionHold } from '../service.ts';

export class Holds {
  readonly #checks = new Set<ConversionHold>();

  /** Holds conversions back while `check` names a pull request. Returns a function that stops it. */
  add(check: ConversionHold): () => void {
    // Each registration is its own, even of a function registered before.
    const own: ConversionHold = (repo, prs) => check(repo, prs);
    this.#checks.add(own);
    return () => {
      this.#checks.delete(own);
    };
  }

  /** Which of `prs`, pull requests in `repo`, any check names now, in the order of `prs`. */
  held(repo: RepoRef, prs: readonly number[]): number[] {
    const named = new Set<number>();
    for (const check of this.#checks) for (const pr of check(repo, prs)) named.add(pr);
    return prs.filter((pr) => named.has(pr));
  }
}
