// The banner that offers where a stack's layer's diff starts, when its stack said so only after the
// diff was drawn: "This diff includes #83’s changes" with "Hide #83’s changes". Its button starts
// the diff again from there, as showing the latest revision does, so nothing moves under the reader
// until they ask. Its Dismiss, and its right-click, open the menu that dismisses it for this layer
// or for all stacks.

import { Banner } from '@lo/ui';

import { useMenuTarget } from '../../../window/commands/menus.tsx';
import { useDiffState } from '../../diff/window/shared.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { START_NOTICE } from './dismiss.ts';
import { applyOffer, offers, startedAt } from './offers.ts';

export function StartBanner({ tab }: { tab: PullTab }) {
  const offer = useTabState(offers, tab.id);
  const state = useDiffState(tab.id);
  const menu = useMenuTarget(START_NOTICE);
  // Not once the diff on screen starts where it offers.
  if (!offer || startedAt(offer, state)) return null;
  return (
    <div {...menu}>
      <Banner
        tone="info"
        title={offer.title}
        action={{ label: offer.action, onClick: () => applyOffer(tab.id, offer) }}
        dismissChoices
      />
    </div>
  );
}
