// The banner on a view language servers are off for, since nothing trusts it: "Language servers
// are off for fieldwork/atlas-api" with "Trust repo…", or for a fork, "Trust pull request…", and a
// dismiss, which holds for the repository. Its button only asks main, which asks the reader in a
// dialog of its own; while main does, the button is busy and says how far it has got, and once
// trusting failed, the banner says why, offering to open `settings.json` when that's what kept
// the trust from being saved, and to try again.
//
// It's the example of a banner that comes and goes while its tab is open: it opens into the flow
// and closes out of it, so what's under it moves once each way, and it keeps its place in the tab
// until it has closed.

import { Banner, Collapse, type BannerAction } from '@lo/ui';
import { useLayoutEffect, useState } from 'react';

import { openSettingsFile } from '../../settings/window/shared.ts';
import { useTabState, type PullTab } from '../../tab/window/shared.ts';
import {
  askToTrust,
  bannerOf,
  dismissBanner,
  drawn,
  failures,
  statuses,
  TRUST_STARTS,
  TRUSTING,
} from './status.ts';

/** `text` with the name `code` in it shown as code: "`settings.json` has an error." */
function Coded({ text, code }: { text: string; code: string }) {
  const at = text.indexOf(code);
  if (at === -1) return text;
  return (
    <>
      {text.slice(0, at)}
      <code>{code}</code>
      {text.slice(at + code.length)}
    </>
  );
}

/** Says view `view`'s banner is on screen, or that the one that was has gone, if that's news. */
function mark(view: string, how: 'on' | 'off'): void {
  const was = drawn.get(view);
  if (how === 'on' ? was !== 'on' : was === 'on') drawn.set(view, how);
}

export function TrustBanner({ tab }: { tab: PullTab }) {
  const status = useTabState(statuses, tab.id);
  const failure = useTabState(failures, tab.id);
  const banner = bannerOf(status, failure);
  const there = status !== null && banner !== undefined;
  // The first time a view's banner is drawn, it opens. Back on a tab that had it, it's just there.
  const [first] = useState(() => drawn.get(tab.id) === 'never');
  useLayoutEffect(() => {
    if (there) mark(tab.id, 'on');
  }, [there, tab.id]);
  // Gone with its tab, as when another tab comes on screen: there's nothing left to close.
  useLayoutEffect(() => () => mark(tab.id, 'off'), [tab.id]);

  const actions: BannerAction[] = [];
  if (there && banner.openFile === true) {
    actions.push({ label: 'Open settings.json', onClick: () => void openSettingsFile() });
  }
  if (there && banner.action) {
    const { action } = banner;
    actions.push({
      label: action.label,
      busy: action.busy !== undefined,
      // Said before it's pressed too, unseen, with room kept for the widest thing it comes to say:
      // the button is one width from before its press until it's done.
      working: action.busy ?? TRUST_STARTS,
      widest: TRUSTING,
      onClick: () => void askToTrust(status, action.pull),
    });
  }
  return (
    <Collapse open={there} appear={first} onGone={() => mark(tab.id, 'off')}>
      {there && (
        <Banner
          tone={banner.tone}
          title={banner.title}
          detail={
            banner.code === undefined || banner.detail === undefined ? (
              banner.detail
            ) : (
              <Coded text={banner.detail} code={banner.code} />
            )
          }
          actions={actions}
          onDismiss={() => void dismissBanner(status)}
        />
      )}
    </Collapse>
  );
}
