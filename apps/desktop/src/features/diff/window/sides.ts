// The keys that size what has focus, in a side-by-side diff: `>` and `<` widen and narrow the side
// the cursor is on, and `=` puts the sides back even, as dragging the edge between them and a
// double-click on it do. The share is the window's, for every side-by-side diff, as the drag's is.

import { activeTab, keepSides, sidesKept, type ViewEdge } from '../../tab/window/shared.ts';
import { drawnFor, type Drawn } from './tabs.ts';
import { wholeDrawn } from './whole.ts';

/** The diff on screen, while focus is in it. */
function focusedDiff(): Drawn | undefined {
  const tab = activeTab();
  if (tab?.kind !== 'pull' || wholeDrawn(tab.id)) return undefined;
  const drawn = drawnFor(tab.id);
  return drawn?.hasFocus() ? drawn : undefined;
}

/** The edge between the sides of the diff focus is in, side by side, for the side the cursor is on. */
export const sidesEdge: ViewEdge = {
  sized() {
    const edge = focusedDiff()?.view.sideEdge();
    return edge && { width: edge.width, min: edge.min, max: edge.max };
  },
  size(width) {
    const drawn = focusedDiff();
    const edge = drawn?.view.sideEdge();
    if (!drawn || !edge) return;
    const mine = width === undefined ? undefined : width / edge.room;
    const share = mine === undefined || edge.side === 'old' ? mine : 1 - mine;
    drawn.view.setSides(share);
    keepSides(share);
    drawn.view.pressSides();
  },
  resettable: () => sidesKept() !== undefined,
};
