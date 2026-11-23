// The window's notes: toasts at the bottom of the window that go by themselves. Up to three stack,
// the newest lowest, each with time of its own, so a second note never wipes out the first: four
// seconds, or eight for one with a button or Details, which also stays while its Details is open.
// A key pressed for a command that can't run, with no control in view to say why, says the reason
// here, alone. Something asked for that finished, such as a GitHub stack made, says so here too,
// in a line.
//
// A note is one line: the result, or the reason. `refuse` and `announce` with nothing after the
// line are the two to use. A failure is said where it happened, in a `Problem` or on the control
// that was pressed. Only one with nothing in view to host it is a note, at danger tone, with what
// main said behind Details where it said something: `fail` for one line, as for a key pressed with
// no control for it on screen, or the older shape, a title with a body under it, which `notify`
// still draws for the callers that have it, as for a command run from the menu. Its icon says which
// a note is: a tick for what's done, a failure's for what failed, a warning's for what can't be
// done here at all, and an info icon for the rest.

import {
  Ticks,
  TOAST_MAX,
  TOAST_MS,
  ToastStack,
  toastTime,
  type StackedToast,
  type ToastAction,
} from '@lo/ui';
import { useEffect, useMemo, useSyncExternalStore, type ReactNode } from 'react';

/**
 * How long a note stays, in ms, while the pointer and focus are off it. One with a button or
 * Details stays twice as long: see `toastTime`.
 */
export const NOTICE_TIME = TOAST_MS;

/**
 * What a note says: a line, and under it, for a note of the older shape, more about it, a line a
 * reason. `done` for what finished.
 */
export interface Note {
  readonly title: string;
  readonly body: string;
  readonly done?: boolean | undefined;
  /** Its one button, as "Back" on a note that something moved. */
  readonly action?: ToastAction | undefined;
  /** What main or the system said of a failure, as it came, behind Details. */
  readonly details?: string | undefined;
  /**
   * Its tone where it isn't the usual one: `danger` for a failure, and `warning` for what can't be
   * done here at all, as a check for updates on a build from source, which isn't a failure.
   * Without it, a note with Details is a failure, and the rest are news.
   */
  readonly tone?: 'warning' | 'danger' | undefined;
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
  const note = shown.find((each) => each.id === id)?.note;
  timers.set(
    id,
    setTimeout(() => dismiss(id), note === undefined ? NOTICE_TIME : toastTime(note)),
  );
}

/** Takes the note `id` away: its time is up. */
function dismiss(id: string): void {
  if (shown.some((each) => each.id === id)) set(shown.filter((each) => each.id !== id));
}

const same = (one: Note, other: Note) =>
  one.title === other.title &&
  one.body === other.body &&
  (one.done ?? false) === (other.done ?? false) &&
  one.action?.label === other.action?.label &&
  one.details === other.details &&
  one.tone === other.tone;

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
 * name. Several reasons are a line each. `action` is its one button, where the next step is one:
 * "Comment on file" for lines that take no comment.
 */
export function refuse(reason: string, action?: ToastAction): void {
  show({ title: reason, body: '', action });
}

/**
 * Says that something asked for is done, in a line: the verb in the past, then what it acted on,
 * such as "Merged #264". Nothing for what already shows where the reader is looking. `action` is
 * its one button, where there's a way back from it: "Back".
 */
export function announce(title: string, body = '', action?: ToastAction): void {
  show({ title, body, done: true, action });
}

/** What a note of the older shape may carry besides its words. */
export interface NoteMore {
  /** The one thing to do about it. */
  readonly action?: ToastAction | undefined;
  /** What main or the system said of a failure, as it came, behind Details. */
  readonly details?: string | undefined;
  /** `danger` for a failure with no Details, `warning` for what can't be done here at all. */
  readonly tone?: 'warning' | 'danger' | undefined;
}

/**
 * Says that something asked for went wrong, in a line at danger tone, where nothing in view can
 * host it: "Couldn’t copy the prompt" for `ya` pressed with no Copy prompt button on screen, with
 * `details`, what main or the system said, behind Details. A control that's in view says it
 * itself, and a failure that has a view says it there, as a `Problem`.
 */
export function fail(line: string, details?: string): void {
  show({ title: line, body: '', tone: 'danger', details });
}

/**
 * Says `title` with `body` under it, a line a reason: the older shape of a note that says why
 * something didn't happen, with `more.action`, the one thing to do about it, where there's one. A
 * command that can't run uses {@link refuse}. Something that failed says so where it was asked
 * for, not here, unless nothing in view can hold it, as for a command run from the menu or a toast
 * that has gone: then the note is the error, `title` what failed and `body` why, with
 * `more.details`, what main or the system said, behind Details, and its tone says it failed.
 */
export function notify(title: string, body: string, more: NoteMore = {}): void {
  show({ title, body, ...more });
}

/** Takes back the note `title` and `body` say, if it's showing: what it said is over. */
export function withdraw(title: string, body: string): void {
  const left = shown.filter((each) => each.note.title !== title || each.note.body !== body);
  if (left.length !== shown.length) set(left);
}

/** Lines of text, each on its own, with what's between backticks set as code. */
function lines(text: string): ReactNode {
  const each = text.split('\n');
  if (each.length === 1) return <Ticks text={text} />;
  return each.map((line, index) => (
    <span key={index} className="block">
      <Ticks text={line} />
    </span>
  ));
}

/** What a note's toast says: its line, and what's under it, quieter, each with its code as code. */
function lineOf(note: Note): ReactNode {
  if (note.body === '') return lines(note.title);
  return (
    <>
      <Ticks text={note.title} />
      <span className="block text-fg-muted text-small">{lines(note.body)}</span>
    </>
  );
}

/**
 * A note's toast: a tick and what's done; its `tone`'s icon where it has one, a failure's or a
 * warning's; a failure's for one with Details; or else an info icon and the reason.
 */
function toastOf(id: string, note: Note): StackedToast {
  return {
    id,
    tone: note.done ? 'success' : (note.tone ?? (note.details === undefined ? 'info' : 'danger')),
    title: lineOf(note),
    action: note.action,
    details: note.details,
  };
}

/**
 * The window's notes, as a stack of toasts, each with its tone's icon: see {@link toastOf}.
 * `waiting` holds the toasts that stay until they're acted on, below the stack.
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
