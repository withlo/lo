// The banner on a view language servers are off for, since nothing trusts it: "Language servers
// are off for fieldwork/atlas-api." with "Trust this repo", or for a fork, "This PR comes from a
// fork, sam-whit/atlas-api." with "Trust this PR", and a dismiss, which holds for the repository.
// Its button only asks main, which asks the reader in a dialog of its own.

import { Banner } from '@lo/ui';

import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { askToTrust, bannerOf, dismissBanner, statuses } from './status.ts';

export function TrustBanner({ tab }: { tab: PullTab }) {
  const status = useTabState(statuses, tab.id);
  const banner = bannerOf(status);
  if (!status || !banner) return null;
  const { action } = banner;
  return (
    <Banner
      tone="warn"
      title={banner.title}
      detail={banner.detail}
      actions={
        action && [{ label: action.label, onClick: () => void askToTrust(status, action.pull) }]
      }
      onDismiss={() => void dismissBanner(status)}
    />
  );
}
