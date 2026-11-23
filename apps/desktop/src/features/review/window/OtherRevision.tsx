// The banner that says, once, that your pending review sits on another revision than the one on
// screen, with "Show r3" while GitHub still has it. Dismissed, or followed, it doesn't come back for
// that review on that revision.

import { Banner } from '@lo/ui';

import { useTabState, type BannerSwitch, type PullTab } from '../../tab/window/shared.ts';
import { showRevision } from './actions.ts';
import { headOnScreen, otherRevisionOf, revisionLabel } from './model.ts';
import { catchUp, dismissed, pendings, revisions } from './store.ts';

/** What the banner says for view `id` now, unless it was dismissed. */
function bannerOf(id: string) {
  const comparison = revisions.get(id);
  const said = otherRevisionOf(pendings.get(id), headOnScreen(comparison), (head) =>
    revisionLabel(comparison, head),
  );
  return said && !dismissed.get(id).has(said.key) ? said : undefined;
}

/** Won't show again for what it says now. */
function dismiss(id: string, key: string): void {
  dismissed.update(id, (was) => new Set([...was, key]));
}

export function OtherRevisionBanner({ tab }: { tab: PullTab }) {
  // Read for their changes.
  useTabState(pendings, tab.id);
  useTabState(revisions, tab.id);
  useTabState(dismissed, tab.id);
  const said = bannerOf(tab.id);
  if (!said) return null;
  const { show, key } = said;
  return (
    <Banner
      tone="info"
      title={said.title}
      action={
        show === undefined
          ? undefined
          : {
              label: `Show ${revisionLabel(revisions.get(tab.id), show)}`,
              onClick: () => {
                dismiss(tab.id, key);
                showRevision(tab.id, show);
              },
            }
      }
      onDismiss={() => dismiss(tab.id, key)}
    />
  );
}

/** What a view's banner says: while it says something not dismissed. */
export const otherRevisionSwitch: BannerSwitch = {
  said(tab) {
    const said = bannerOf(tab.id);
    return said && { tone: 'info', title: said.title };
  },
  subscribe(tab, listener) {
    if (pendings.get(tab.id) === undefined || revisions.get(tab.id) === undefined) {
      catchUp(tab.id);
    }
    const stops = [
      pendings.subscribe(listener),
      revisions.subscribe(listener),
      dismissed.subscribe(listener),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  },
};
