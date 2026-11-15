// The code feature in the window: trust. The banner on a view nothing trusts, Settings' Trust
// section, and the palette's trust commands, each of which only asks main.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { main } from './main.ts';
import {
  askToTrust,
  bannerOf,
  dismissBanner,
  onScreen,
  stopTrusting,
  takeStatus,
  trustable,
  trustSwitch,
  untrustable,
} from './status.ts';
import Trusted from './Trusted.tsx';
import { TrustBanner } from './TrustBanner.tsx';

/** Runs `act` on the view on screen's status, which `enabled` has checked. */
function onView(act: (status: Exclude<ReturnType<typeof onScreen>, string>) => Promise<void>) {
  return () => {
    const status = onScreen();
    if (typeof status !== 'string') return act(status);
    return undefined;
  };
}

export default {
  commands: handlers(keys, {
    trust: {
      run: onView((status) => askToTrust(status, false)),
      enabled: () => trustable(onScreen(), false),
    },
    trustPull: {
      run: onView((status) => askToTrust(status, true)),
      enabled: () => trustable(onScreen(), true),
    },
    untrust: {
      run: onView(stopTrusting),
      enabled: () => untrustable(onScreen()),
    },
    dismiss: {
      run: onView(dismissBanner),
      enabled: () => {
        const status = onScreen();
        if (typeof status === 'string') return status;
        return bannerOf(status) ? true : "There's no banner about language servers on screen.";
      },
    },
  }),
  views: [
    // After the stack's offer of where the diff starts, which is about what's on screen now.
    defineView(banners, {
      id: 'code.banner',
      order: 20,
      render: ({ tab }) => createElement(TrustBanner, { tab }),
      ...trustSwitch,
    }),
    Trusted,
  ],
  start() {
    main().subscribe('status', takeStatus);
  },
} satisfies WindowFeature;
