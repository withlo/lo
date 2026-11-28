// What the overview draws of the stack a pull request is a layer of: the stack overview's Layers,
// Lo's own list of the stack's layers, drawn live from the stack with what each layer's overview or
// description says; and, on a layer's own overview, the line that says it's part of a stack whose
// overview Lo has, with the way to it.

import type { StackReview } from '@lo/ui';
import { OverviewLine, StackLayers, type LayerSummary, type StackLayer } from '@lo/ui/overview';
import { useEffect, useMemo } from 'react';

import type { Review } from '../../stacks/contract.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { followedStack, layersSaid, readLines, stackStates, type LayerSaid } from './stack.ts';
import { showStackLayer, useStackView } from './stacked.ts';

/** The command that shows the stack overview. */
export const SHOW_STACK = 'overview.showStack';

/** A layer's review, as the stack's tree words it. */
const REVIEWS: Readonly<Record<Review, StackReview>> = {
  approved: 'approved',
  changesRequested: 'changes',
  reviewRequired: 'required',
};

/** What a layer's row says under its title, from what was read of it. */
export function summaryOf(said: LayerSaid | undefined): LayerSummary {
  if (said === undefined) return { kind: 'reading' };
  if (said.tldr !== undefined) return { kind: 'tldr', text: said.tldr };
  if (said.line === undefined) return { kind: 'reading' };
  return said.line === null ? { kind: 'none' } : { kind: 'description', text: said.line };
}

/**
 * The stack overview's list of layers, in the order the stack's tree draws them: each with its
 * overview's tl;dr, else its description's first line, which are read as it's drawn. A layer's row
 * shows that layer, as `⏎` in the stack's tree does.
 */
export function Layers({ tab }: { tab: PullTab }) {
  const view = useStackView(tab.id);
  const said = useTabState(layersSaid, tab.id);
  useEffect(() => {
    readLines(tab.id, view);
  }, [tab.id, view, said]);
  const rows = useMemo(() => (view?.kind === 'stack' ? view.rows : []), [view]);
  const layers = useMemo(
    () =>
      rows.map((row): StackLayer => ({
        key: String(row.number),
        number: row.number,
        title: row.title,
        state: row.state,
        branch: row.branch,
        sitsOn: row.on ?? undefined,
        review: row.review === null ? undefined : REVIEWS[row.review],
        summary: summaryOf(said.get(row.number)),
      })),
    [rows, said],
  );
  const current = rows.find((row) => row.current);
  return (
    <StackLayers
      layers={layers}
      current={current === undefined ? undefined : String(current.number)}
      onShow={(key) => showStackLayer(tab, Number(key))}
    />
  );
}

/**
 * On a layer's own overview, which names stack `named`: that the layer is part of a stack of so
 * many layers, with the way to its overview, while Lo has that stack's overview. Nothing otherwise.
 */
export function StackNotice({ tab, named }: { tab: PullTab; named: number | undefined }) {
  const view = useStackView(tab.id);
  const present = useTabState(stackStates, tab.id, (state) => (state?.overview ?? null) !== null);
  const layers = view?.kind === 'stack' ? view.rows.length : 0;
  if (named === undefined || !present || followedStack(tab.id) !== named || layers === 0) {
    return null;
  }
  return (
    <OverviewLine icon="layers" action={{ command: SHOW_STACK, label: 'Stack overview' }}>
      Part of a {layers}-layer stack
    </OverviewLine>
  );
}
