import { createElement } from 'react';

import type { WindowFeature } from '../../../window/features.ts';
import { defineView } from '../../../window/slots.tsx';
import { dialogs } from '../../tab/window/shared.ts';
import { Asked } from './Asked.tsx';
import { main, showAsked } from './store.ts';

export default {
  views: [
    // Last, so it's over any other dialog.
    defineView(dialogs, { id: 'ask.asked', order: 90, render: () => createElement(Asked) }),
  ],
  start() {
    const ask = main();
    // Subscribed first, so no question asked between the two is missed.
    let pushed = false;
    ask.subscribe('question', (question) => {
      pushed = true;
      showAsked(question);
    });
    ask
      .read()
      .then((question) => {
        if (!pushed) showAsked(question);
      })
      .catch((error: unknown) => console.error("Lo couldn't read main's question:", error));
  },
} satisfies WindowFeature;
