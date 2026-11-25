import { cva } from 'class-variance-authority';
import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { Collapse } from './Collapse.tsx';
import { Glyphs, Icon } from './Icon.tsx';
import type { IconName } from './icons.ts';
import { Key } from './Key.tsx';
import { useDetails } from './Problem.tsx';

const icon = cva('flex-none', {
  variants: {
    tone: {
      info: 'text-info',
      success: 'text-success',
      warning: 'text-warning',
      danger: 'text-danger',
    },
  },
});

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

/** The icon each tone shows, so a status color never stands without one. */
const ICONS: Readonly<Record<ToastTone, IconName>> = {
  info: 'info',
  success: 'circle-check',
  warning: 'triangle-exclamation-point',
  danger: 'circle-exclamation-point',
};

/** The one thing a toast offers to do: "Undo", "Open". */
export interface ToastAction {
  label: string;
  onClick: () => void;
  /** Its key, as the system shows each key of it. */
  keys?: readonly string[] | undefined;
}

export interface ToastProps {
  /** What the icon says, as its color: a status color never stands without an icon and a word. */
  tone: ToastTone;
  /** An `Icon` of 14 px, beside the title's `text-ui`, or a `Spinner`. Without one, the tone's. */
  icon?: ReactNode;
  /**
   * What happened, in a few words: the result, never the name of a command. A toast that goes by
   * itself is this one line. A string is drawn through `Glyphs`, so `r1 → r3`'s arrow is an icon.
   */
  title: ReactNode;
  /**
   * More about it, for a toast that waits for the reader. Plain words wrap, anywhere a long path
   * needs to, and show three lines at most, through `Glyphs` as the title is; a body of its own
   * markup, such as a command to copy, shows whole.
   */
  body?: ReactNode;
  /** Buttons for what to do about it, for a toast that waits for the reader. */
  actions?: ReactNode;
  /** The one thing to do about a one-line toast, at its end. */
  action?: ToastAction | undefined;
  /**
   * What came back with a failure that nothing in view could hold, as it came, behind a Details
   * button under the line, with Copy.
   */
  details?: string | undefined;
  /** Called as Details opens and closes, so a stack holds the toast while its text is read. */
  onDetails?: ((open: boolean) => void) | undefined;
}

const more = cva('col-start-2 min-w-0 wrap-anywhere text-fg-muted text-small', {
  variants: { plain: { true: 'line-clamp-3', false: '' } },
});

/**
 * A quiet note when something finished or arrived. One that goes by itself is one line: an icon,
 * the result, and one action at most; it's put in a `ToastStack`. One that waits for the reader,
 * such as an update, may add a body and buttons. Not for an error that needs action, which is a
 * `Problem` in place, and not for what already shows where the reader is looking.
 */
export function Toast({
  tone,
  icon: mark,
  title,
  body,
  actions,
  action,
  details,
  onDetails,
}: ToastProps) {
  const { more: opener, shown, open } = useDetails(details);
  useEffect(() => onDetails?.(open), [open, onDetails]);
  return (
    <div className="grid w-toast-w toast items-start rounded-md bg-bg-overlay text-fg shadow-pop text-ui">
      <span className={icon({ tone })}>{mark ?? <Icon name={ICONS[tone]} size={14} />}</span>
      <div className="line-clamp-3 min-w-0 font-semibold wrap-anywhere">
        {typeof title === 'string' ? <Glyphs text={title} size={14} /> : title}
      </div>
      {action !== undefined && (
        <Button size="sm" variant="ghost" onClick={action.onClick}>
          {action.label}
          {action.keys && <Key keys={action.keys} decorative />}
        </Button>
      )}
      {body !== undefined && (
        <div className={more({ plain: typeof body === 'string' })}>
          {typeof body === 'string' ? <Glyphs text={body} /> : body}
        </div>
      )}
      {actions !== undefined && <div className="col-start-2 mt-8 flex gap-6">{actions}</div>}
      {details !== undefined && (
        <div className="col-start-2 col-end-4 min-w-0">
          {opener}
          {shown}
        </div>
      )}
    </div>
  );
}

/**
 * Where a toast floats, at the bottom right of the window above its status bar. The region is
 * always there and says each toast as it comes, so a screen reader hears it. `waiting` is for
 * toasts that stay until the reader acts on them: they sit below what the region says, in a live
 * region of their own that isn't atomic, so a screen reader hears each toast as it comes and the
 * part of it that changes, such as "Copy" turning to "Copied", and not all of it again each time,
 * nor again each time the note above comes. A `status` region is atomic unless it says it isn't.
 */
export function ToastRegion({ children, waiting }: { children?: ReactNode; waiting?: ReactNode }) {
  return (
    <div className="toast-floating">
      <div role="status" aria-atomic="true">
        {children}
      </div>
      {waiting !== undefined && (
        <div role="status" aria-atomic="false" className="mt-8 flex flex-col gap-8 empty:mt-0">
          {waiting}
        </div>
      )}
    </div>
  );
}

/** How long a toast in a stack stays, in milliseconds, while the pointer and focus are off it. */
export const TOAST_MS = 4000;

/**
 * How long one with a button or Details stays, in milliseconds: twice as long, since there's
 * something on it to do or read.
 */
export const TOAST_LONG_MS = 8000;

/** How long `toast` stays in a stack, in milliseconds, while the pointer and focus are off it. */
export function toastTime(toast: {
  readonly action?: unknown;
  readonly details?: string | undefined;
}): number {
  return toast.action !== undefined || toast.details !== undefined ? TOAST_LONG_MS : TOAST_MS;
}

/** How many toasts a stack shows at once. */
export const TOAST_MAX = 3;

/**
 * One toast in a stack: a line, and one action at most. Keep the same object while it shows: a new
 * one with the same id shows that toast again.
 */
export interface StackedToast {
  /**
   * Tells it from the others. A toast shown again with the same id, as a new object, is the same
   * toast: it stays where it is, says its new words, and its four seconds start again. A second
   * "Copied path" never leaves early on the first one's time.
   */
  readonly id: string;
  readonly tone: ToastTone;
  /** The result, in a few words: "Merged #264". */
  readonly title: ReactNode;
  readonly action?: ToastAction | undefined;
  /** What came back with a failure, behind Details: see `ToastProps.details`. */
  readonly details?: string | undefined;
}

export interface ToastStackProps {
  /** The toasts to show, oldest first. */
  toasts: readonly StackedToast[];
  /**
   * A toast's time is up, or a newer one took its place among the three: the caller takes it out
   * of `toasts`, and it leaves.
   */
  onDismiss: (id: string) => void;
  /** Toasts that stay until the reader acts on them, such as an update, under the stack. */
  waiting?: ReactNode;
}

/**
 * Where toasts float, at the bottom right of the window above its status bar: up to three, the
 * newest lowest. Each stays four seconds of its own, or eight with a button or Details, which stop
 * while the pointer or focus is on it or its Details is open, and a fourth sends the oldest away. One comes by making its room and rising into it, and
 * goes by fading and giving the room back.
 *
 * The region is always there, and isn't atomic, so a screen reader hears each toast as it comes
 * and not the others again.
 */
export function ToastStack({ toasts, onDismiss, waiting }: ToastStackProps) {
  // What's drawn: the toasts asked for, and those on their way out, each where it was.
  const drawn = useRef<readonly StackedToast[]>([]);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const asked = new Map(toasts.map((toast) => [toast.id, toast]));
  const before = new Set(drawn.current.map((toast) => toast.id));
  drawn.current = [
    ...drawn.current.map((toast) => asked.get(toast.id) ?? toast),
    ...toasts.filter((toast) => !before.has(toast.id)),
  ];
  // How many times each toast drawn has been shown. Asked for as a new object, or again after it
  // was let go, it's shown again.
  const shown = useRef(new Map<string, { asked: StackedToast | undefined; times: number }>());
  for (const { id } of drawn.current) {
    const now = asked.get(id);
    const was = shown.current.get(id);
    if (was === undefined) shown.current.set(id, { asked: now, times: 1 });
    else if (now !== was.asked) {
      shown.current.set(id, { asked: now, times: now === undefined ? was.times : was.times + 1 });
    }
  }
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const over = toasts.slice(0, Math.max(0, toasts.length - TOAST_MAX));
  // Ids are told apart whole, so one with a space in it is still one.
  const overIds = over.map((toast) => encodeURIComponent(toast.id)).join(' ');
  useEffect(() => {
    for (const id of overIds.split(' ').filter(Boolean)) dismiss.current(decodeURIComponent(id));
  }, [overIds]);
  const hidden = new Set(over.map((toast) => toast.id));
  return (
    <div className="toast-floating">
      <div role="status" aria-atomic="false" className="flex flex-col">
        {drawn.current.map((toast) => (
          <Collapse
            key={toast.id}
            open={asked.has(toast.id) && !hidden.has(toast.id)}
            appear
            onGone={() => {
              // Still asked for: it's hidden, not gone, and its place is kept.
              if (asked.has(toast.id)) return;
              drawn.current = drawn.current.filter((each) => each.id !== toast.id);
              shown.current.delete(toast.id);
              redraw();
            }}
          >
            <Timed
              id={toast.id}
              times={shown.current.get(toast.id)?.times ?? 1}
              time={toastTime(toast)}
              onDone={dismiss}
            >
              {(hold) => (
                <Toast
                  tone={toast.tone}
                  title={toast.title}
                  action={toast.action}
                  details={toast.details}
                  onDetails={hold}
                />
              )}
            </Timed>
          </Collapse>
        ))}
      </div>
      {waiting !== undefined && (
        <div role="status" aria-atomic="false" className="mt-8 flex flex-col gap-8 empty:mt-0">
          {waiting}
        </div>
      )}
    </div>
  );
}

/**
 * A toast's place in the stack, which counts its `time` while the pointer and focus are off it and
 * its Details is closed, and starts it again each time the toast is shown again (`times`).
 * `children` draws the toast, given what holds it while its Details is open.
 */
function Timed({
  id,
  times,
  time,
  onDone,
  children,
}: {
  id: string;
  times: number;
  time: number;
  onDone: { readonly current: (id: string) => void };
  children: (hold: (open: boolean) => void) => ReactNode;
}) {
  const [held, setHeld] = useState({ pointer: false, focus: false, details: false });
  const paused = held.pointer || held.focus || held.details;
  const left = useRef(time);
  const counted = useRef(times);
  useEffect(() => {
    if (paused) return undefined;
    // Shown again: its time starts over. This runs after the last count stopped, which took off
    // what it had used.
    if (counted.current !== times) {
      counted.current = times;
      left.current = time;
    }
    const started = Date.now();
    const timer = setTimeout(() => onDone.current(id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused, id, times, time, onDone]);
  const hold = useCallback(
    (open: boolean) => setHeld((was) => (was.details === open ? was : { ...was, details: open })),
    [],
  );
  return (
    <div
      className="move-pop pt-8"
      data-side="top"
      onPointerEnter={() => setHeld((was) => ({ ...was, pointer: true }))}
      onPointerLeave={() => setHeld((was) => ({ ...was, pointer: false }))}
      onFocus={() => setHeld((was) => ({ ...was, focus: true }))}
      onBlur={() => setHeld((was) => ({ ...was, focus: false }))}
    >
      {children(hold)}
    </div>
  );
}
