// The question main is asking, as main last said, and the reader's answer to it, sent once.

import { client, type Client } from '../../../window/ipc.ts';
import { contract, type Question } from '../contract.ts';

let current: Question | null = null;
/** The question the reader answered, whose answer is on its way. */
let answered: string | undefined;
const listeners = new Set<() => void>();

/** The feature's client, on the window's bridge as it is now. */
export function main(): Client<typeof contract> {
  return client(contract);
}

/** The question main is asking, or none. */
export function asked(): Question | null {
  return current;
}

/** Calls `listener` each time the question changes. Returns a function that stops it. */
export function subscribeAsked(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Takes in the question main is asking, or that none is. */
export function showAsked(question: Question | null): void {
  if (question?.id === current?.id) return;
  current = question;
  answered = undefined;
  for (const listener of listeners) listener();
}

/**
 * Sends the reader's answer to the question up: its action (`act`), or Cancel. Main takes the
 * question down once it has it; a second press meanwhile sends nothing.
 */
export function answer(act: boolean): void {
  const question = current;
  if (question === null || answered === question.id) return;
  answered = question.id;
  main()
    .answer({ id: question.id, act })
    .catch((error: unknown) => {
      console.error("Lo couldn't answer main's question:", error);
      if (answered === question.id) answered = undefined;
    });
}
