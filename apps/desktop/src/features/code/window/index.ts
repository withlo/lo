// The code feature in the window: trust, the syntax index, and code features. The banner on a
// view nothing trusts, Settings' Trust section, and the palette's trust commands, each of which
// only asks main; the index's item in the status bar; and `gd`, `gr`, `K`, `gh` and `gO`, with the
// peek's and the references panel's keys, which ask main over the code port and show what it
// answers in the diff's code views, the right panel and over the window.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { onCodeRest, onDiffDrawn } from '../../diff/window/shared.ts';
import { banners, dialogs, right, status as statusBar } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { CodeOverlays, ReferencesPanel, SaidStatus } from './Code.tsx';
import { takeIndex } from './indexes.ts';
import { IndexStatus } from './IndexStatus.tsx';
import { main } from './main.ts';
import {
  closePeek,
  closeReferences,
  codeNow,
  definition,
  goToAnswer,
  goToFocused,
  listedNow,
  outline,
  peekNow,
  pick,
  redrawn,
  references,
  rested,
  REFERENCES,
  stepReferences,
  toggleHints,
  typeOf,
} from './navigate.ts';
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
    definition: { run: definition, enabled: codeNow },
    references: { run: references, enabled: codeNow },
    type: { run: typeOf, enabled: codeNow },
    hints: { run: toggleHints, enabled: codeNow },
    outline: { run: outline, enabled: codeNow },
    nextAnswer: { run: () => pick(1), enabled: peekNow },
    previousAnswer: { run: () => pick(-1), enabled: peekNow },
    goAnswer: { run: () => goToAnswer(), enabled: peekNow },
    closePeek: { run: () => closePeek(), enabled: peekNow },
    nextReference: { run: () => stepReferences(1), enabled: listedNow },
    previousReference: { run: () => stepReferences(-1), enabled: listedNow },
    goReference: { run: goToFocused, enabled: listedNow },
    closeReferences: { run: closeReferences },
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
    // After the diff's (20) and the overview's (30).
    defineView(statusBar, {
      id: 'code.index',
      order: 40,
      render: ({ tab }) => createElement(IndexStatus, { tab }),
    }),
    // What a key that found nothing says, after the rest.
    defineView(statusBar, {
      id: 'code.said',
      order: 90,
      render: ({ tab }) => createElement(SaidStatus, { tab }),
    }),
    // After the threads.
    defineView(right, {
      id: REFERENCES,
      order: 20,
      label: 'References',
      render: ({ tab }) => createElement(ReferencesPanel, { tab }),
    }),
    defineView(dialogs, {
      id: 'code.overlays',
      order: 30,
      render: () => createElement(CodeOverlays),
    }),
  ],
  start() {
    main().subscribe('status', takeStatus);
    main().subscribe('indexed', takeIndex);
    onCodeRest(rested);
    onDiffDrawn(redrawn);
  },
} satisfies WindowFeature;
