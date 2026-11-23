// The ask feature in main: the question other features ask the reader through `ask.asking`, which
// the window draws as Lo's own dialog, and the reader's answer, from that window alone.

import { BrowserWindow } from 'electron';

import { defineFeature } from '../../../main/features.ts';
import { provides } from '../../../main/services.ts';
import { contract } from '../contract.ts';
import { asking } from '../service.ts';
import { Questions } from './questions.ts';

let questions: Questions | undefined;

export default defineFeature(contract, {
  handlers: {
    read: () => questions?.current ?? null,
    answer: ({ id, act }, _context, { windowId }) => questions?.answer(windowId, id, act),
  },
  provide(context) {
    const made = new Questions({
      window(id) {
        const shown = BrowserWindow.fromId(id);
        if (!shown || shown.isDestroyed()) return undefined;
        return {
          onClosed(listener) {
            shown.once('closed', listener);
            return () => shown.off('closed', listener);
          },
        };
      },
      publish: (question) => context.publish('question', question),
    });
    questions = made;
    return [provides(asking, made)];
  },
  stop() {
    questions?.stop();
  },
});
