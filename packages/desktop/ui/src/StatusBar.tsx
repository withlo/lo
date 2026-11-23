import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { besideIn, handOffFocus } from './focus.ts';
import { Popover, PopoverDescription } from './Popover.tsx';
import { Spinner } from './Spinner.tsx';

/**
 * The strip at the bottom of a pull request's tab: background work on the left, each item a ball
 * and a label, then where you are on the right. Nothing in it needs a decision, and nothing in it
 * offers one unasked: an item's details open on a click.
 */
export function StatusBar({ start, end }: { start?: ReactNode; end?: ReactNode }) {
  return (
    <footer
      aria-label="Status bar"
      className="flex h-statusbar-h min-w-0 flex-none items-center gap-2 bg-bg-chrome px-8 whitespace-nowrap text-fg-muted statusbar-edge text-micro"
    >
      {start}
      <span className="flex-1" />
      {end}
    </footer>
  );
}

/**
 * How a status item's work stands, as its ball draws it: a ring while it's off or not there yet, a
 * spinner while it's at work, filled once it's ready, amber where it holds back or waits, and red
 * once it failed. A spinner is a ball at work.
 */
export type StatusBallState = 'off' | 'working' | 'ready' | 'warn' | 'failed';

const BALLS = {
  off: 'hollow text-fg-dim',
  ready: 'bg-success',
  warn: 'bg-warning',
  failed: 'bg-danger',
} as const;

/** A status item's ball: what it says of the item, the item's label says in words. */
export function StatusBall({ state }: { state: StatusBallState }) {
  if (state === 'working') return <Spinner size="xs" />;
  return (
    <span
      className={`size-8 flex-none rounded-full ${BALLS[state]}`}
      data-ball={state}
      aria-hidden="true"
    />
  );
}

/** The look of an item that's text. */
export const STATUS_ITEM = 'inline-flex h-20 min-w-0 items-center gap-6 rounded-xs px-6';

/** The look of an item that's a button: it answers the pointer and shows focus. */
export const STATUS_BUTTON = `${STATUS_ITEM} hover:bg-hover hover:text-fg focus-visible:shadow-ring`;

export interface StatusItemProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'title' | 'onClick'
> {
  /** How its work stands. Without one, it's a fact with no state of its own, as a count is. */
  ball?: StatusBallState | undefined;
  /** Its label: the thing, and its state where the ball isn't enough. */
  children: ReactNode;
  /**
   * What a click on it opens over it: one line of state, and what can be done about it, such as a
   * `Problem` with its one action. An item with nothing behind it has no details, and is text.
   */
  details?: ReactNode;
  /** Its details' name, for a screen reader: the item's own words. */
  label?: string | undefined;
  /** Whether its details are open. Without it, the item keeps its own. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** What in its details has focus as they open. Without it, the details themselves. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Where its details are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** Its tooltip, for an item that's a command's button, as a `Popover`'s trigger may be. */
  title?: string | undefined;
  /** It's a button, for something it does, without details of its own. */
  onClick?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'] | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

/**
 * One piece of background work in the status bar: a ball for how it stands, and a label. It keeps
 * its place in the bar from one state to the next. With `details`, a click or `⏎` opens them over
 * it: one line of state and what to do about it. With `onClick` alone it's a button, as it is as a
 * `Popover`'s `trigger`, which gives it its click, its ref and the rest of a button's props.
 * Otherwise it's text, with no tooltip: what it says is all there is.
 */
export function StatusItem({
  ball,
  children,
  details,
  label,
  open,
  onOpenChange,
  initialFocus,
  container,
  title,
  onClick,
  ref,
  ...props
}: StatusItemProps) {
  const [kept, setKept] = useState(false);
  // The item as it's drawn now, whichever element that is, for focus to come back to as its details
  // end.
  const self = useRef<HTMLElement | null>(null);
  const mine = useCallback(
    (element: HTMLElement | null) => {
      self.current = element;
      // The caller's ref is for a button: an item that's text gives it none.
      const button = element instanceof HTMLButtonElement ? element : null;
      if (typeof ref === 'function') ref(button);
      else if (ref) ref.current = button;
    },
    [ref],
  );
  const content = (
    <>
      {ball !== undefined && <StatusBall state={ball} />}
      <span className="min-w-0 truncate">{children}</span>
    </>
  );
  if (details !== undefined) {
    const change = (next: boolean) => {
      setKept(next);
      onOpenChange?.(next);
    };
    return (
      <ItemDetails
        open={open ?? kept}
        onOpenChange={change}
        item={self}
        trigger={
          <button type="button" {...props} ref={mine} className={STATUS_BUTTON}>
            {content}
          </button>
        }
        label={label}
        initialFocus={initialFocus}
        container={container}
      >
        {details}
      </ItemDetails>
    );
  }
  if (onClick === undefined) {
    return (
      <span ref={mine} className={STATUS_ITEM}>
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      {...props}
      ref={mine}
      className={STATUS_BUTTON}
      title={title}
      onClick={onClick}
    >
      {content}
    </button>
  );
}

/**
 * A status item's details, over its trigger. Ended while they hold focus, as by an action that
 * takes them away, focus goes back to the item as it's drawn now (`item`), else to the bar's next
 * item, else its previous one, else the bar, not to the page.
 */
function ItemDetails({
  open,
  onOpenChange,
  item,
  trigger,
  label,
  initialFocus,
  container,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  item: RefObject<HTMLElement | null>;
  trigger: ReactElement<Record<string, unknown>>;
  label: string | undefined;
  initialFocus: RefObject<HTMLElement | null> | undefined;
  container: HTMLElement | null | undefined;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement | null>(null);
  useLayoutEffect(
    () => () => {
      const leaving = [item.current, popup.current];
      const stops = besideIn(item.current?.parentElement, leaving);
      handOffFocus(leaving, () => [item.current, ...stops]);
    },
    [item],
  );
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      trigger={trigger}
      side="top"
      label={label}
      scope="dialog"
      initialFocus={initialFocus}
      popupRef={popup}
      container={container}
      className="flex status-details flex-col gap-8 p-12"
    >
      {children}
    </Popover>
  );
}

/** The one line of state in a status item's details, which a screen reader reads as they open. */
export function StatusLine({ children }: { children: ReactNode }) {
  return (
    <PopoverDescription className="m-0 text-fg-muted text-small">{children}</PopoverDescription>
  );
}

/** What a status item's details offer to do, in a row under their line. */
export function StatusActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap gap-6">{children}</div>;
}

/**
 * The keys typed so far of a command still to come, before Vim's mode at the status bar's end, as
 * Vim shows a command it's waiting on the rest of: `g`, `2y`.
 */
export function StatusKeys({ keys }: { keys: string }) {
  return (
    <span className="flex-none text-fg code-key" title="Keys typed so far">
      {keys}
    </span>
  );
}

/** How each kind of mode draws, as a comment box's foot draws it. */
const MODES = {
  normal: 'mode-chip mode-chip-normal',
  visual: 'mode-chip',
  insert: 'mode-chip mode-chip-insert',
} as const;

/**
 * Vim's mode, at the status bar's end, named as Vim names it: `NORMAL`, `VISUAL`, `V-LINE`,
 * `V-BLOCK` or `INSERT`.
 */
export function StatusMode({ name }: { name: string }) {
  const kind = name === 'NORMAL' ? 'normal' : name === 'INSERT' ? 'insert' : 'visual';
  return (
    <span className={`flex-none ${MODES[kind]}`} title="Vim’s mode in the code that has focus">
      {name}
    </span>
  );
}
