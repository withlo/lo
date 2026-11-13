// The revisions feature in the window: the header's revision button and its picker, the note over
// the diff on what it compares, and their keys; and each tab's viewed marks, which follow the
// files GitHub lists.

import { handlers } from '@lo/ui/commands';
import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { client } from '../../../window/ipc.ts';
import { defineView } from '../../../window/slots.tsx';
import { contract as app } from '../../app/contract.ts';
import { notes } from '../../diff/window/shared.ts';
import { header, onChangedFiles } from '../../tab/window/shared.ts';
import keys from '../keys.ts';
import {
  canPick,
  canShortcut,
  closePicker,
  compareEnds,
  compareShortcut,
  isPicking,
  move,
  openPicker,
  setEnd,
} from './actions.ts';
import { takeHoldLimit } from './hold.ts';
import { main } from './main.ts';
import { Note } from './Note.tsx';
import { Revisions } from './Revisions.tsx';
import { showView } from './store.ts';
import { takeFiles } from './viewed.ts';

export default {
  commands: handlers(keys, {
    picker: { run: openPicker, enabled: canPick },
    down: { run: () => move(1), enabled: isPicking },
    up: { run: () => move(-1), enabled: isPicking },
    end: { run: () => setEnd(), enabled: isPicking },
    compare: { run: compareEnds, enabled: isPicking },
    sinceReview: { run: () => compareShortcut('review'), enabled: () => canShortcut('review') },
    sinceSeen: { run: () => compareShortcut('seen'), enabled: () => canShortcut('seen') },
    whole: { run: () => compareShortcut('whole'), enabled: () => canShortcut('whole') },
    close: { run: closePicker },
  }),
  views: [
    // Before the read-only note, which shows instead for a tab that isn't signed in.
    defineView(header, {
      id: 'revisions.button',
      order: 50,
      render: ({ tab }) => createElement(Revisions, { tab }),
    }),
    defineView(notes, {
      id: 'revisions.note',
      order: 10,
      render: ({ tab }) => createElement(Note, { tab }),
    }),
  ],
  start() {
    main().subscribe('comparison', showView);
    onChangedFiles(takeFiles);
    // A test may have asked for another bound on what a tab holds back as it opens.
    client(app)
      .info()
      .then(({ holdLimit }) => takeHoldLimit(holdLimit))
      .catch((error: unknown) => console.error("Lo couldn't ask how long to hold a tab:", error));
  },
} satisfies WindowFeature;
