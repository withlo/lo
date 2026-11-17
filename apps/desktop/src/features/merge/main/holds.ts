// Whether a pull request's head holds its base branch's tip, from the view's local copy: what the
// merge rules ask when they want the head up to date with the base. The copy fetches the tip first
// when it lacks it.

import { parseOid, type Repo } from '@lo/git';

/** What {@link holdsIn} uses of a local copy. */
export type HoldsCopy = Pick<Repo, 'hasCommit' | 'fetchCommit' | 'isAncestor'>;

/**
 * Whether `head` holds `tip` in `copy`, fetching `tip` when the copy lacks it: nothing when the copy
 * lacks `head`, which it fetches only as the view does. A failed fetch throws.
 */
export async function holdsIn(
  copy: HoldsCopy,
  tip: string,
  head: string,
): Promise<boolean | undefined> {
  const [base, ours] = [parseOid(tip), parseOid(head)];
  if (!(await copy.hasCommit(ours))) return undefined;
  if (!(await copy.hasCommit(base))) await copy.fetchCommit(base);
  return copy.isAncestor(base, ours);
}
