// What Lo says when something asked for didn't happen: a toast at the bottom of the window that
// goes by itself. A key, a menu or the palette that asks for a command that can't run, and a Back
// with nowhere to go, say why here rather than doing nothing.

import { Toast, ToastRegion } from '@lo/ui';
import { useSyncExternalStore } from 'react';

/** How long a note stays, in ms. */
export const NOTICE_TIME = 4000;

/** What a note says: what was asked for, in a few words, and why it didn't happen. */
export interface Note {
  readonly title: string;
  readonly body: string;
}

let current: Note | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function set(next: Note | undefined): void {
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
export function notice(): Note | undefined {
  return current;
}

/** Says why `title`, what was asked for, didn't happen, for a few seconds, in place of the last. */
export function notify(title: string, body: string): void {
  clearTimeout(timer);
  set({ title, body });
  timer = setTimeout(() => {
    timer = undefined;
    set(undefined);
  }, NOTICE_TIME);
}

/** Takes back the note `title` and `body` say, if it's the one showing: what it said is over. */
export function withdraw(title: string, body: string): void {
  if (current?.title !== title || current.body !== body) return;
  clearTimeout(timer);
  timer = undefined;
  set(undefined);
}

/** The window's notes, as toasts: an info icon, what was asked for and why it didn't happen. */
export function Notices() {
  const note = useSyncExternalStore(subscribe, notice);
  return (
    <ToastRegion>
      {note !== undefined && (
        <Toast
          tone="info"
          icon={
            <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="6.25" />
              <path d="M8 7.25v4M8 4.75v.01" />
            </svg>
          }
          title={note.title}
          body={note.body}
        />
      )}
    </ToastRegion>
  );
}
