// The banner that says, once, that your pending review sits on another revision than the one on
// screen, so it can only go as a comment from here, with "Show r3". Dismissed, or followed, it
// doesn't come back for that review on that revision.

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
      detail={said.detail}
      actions={
        show === undefined
          ? []
          : [
              {
                label: `Show ${revisionLabel(revisions.get(tab.id), show)}`,
                onClick: () => {
                  dismiss(tab.id, key);
                  showRevision(tab.id, show);
                },
              },
            ]
      }
      onDismiss={() => dismiss(tab.id, key)}
    />
  );
}

/** Whether a view's banner shows: while it says something not dismissed. */
export const otherRevisionSwitch: BannerSwitch = {
  shows: (tab) => bannerOf(tab.id) !== undefined,
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
