// The banner that offers where a stack's layer's diff starts, when its stack said so only after the
// diff was drawn: "#84's diff includes #83's changes." with "Show only #84's". Its button starts
// the diff again from there, as loading a newer push does, so nothing moves under the reader
// until they ask.

import { Banner } from '@lo/ui';

import { useDiffState } from '../../diff/window/shared.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { applyOffer, offers, startedAt } from './offers.ts';

export function StartBanner({ tab }: { tab: PullTab }) {
  const offer = useTabState(offers, tab.id);
  const state = useDiffState(tab.id);
  // Not once the diff on screen starts where it offers.
  if (!offer || startedAt(offer, state)) return null;
  return (
    <Banner
      tone="info"
      title={offer.title}
      actions={[{ label: offer.action, onClick: () => applyOffer(tab.id, offer) }]}
    />
  );
}
