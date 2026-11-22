// The window's notes: toasts at the bottom of the window that go by themselves. Up to three stack,
// the newest lowest, each with four seconds of its own, so a second note never wipes out the
// first. A key pressed for a command that can't run, with no control in view to say why, says the
// reason here, alone. Something asked for that finished, such as a GitHub stack made, says so here
// too, in a line.
//
// A note is one line: the result, or the reason. `refuse` and `announce` with nothing after the
// line are the two to use. A title with a body under it is the older shape, still drawn for the
// callers that have it.

import { TOAST_MAX, TOAST_MS, ToastStack, type StackedToast } from '@lo/ui';
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

/** How long a note stays, in ms, while the pointer and focus are off it. */
export const NOTICE_TIME = TOAST_MS;

/**
 * What a note says: a line, and under it, for a note of the older shape, more about it, a line a
 * reason. `done` for what finished.
 */
export interface Note {
  readonly title: string;
  readonly body: string;
  readonly done?: boolean | undefined;
}

/**
 * A note on screen, told from the others by its id. Its toast is the same object for as long as it
 * shows, and a new one when it's said again, which starts its time over.
 */
interface Shown {
  readonly id: string;
  readonly note: Note;
  readonly toast: StackedToast;
}

/** The notes on screen, oldest first. */
let shown: readonly Shown[] = [];
let made = 0;
const listeners = new Set<() => void>();

/**
 * How many windows draw the notes. The stack that draws them counts each one's time, which stops
 * while the pointer is on it. With nothing drawing them, each still goes after its time.
 */
let drawing = 0;
const timers = new Map<string, ReturnType<typeof setTimeout>>();

function set(next: readonly Shown[]): void {
  shown = next;
  for (const [id, timer] of timers) {
    if (next.some((each) => each.id === id)) continue;
    clearTimeout(timer);
    timers.delete(id);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Counts `id`'s time from now, where nothing on screen does. */
function time(id: string): void {
  clearTimeout(timers.get(id));
  timers.delete(id);
  if (drawing > 0) return;
  timers.set(
    id,
    setTimeout(() => dismiss(id), NOTICE_TIME),
  );
}

/** Takes the note `id` away: its time is up. */
function dismiss(id: string): void {
  if (shown.some((each) => each.id === id)) set(shown.filter((each) => each.id !== id));
}

const same = (one: Note, other: Note) =>
  one.title === other.title &&
  one.body === other.body &&
  (one.done ?? false) === (other.done ?? false);

/**
 * Shows `note` under the others. One already showing that says the same isn't said twice: it's the
 * newest again. Past three, the oldest goes.
 */
function show(note: Note): void {
  const again = shown.find((each) => same(each.note, note));
  if (!again) made += 1;
  const id = again?.id ?? `note-${made}`;
  const rest = shown.filter((each) => each !== again);
  set([...rest, { id, note, toast: toastOf(id, note) }].slice(-TOAST_MAX));
  time(id);
}

/** The newest note showing. */
export function notice(): Note | undefined {
  return shown.at(-1)?.note;
}

/** Every note showing, oldest first. */
export function notices(): readonly Note[] {
  return shown.map((each) => each.note);
}

/**
 * Says why a command asked for by its key can't run now, with no control in view to say it: the
 * reason alone, in a line with no full stop, such as "Sign in to comment". Never the command's
 * name. Several reasons are a line each.
 */
export function refuse(reason: string): void {
  // A reason written as one sentence, for where it shows under something else, loses its full
  // stop here, where it stands alone. One of several sentences keeps them all.
  const said = reason
    .split('\n')
    .map((line) => (/[.!?…] /.test(line) ? line : line.replace(/\.$/, '')));
  show({ title: said.join('\n'), body: '' });
}

/**
 * Says that something asked for is done, in a line: the verb in the past, then what it acted on,
 * such as "Merged #264". Nothing for what already shows where the reader is looking.
 */
export function announce(title: string, body = ''): void {
  show({ title, body, done: true });
}

/**
 * Says `title` with `body` under it, a line a reason: the older shape of a note that says why
 * something didn't happen. A command that can't run uses {@link refuse}; something that failed
 * says so where it was asked for, not here.
 */
export function notify(title: string, body: string): void {
  show({ title, body });
}

/** Takes back the note `title` and `body` say, if it's showing: what it said is over. */
export function withdraw(title: string, body: string): void {
  const left = shown.filter((each) => each.note.title !== title || each.note.body !== body);
  if (left.length !== shown.length) set(left);
}

/** Lines of text, each on its own. */
function lines(text: string): ReactNode {
  const each = text.split('\n');
  if (each.length === 1) return text;
  return each.map((line, index) => (
    <span key={index} className="block">
      {line}
    </span>
  ));
}

/** What a note's toast says: its line, and what's under it, quieter. */
function lineOf(note: Note): ReactNode {
  if (note.body === '') return lines(note.title);
  return (
    <>
      {note.title}
      <span className="block text-fg-muted text-small">{lines(note.body)}</span>
    </>
  );
}

/** A note's toast: an info icon and the reason, or a tick and what's done. */
function toastOf(id: string, note: Note): StackedToast {
  return { id, tone: note.done ? 'success' : 'info', title: lineOf(note) };
}

/**
 * The window's notes, as a stack of toasts: an info icon and the reason, or a tick and what's
 * done. `waiting` holds the toasts that stay until they're acted on, below the stack.
 */
export function Notices({ waiting }: { waiting?: ReactNode }) {
  const notes = useSyncExternalStore(subscribe, () => shown);
  // While this draws them, the stack counts each note's time.
  useEffect(() => {
    drawing += 1;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    return () => {
      drawing -= 1;
      for (const each of shown) time(each.id);
    };
  }, []);
  const toasts = useMemo(() => notes.map(({ toast }) => toast), [notes]);
  return <ToastStack toasts={toasts} onDismiss={dismiss} waiting={waiting} />;
}
