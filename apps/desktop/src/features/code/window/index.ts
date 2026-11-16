// The code feature in the window: trust, the syntax index and language servers. The banner on a
// view nothing trusts, Settings' Trust section, and the palette's trust commands, each of which
// only asks main; the index's item in the status bar; and each language server's, with its log.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners, dialogs, status as statusBar } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { takeIndex } from './indexes.ts';
import { IndexStatus } from './IndexStatus.tsx';
import { main } from './main.ts';
import { ServerItems } from './ServerItems.tsx';
import { ServerLog } from './ServerLog.tsx';
import { restartServer, serversOnScreen, showLog, takeServers } from './servers.ts';
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
    restart: {
      async run() {
        const shown = serversOnScreen();
        if (typeof shown === 'string') return;
        await Promise.all(
          shown.servers.map((server) => restartServer(shown.view, server.id, server.name)),
        );
      },
      enabled: () => {
        const shown = serversOnScreen();
        return typeof shown === 'string' ? shown : true;
      },
    },
    log: {
      run() {
        const shown = serversOnScreen();
        const [first] = typeof shown === 'string' ? [] : shown.servers;
        if (typeof shown !== 'string' && first) {
          showLog({ view: shown.view, server: first.id, name: first.name });
        }
      },
      enabled: () => {
        const shown = serversOnScreen();
        return typeof shown === 'string' ? shown : true;
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
    // After the diff's (20) and the overview's (30).
    defineView(statusBar, {
      id: 'code.index',
      order: 40,
      render: ({ tab }) => createElement(IndexStatus, { tab }),
    }),
    defineView(statusBar, {
      id: 'code.servers',
      order: 41,
      render: ({ tab }) => createElement(ServerItems, { tab }),
    }),
    defineView(dialogs, { id: 'code.log', order: 40, render: () => createElement(ServerLog) }),
  ],
  start() {
    main().subscribe('status', takeStatus);
    main().subscribe('indexed', takeIndex);
    main().subscribe('served', takeServers);
  },
} satisfies WindowFeature;
