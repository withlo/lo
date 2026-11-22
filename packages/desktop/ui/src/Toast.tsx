import { cva } from 'class-variance-authority';
import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';

import { Button } from './Button.tsx';
import { Collapse } from './Collapse.tsx';
import { Key } from './Key.tsx';

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
const ICONS: Readonly<Record<ToastTone, ReactNode>> = {
  info: (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v4M8 4.75v.01" />
    </svg>
  ),
  success: (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
    </svg>
  ),
  warning: (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
      <path d="M8 6.25v3M8 11.25v.01" />
    </svg>
  ),
  danger: (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75v4M8 11.25v.01" />
    </svg>
  ),
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
  /** A 16 px icon, an `svg` with the `lo-i` class and `aria-hidden`. Without one, the tone's. */
  icon?: ReactNode;
  /**
   * What happened, in a few words: the result, never the name of a command. A toast that goes by
   * itself is this one line.
   */
  title: ReactNode;
  /** More about it, for a toast that waits for the reader. */
  body?: ReactNode;
  /** Buttons for what to do about it, for a toast that waits for the reader. */
  actions?: ReactNode;
  /** The one thing to do about a one-line toast, at its end. */
  action?: ToastAction | undefined;
}

/**
 * A quiet note when something finished or arrived. One that goes by itself is one line: an icon,
 * the result, and one action at most; it's put in a `ToastStack`. One that waits for the reader,
 * such as an update, may add a body and buttons. Not for an error that needs action, which is a
 * `Problem` in place, and not for what already shows where the reader is looking.
 */
export function Toast({ tone, icon: mark, title, body, actions, action }: ToastProps) {
  return (
    <div className="grid w-toast-w toast items-start rounded-md bg-bg-overlay text-fg shadow-pop text-ui">
      <span className={icon({ tone })}>{mark ?? ICONS[tone]}</span>
      <div className="line-clamp-3 min-w-0 font-semibold wrap-anywhere">{title}</div>
      {action !== undefined && (
        <Button size="sm" variant="ghost" onClick={action.onClick}>
          {action.label}
          {action.keys && <Key keys={action.keys} decorative />}
        </Button>
      )}
      {body !== undefined && <div className="col-start-2 text-fg-muted text-small">{body}</div>}
      {actions !== undefined && <div className="col-start-2 mt-8 flex gap-6">{actions}</div>}
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

/** How many toasts a stack shows at once. */
export const TOAST_MAX = 3;

/** One toast in a stack: a line, and one action at most. */
export interface StackedToast {
  /** Tells it from the others. A toast shown again with the same id is the same toast. */
  readonly id: string;
  readonly tone: ToastTone;
  /** The result, in a few words: "Merged #264". */
  readonly title: ReactNode;
  readonly action?: ToastAction | undefined;
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
 * newest lowest. Each stays four seconds of its own, which stop while the pointer or focus is on
 * it, and a fourth sends the oldest away. One comes by making its room and rising into it, and
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
            onClosed={() => {
              // Still asked for: it's hidden, not gone, and its place is kept.
              if (asked.has(toast.id)) return;
              drawn.current = drawn.current.filter((each) => each.id !== toast.id);
              redraw();
            }}
          >
            <Timed id={toast.id} onDone={dismiss}>
              <Toast tone={toast.tone} title={toast.title} action={toast.action} />
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

/** A toast's place in the stack, which counts its time while the pointer and focus are off it. */
function Timed({
  id,
  onDone,
  children,
}: {
  id: string;
  onDone: { readonly current: (id: string) => void };
  children: ReactNode;
}) {
  const [held, setHeld] = useState({ pointer: false, focus: false });
  const paused = held.pointer || held.focus;
  const left = useRef(TOAST_MS);
  useEffect(() => {
    if (paused) return undefined;
    const started = Date.now();
    const timer = setTimeout(() => onDone.current(id), left.current);
    return () => {
      clearTimeout(timer);
      left.current = Math.max(0, left.current - (Date.now() - started));
    };
  }, [paused, id, onDone]);
  return (
    <div
      className="move-pop pt-8"
      data-side="top"
      onPointerEnter={() => setHeld((was) => ({ ...was, pointer: true }))}
      onPointerLeave={() => setHeld((was) => ({ ...was, pointer: false }))}
      onFocus={() => setHeld((was) => ({ ...was, focus: true }))}
      onBlur={() => setHeld((was) => ({ ...was, focus: false }))}
    >
      {children}
    </div>
  );
}
