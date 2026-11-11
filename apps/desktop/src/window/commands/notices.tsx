// What Lo says when something asked for didn't happen: a note at the bottom of the window that goes
// by itself. A key, a menu or the palette that asks for a command that can't run, and a Back with
// nowhere to go, say why here rather than doing nothing.

import { Notice } from '@lo/ui';
import { useSyncExternalStore } from 'react';

/** How long a note stays, in ms. */
export const NOTICE_TIME = 4000;

let current: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: string | undefined): void {
  current = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The note showing now. */
export function notice(): string | undefined {
  return current;
}

/** Says `message` for a few seconds, in place of the last one. */
export function notify(message: string): void {
  clearTimeout(timer);
  set(message);
  timer = setTimeout(() => {
    timer = undefined;
    set(undefined);
  }, NOTICE_TIME);
}

/** The window's notes. */
export function Notices() {
  return <Notice message={useSyncExternalStore(subscribe, notice)} />;
}
