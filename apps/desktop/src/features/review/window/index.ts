// The review feature in the window: `⌘⏎`, which opens the submit dialog on the pull request on
// screen, the dialog, the status bar's item for your pending review, and the banner that says when
// it sits on another revision than the one on screen. What it knows of each view comes from main:
// your pending review from the comments feature, its revisions from the revisions feature, and how
// submitting stands from this one.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { banners, dialogs, status } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import { heard, openDialog, pullOnScreen, saveNow } from './actions.ts';
import { comments, main, revisions } from './main.ts';
import { OtherRevisionBanner, otherRevisionSwitch } from './OtherRevision.tsx';
import { PendingItem } from './Status.tsx';
import { takeReview, takeRevisions } from './store.ts';
import { SubmitDialog } from './SubmitDialog.tsx';

export default {
  commands: handlers(keys, {
    submit: {
      run: () => {
        const tab = pullOnScreen();
        if (typeof tab !== 'string') openDialog(tab);
      },
      enabled: () => {
        const tab = pullOnScreen();
        return typeof tab === 'string' ? tab : true;
      },
    },
  }),
  views: [
    // After the accounts' dialogs, the open box, the file finder and the stack's.
    defineView(dialogs, {
      id: 'review.submit',
      order: 40,
      render: () => createElement(SubmitDialog),
    }),
    defineView(status, {
      id: 'review.pending',
      order: 40,
      render: ({ tab }) => createElement(PendingItem, { tab }),
    }),
    defineView(banners, {
      id: 'review.otherRevision',
      order: 20,
      render: ({ tab }) => createElement(OtherRevisionBanner, { tab }),
      ...otherRevisionSwitch,
    }),
  ],
  start() {
    comments().subscribe('review', takeReview);
    revisions().subscribe('comparison', takeRevisions);
    main().subscribe('submitted', heard);
    // What waits to be saved is saved as the window goes.
    window.addEventListener('pagehide', saveNow);
  },
} satisfies WindowFeature;
