// What the comments say to a screen reader as it happens: that a comment is on its way, that it was
// sent, that it wasn't and why, and the same for a thread resolved or a comment deleted. One region,
// there before anything is said in it, so each of these is read as it comes: a card or a note drawn
// with its words already on it is read by nobody. It holds what it said for a moment only, so the
// same words are said again the next time.

import { useSyncExternalStore } from 'react';

/** How long what was said stays in the region. */
export const SAID_FOR = 4000;

let said = '';
let clearing: ReturnType<typeof setTimeout> | undefined;
let again = 0;
const listeners = new Set<() => void>();

function put(text: string): void {
  if (text === said) return;
  said = text;
  for (const listener of listeners) listener();
}

/** Says `text` to a screen reader, once. */
export function tell(text: string): void {
  clearTimeout(clearing);
  cancelAnimationFrame(again);
  clearing = setTimeout(() => put(''), SAID_FOR);
  if (text !== said) {
    put(text);
    return;
  }
  // The same words twice running are a change only by way of nothing, drawn for a frame: both
  // set at once would leave the region as it was, and nothing would be read.
  put('');
  again = requestAnimationFrame(() => put(text));
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The region itself: nothing to see. */
export function Said() {
  const text = useSyncExternalStore(subscribe, () => said);
  return (
    <span role="status" className="sr-only">
      {text}
    </span>
  );
}
