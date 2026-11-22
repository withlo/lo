// The banner on a view language servers are off for, since nothing trusts it: "Language servers
// are off for fieldwork/atlas-api." with "Trust this repo", or for a fork, "This PR comes from a
// fork, sam-whit/atlas-api." with "Trust this PR", and a dismiss, which holds for the repository.
// Its button only asks main, which asks the reader in a dialog of its own; while main does, the
// button says how far it has got, and once trusting failed, the banner says why, offering to open
// the settings file when that's what kept Lo from saving it, and to try again.

import { Banner, type BannerAction } from '@lo/ui';

import { openSettingsFile } from '../../settings/window/shared.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import { askToTrust, bannerOf, dismissBanner, failures, statuses } from './status.ts';

export function TrustBanner({ tab }: { tab: PullTab }) {
  const status = useTabState(statuses, tab.id);
  const failure = useTabState(failures, tab.id);
  const banner = bannerOf(status, failure);
  if (!status || !banner) return null;
  const { action } = banner;
  const actions: BannerAction[] = [];
  if (banner.openFile === true) {
    actions.push({ label: 'Open the settings file', onClick: () => void openSettingsFile() });
  }
  if (action) {
    actions.push({
      label: action.label,
      busy: action.busy !== undefined,
      working: action.busy,
      onClick: () => void askToTrust(status, action.pull),
    });
  }
  return (
    <Banner
      tone={banner.tone}
      title={banner.title}
      detail={banner.detail}
      actions={actions}
      onDismiss={() => void dismissBanner(status)}
    />
  );
}
