// What the ask feature's main side offers the others: asking the reader a question in Lo's own
// dialog, and waiting for the answer.

import { defineService } from '../../main/services.ts';
import type { Question } from './contract.ts';

/** A question as a feature asks it: main gives it its id. */
export type Asked = Omit<Question, 'id'>;

export interface Asking {
  /**
   * Asks `question` in window `window`, the window whose page asked for what it's about, and
   * answers whether the reader pressed its action. Anything else is Cancel, and answers `false`:
   * `⏎` and `Esc`, no such window, the window closing, `signal` aborting, Lo quitting, and a
   * question asked while another is up, which stays up alone. Rejects when the window can't be
   * told the question.
   *
   * It guards against a slip, not against the page: whatever runs in the window can read the
   * question's id and answer it. What the window must not decide by itself isn't asked this way.
   */
  ask(window: number | undefined, question: Asked, signal?: AbortSignal): Promise<boolean>;
}

export const asking = defineService<Asking>('ask.asking');
