// One merge write to a pull request at a time, app-wide and whatever the account: the turns that
// `merge.writes` hands the features that merge. Nothing here calls Electron or GitHub.

import { PullRef, type RepoRef } from '@lo/github';

import type { MergeTurn, MergeWrites } from '../service.ts';

export class MergeTurns implements MergeWrites {
  /** The pull requests with a merge write under way, by their key, which ignores case. */
  readonly #taken = new Set<string>();
  readonly #given = new Set<() => void>();

  take(repo: RepoRef, prs: readonly number[]): MergeTurn | { readonly busy: number } {
    const [busy] = this.busy(repo, prs);
    if (busy !== undefined) return { busy };
    const keys = [...new Set(prs.map((pr) => PullRef.of(repo, pr).key))];
    for (const key of keys) this.#taken.add(key);
    let given = false;
    return {
      give: () => {
        if (given) return;
        given = true;
        for (const key of keys) this.#taken.delete(key);
        for (const listener of this.#given) listener();
      },
    };
  }

  /** Calls `listener` each time a turn is given back. Returns a function that stops it. */
  onGiven(listener: () => void): () => void {
    this.#given.add(listener);
    return () => {
      this.#given.delete(listener);
    };
  }

  busy(repo: RepoRef, prs: readonly number[]): readonly number[] {
    return prs.filter((pr) => this.#taken.has(PullRef.of(repo, pr).key));
  }
}
