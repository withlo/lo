// Questions main asks in the window and waits on, drawn as Lo's own dialog: main asks, the window
// draws the question and sends back what the reader pressed, and only an answer to the question
// main is asking, with its id, from the window it asked in, counts. "Cancel" is the answer to
// anything else: `⏎` and `Esc`, no window to ask in, the window closing, and Lo quitting.

import { z } from 'zod';

import { defineContract, reply } from '../../ipc/contract.ts';

/** The longest id main gives a question: a UUID's 36 characters. */
const ID_LENGTH = 36;

/** A question main asks, as the window draws it. */
export const question = z.strictObject({
  /** Which question it is: an answer counts only with it. */
  id: z.string().min(1).max(ID_LENGTH),
  /** The verb, the object and a question mark: "Replace Lo in Applications?". */
  title: z.string().min(1),
  /** What happens that the title doesn't say. */
  detail: z.string(),
  /** The main button: the title's verb and object, "Replace Lo". */
  action: z.string().min(1),
});
export type Question = z.output<typeof question>;

export const contract = defineContract('ask', {
  requests: {
    /** The question main is asking, or none. The `question` topic then keeps the window up to date. */
    read: { input: z.undefined(), reply: reply<Question | null>() },
    /**
     * What the reader pressed for question `id`: its action (`act`), or else Cancel. An answer to
     * any question but the one main is asking, or from a window it didn't ask in, is ignored.
     */
    answer: {
      input: z.strictObject({ id: z.string().max(ID_LENGTH), act: z.boolean() }),
      reply: reply<void>(),
    },
  },
  topics: {
    /** The question main is asking, each time it asks one, and none once it's answered. */
    question: question.nullable(),
  },
});
