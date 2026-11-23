// A comparison main didn't take, said in a note: nothing in view holds it, since the picker that
// asked has closed, or the place that asked was left.

import { notify } from '../../../window/commands/notices.tsx';
import type { Compared, ComparisonView } from '../contract.ts';
import { comparisonLabel } from './model.ts';

/**
 * Says that comparing `compared` in `view` failed: what failed, named by its ends ("Couldn’t compare
 * r3 → r5"), with what main said behind Details.
 */
export function compareFailed(
  view: ComparisonView | undefined,
  compared: Compared,
  error: unknown,
): void {
  const what = view ? comparisonLabel(view, compared) : 'the revisions';
  const said = error instanceof Error && error.message !== '' ? error.message : undefined;
  notify(`Couldn’t compare ${what}`, '', { details: said });
}
