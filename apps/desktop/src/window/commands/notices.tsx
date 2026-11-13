// What Lo says when something asked for didn't happen: a toast at the bottom of the window that
// goes by itself. A key, a menu or the palette that asks for a command that can't run, and a Back
// with nowhere to go, say why here rather than doing nothing. Something asked for that finished,
// such as a GitHub stack made, says so here too.

import { Toast, ToastRegion } from '@lo/ui';
import { useSyncExternalStore } from 'react';

/** How long a note stays, in ms. */
export const NOTICE_TIME = 4000;

/**
 * What a note says: what was asked for, in a few words, and why it didn't happen, a line a reason;
 * or, `done`, what finished.
 */
export interface Note {
  readonly title: string;
  readonly body: string;
  readonly done?: boolean | undefined;
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

/**
 * Says why `title`, what was asked for, didn't happen, for a few seconds, in place of the last.
 * Each line of `body` is a reason of its own.
 */
export function notify(title: string, body: string): void {
  show({ title, body });
}

/** Says that `title`, something asked for, is done, for a few seconds, in place of the last note. */
export function announce(title: string, body = ''): void {
  show({ title, body, done: true });
}

function show(note: Note): void {
  clearTimeout(timer);
  set(note);
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

/** The icon of a note that says why something didn't happen. */
const INFO = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" />
    <path d="M8 7.25v4M8 4.75v.01" />
  </svg>
);

/** The icon of a note that says something is done. */
const DONE = (
  <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
    <circle cx="8" cy="8" r="6.25" />
    <path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
  </svg>
);

/** A note's body, a line a reason. */
function lines(body: string) {
  const each = body.split('\n');
  if (each.length === 1) return body;
  return each.map((line, index) => (
    <span key={index} className="block">
      {line}
    </span>
  ));
}

/**
 * The window's notes, as toasts: an info icon, what was asked for and why it didn't happen; or a
 * tick, and what's done.
 */
export function Notices() {
  const note = useSyncExternalStore(subscribe, notice);
  return (
    <ToastRegion>
      {note !== undefined && (
        <Toast
          tone={note.done ? 'success' : 'info'}
          icon={note.done ? DONE : INFO}
          title={note.title}
          body={note.body === '' ? undefined : lines(note.body)}
        />
      )}
    </ToastRegion>
  );
}
