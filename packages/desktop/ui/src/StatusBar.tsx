import {
  Fragment,
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

import { CommandButton, type CommandButtonProps } from './CommandButton.tsx';
import { besideIn, handOffFocus } from './focus.ts';
import { keyAria } from './Key.tsx';
import { Popover, PopoverDescription } from './Popover.tsx';
import { Spinner } from './Spinner.tsx';
import { Tooltip } from './Tooltip.tsx';

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

/**
 * A status item's ball: what it says of the item, the item's label says in words. It holds the
 * spinner's room, so the label stays put as the item's work starts and ends.
 */
export function StatusBall({ state }: { state: StatusBallState }) {
  if (state === 'working') return <Spinner />;
  return (
    <span className="flex size-12 flex-none items-center justify-center" aria-hidden="true">
      <span className={`size-8 rounded-full ${BALLS[state]}`} data-ball={state} />
    </span>
  );
}

/** The look of an item that's text. */
export const STATUS_ITEM = 'inline-flex h-20 min-w-0 items-center gap-6 rounded-xs px-6';

/** The look of an item that's a button: it answers the pointer and shows focus. */
export const STATUS_BUTTON = `${STATUS_ITEM} hover:bg-hover hover:text-fg focus-visible:shadow-ring`;

/** What a status item's details hold: something, never nothing. */
export type StatusDetails = Exclude<ReactNode, null | undefined | boolean>;

interface StatusItemBase extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children' | 'title' | 'onClick'
> {
  /** Its label: the thing, and its state where the ball isn't enough. */
  children: ReactNode;
  /**
   * Its details' name, for a screen reader: the item's own words. Without one, its label's, where
   * that's text.
   */
  label?: string | undefined;
  /** Whether its details are open. Without it, the item keeps its own. */
  open?: boolean | undefined;
  onOpenChange?: ((open: boolean) => void) | undefined;
  /** What in its details has focus as they open. Without it, the details themselves. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** Where its details are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /**
   * Its tooltip, for an item that's a command's button, as a `Popover`'s trigger may be: the
   * command's label. Without one, an item whose label is cut short shows it whole as its tooltip.
   */
  hint?: string | undefined;
  /** The command's key, shown in the tooltip, as the system shows each key of it. */
  hintKeys?: readonly string[] | undefined;
  /** That key as `aria-keyshortcuts` says it, which a screen reader hears in place of the caps. */
  hintShortcut?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}

type OnClick = ButtonHTMLAttributes<HTMLButtonElement>['onClick'];

/**
 * A status item's props. One with a ball is work Lo does, and a click on it always opens something:
 * its `details`, or what its `onClick` does, such as the view it says is ready. Only an item with
 * no ball, a fact such as a count or a time, may be text.
 */
export type StatusItemProps = StatusItemBase &
  (
    | {
        /** How its work stands. */
        ball: StatusBallState;
        /**
         * What a click on it opens over it: one line of state, the facts it knows, and what can be
         * done about it, such as a `Problem` with its one action.
         */
        details: StatusDetails;
        onClick?: undefined;
      }
    | {
        ball: StatusBallState;
        details?: undefined;
        /** It's a button, for something it does, without details of its own. */
        onClick: OnClick;
      }
    | {
        /** Without a ball, it's a fact with no state of its own, as a count is. */
        ball?: undefined;
        details?: StatusDetails | undefined;
        onClick?: OnClick | undefined;
      }
  );

/**
 * One piece of background work in the status bar: a ball for how it stands, and a label. It keeps
 * its place in the bar from one state to the next. With `details`, a click or `⏎` opens them over
 * it: one line of state, the facts it knows and what to do about it. With `onClick` alone it's a
 * button, as it is as a `Popover`'s `trigger`, which gives it its click, its ref and the rest of a
 * button's props. An item with a ball has one or the other, whatever its state, so a click on it
 * always opens something. Only a fact with no ball is text, with no tooltip: what it says is all
 * there is. A label cut short, in a narrow window, shows whole as its tooltip.
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
  hint,
  hintKeys,
  hintShortcut,
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
          <ItemButton {...props} ref={mine} tip={children}>
            {content}
          </ItemButton>
        }
        label={label ?? wordsOf(children)}
        initialFocus={initialFocus}
        container={container}
      >
        {details}
      </ItemDetails>
    );
  }
  if (onClick === undefined) {
    return (
      <Tooltip label={children} side="top" cut>
        <span ref={mine} className={STATUS_ITEM}>
          {content}
        </span>
      </Tooltip>
    );
  }
  return (
    <ItemButton
      {...props}
      ref={mine}
      tip={children}
      hint={hint}
      hintKeys={hintKeys}
      hintShortcut={hintShortcut}
      onClick={onClick}
    >
      {content}
    </ItemButton>
  );
}

/** `children` as text, where it's only text and numbers: "Showing #84 alone". */
function wordsOf(children: ReactNode): string | undefined {
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (!Array.isArray(children)) return undefined;
  const parts: unknown[] = children;
  return parts.every((part) => typeof part === 'string' || typeof part === 'number')
    ? parts.join('')
    : undefined;
}

/**
 * An item that's a button, with its tooltip: its command's label and key where it has a `hint`,
 * else its label whole, `tip`, while it's cut short. It takes the rest of a button's props, as from
 * a `Popover` it's the trigger of.
 */
function ItemButton({
  tip,
  hint,
  hintKeys,
  hintShortcut,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tip: ReactNode;
  hint?: string | undefined;
  hintKeys?: readonly string[] | undefined;
  hintShortcut?: string | undefined;
  ref?: Ref<HTMLButtonElement> | undefined;
}) {
  return (
    <Tooltip
      label={hint ?? tip}
      keys={hint === undefined ? undefined : hintKeys}
      side="top"
      cut={hint === undefined}
    >
      <button
        type="button"
        {...(hint === undefined ? {} : keyAria(hintKeys, hintShortcut))}
        {...props}
        className={STATUS_BUTTON}
      />
    </Tooltip>
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

/**
 * What a status item's details offer to do, in a row under their line. `flush` when the first is a
 * ghost button, as Details alone is: its text sits on the line's edge, as the line's does.
 */
export function StatusActions({ children, flush }: { children: ReactNode; flush?: boolean }) {
  return <div className={`flex flex-wrap gap-6 ${flush ? '-ms-8' : ''}`}>{children}</div>;
}

/** One fact a status item's details state: what it is, in a word, and what it says. */
export interface StatusFact {
  /** A word or two: "Files", "Folder", "Indexed". */
  label: string;
  value: ReactNode;
}

/**
 * The facts a status item knows, under its line, in two columns: what it covers and when it last
 * ran, say. Each is one it knows, never a guess, and a path or a commit ID is code.
 */
export function StatusFacts({ items }: { items: readonly StatusFact[] }) {
  return (
    <dl className="m-0 facts text-small">
      {items.map((item) => (
        <Fragment key={item.label}>
          <dt className="text-fg-muted">{item.label}</dt>
          <dd className="m-0 min-w-0 break-words text-fg">{item.value}</dd>
        </Fragment>
      ))}
    </dl>
  );
}

/**
 * A button in a status item's details for a command, in their `StatusActions`: the first, what
 * helps most, is `secondary`, and the rest `ghost`. Its key is in its tooltip, since keys don't
 * reach the item's work while its details have focus.
 */
export function StatusCommand({
  variant = 'secondary',
  ...props
}: Omit<CommandButtonProps, 'size'>) {
  return <CommandButton variant={variant} size="sm" {...props} />;
}

/**
 * The keys typed so far of a command still to come, before Vim's mode at the status bar's end, as
 * Vim shows a command it's waiting on the rest of: `g`, `2y`.
 */
export function StatusKeys({ keys }: { keys: string }) {
  return (
    <Tooltip label="Keys typed" side="top">
      <span
        className="flex-none text-fg code-key"
        role="img"
        aria-label={`Keys typed: ${keys}`}
        data-lo-keys-typed=""
      >
        {keys}
      </span>
    </Tooltip>
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
  return <span className={`flex-none ${MODES[kind]}`}>{name}</span>;
}
