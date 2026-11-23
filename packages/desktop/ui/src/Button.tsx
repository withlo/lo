import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps, MouseEvent, ReactNode } from 'react';

import { keyAria } from './Key.tsx';
import { Spinner } from './Spinner.tsx';
import { Tooltip } from './Tooltip.tsx';

/**
 * A button that can't be pressed keeps its box and its size, so a row is laid out the same whatever
 * its buttons can do: a quiet outline, a flat fill, a dimmed label.
 */
const BOXED_OFF =
  'disabled:border-border-subtle disabled:bg-bg-element not-aria-busy:aria-disabled:border-border-subtle not-aria-busy:aria-disabled:bg-bg-element';

const button = cva(
  'inline-flex flex-none items-center justify-center rounded-sm border whitespace-nowrap move-tint focus-visible:shadow-ring disabled:text-fg-disabled not-aria-busy:aria-disabled:text-fg-disabled',
  {
    variants: {
      variant: {
        secondary: `border-border-strong bg-bg-element text-fg hover:bg-bg-element-hover active:bg-bg-element-press ${BOXED_OFF}`,
        // The one main action in a view.
        primary: `border-transparent bg-accent text-on-accent hover:bg-accent-hover active:bg-accent-press ${BOXED_OFF}`,
        // In toolbars and headers, where a border would be noise. A toggle's is pressed while on.
        // It has no box to keep, so one that can't be pressed is its dimmed label.
        ghost:
          'border-transparent bg-transparent text-fg-muted hover:bg-hover hover:text-fg disabled:bg-transparent not-aria-busy:aria-disabled:bg-transparent aria-pressed:bg-selected aria-pressed:text-fg',
        // Destructive or refusing.
        danger: `border-danger-border bg-danger-bg text-danger ${BOXED_OFF}`,
      },
      size: {
        md: 'h-control-h gap-6 px-12',
        sm: 'h-control-h-sm gap-4 px-8',
      },
      icon: {
        true: 'px-0',
        false: '',
      },
    },
    compoundVariants: [
      { size: 'md', icon: true, class: 'w-control-h' },
      { size: 'sm', icon: true, class: 'w-control-h-sm' },
      { size: 'md', variant: 'primary', class: 'text-ui-strong' },
      { size: 'md', variant: ['secondary', 'ghost', 'danger'], class: 'text-ui-medium' },
      { size: 'sm', class: 'text-small-medium' },
    ],
    defaultVariants: { variant: 'secondary', size: 'md', icon: false },
  },
);

/** The two things a button that does work says, one over the other, so its width never changes. */
const face = cva('col-start-1 row-start-1 inline-flex items-center', {
  variants: {
    size: { md: 'gap-6', sm: 'gap-4' },
    shown: { true: '', false: 'invisible' },
    align: { center: 'justify-center', end: 'justify-end' },
  },
});

export interface ButtonProps
  extends
    Omit<ComponentProps<'button'>, 'className' | 'title'>,
    Omit<VariantProps<typeof button>, 'icon'> {
  /** A square button holding an icon alone. Give it an `aria-label`. */
  icon?: boolean | undefined;
  /**
   * It's doing what it was pressed for. A ring turns where its icon was, its label turns to
   * `working`, and its fill, its width and focus stay as they were; pressing it does nothing until
   * it's done. Pass `false` while it rests, not nothing, so the button holds room for both.
   */
  busy?: boolean | undefined;
  /**
   * What it says while busy, the verb of its label: "Merging…" for "Merge #264". Without one, it
   * says its label beside the ring. A button that can be its icon alone gives it as its label is
   * given, so that as its icon, the ring takes the icon's place.
   */
  working?: ReactNode;
  /**
   * The widest thing it says while busy, for a button whose `working` changes as its work goes on,
   * or whose label does: "Trusting…" for one that says "Waiting…" first. It holds that room, with
   * the ring's, from before its press, so nothing it comes to say changes its width.
   */
  widest?: string | undefined;
  /**
   * Where what it says sits in the room it holds for what it says while busy: in the middle, or
   * at the `end`, for a button at the end of a row, whose label then ends where the row does
   * whichever it says.
   */
  align?: 'center' | 'end' | undefined;
  /**
   * Its tooltip: what it is or does, for a button whose face doesn't say, such as an icon's. On a
   * `disabled` button it's the reason it can't be pressed now, in a few words with no full stop:
   * "Sign in to comment". The button is then dimmed and out of the tab order as any disabled one
   * is, and still shows its tooltip under the pointer, which a `disabled` element wouldn't. A screen
   * reader hears the reason as its description, so give it as text. `''` dims it with nothing to
   * say, where the dimmed label says it all: no tooltip and no description.
   *
   * A button that has one only some of the time, as a reason comes and goes, passes `null`
   * meanwhile, not nothing: it's then the same element throughout, and keeps focus.
   */
  hint?: ReactNode;
  /** Its key, shown in the tooltip, as the system shows each key of it. */
  hintKeys?: readonly string[] | undefined;
  /**
   * That key as `aria-keyshortcuts` says it (`liveShortcut` gives it), which a screen reader hears
   * in place of the tooltip's key caps. A sequence has none, and is described from `hintKeys`.
   */
  hintShortcut?: string | undefined;
  /** With `'hover'`, the tooltip comes for the pointer alone, as `Tooltip`'s `on` says. */
  hintOn?: 'hover' | undefined;
}

/**
 * A control that does one thing. Its label starts with a verb that says exactly what happens, and
 * a key it has goes inside it (`<Key keys={['⌘⏎']} />`). One `primary` button in a view at most.
 * While its work runs it's `busy`; a spinner beside it, or a button greyed out, isn't how it waits.
 * One that can't be pressed now is `disabled`, with the reason as its `hint`.
 */
export function Button({
  variant,
  size,
  icon,
  type = 'button',
  busy,
  working,
  widest,
  align = 'center',
  hint,
  hintKeys,
  hintShortcut,
  hintOn,
  disabled,
  onClick,
  children,
  ...props
}: ButtonProps) {
  const works = busy !== undefined || working !== undefined || widest !== undefined;
  // Dimmed, with why: said to be disabled, not made so, since a `disabled` button gets no pointer
  // and so no tooltip.
  const hinted = hint !== undefined && hint !== null;
  const refused = disabled === true && hinted;
  const control = (
    <button
      type={type}
      className={button({ variant, size, icon })}
      // A key cap on its fill is drawn in the fill's text colour (`key-cap`).
      data-fill={variant === 'primary' ? '' : undefined}
      disabled={refused ? undefined : disabled}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        if (busy === true || refused) event.preventDefault();
        else onClick?.(event);
      }}
      // The tooltip's key, said to a screen reader, which never hears the tooltip's key caps.
      {...(hinted && !refused ? keyAria(hintKeys, hintShortcut) : {})}
      {...props}
      {...(refused
        ? {
            'aria-disabled': true,
            tabIndex: -1,
            'aria-description': typeof hint === 'string' && hint !== '' ? hint : undefined,
          }
        : {})}
      // Not `disabled`, which would drop focus from it. It's said to be unavailable while it works,
      // and doesn't look it: only a button that isn't busy greys out.
      {...(busy === true ? { 'aria-busy': true, 'aria-disabled': true } : {})}
    >
      {works ? (
        <span className="inline-grid">
          <span
            className={face({ size: size ?? 'md', shown: busy !== true, align })}
            aria-hidden={busy === true ? true : undefined}
          >
            {children}
          </span>
          <span
            className={face({ size: size ?? 'md', shown: busy === true, align })}
            aria-hidden={busy === true ? undefined : true}
          >
            {busy === true ? (
              <Spinner size={size === 'sm' ? 'xs' : 'sm'} tone="current" />
            ) : (
              // The ring's room, kept while nothing turns in it.
              <span className={size === 'sm' ? 'size-8 flex-none' : 'size-12 flex-none'} />
            )}
            {/* Without words of its own for the wait, it keeps its label, and so its name. */}
            {working ?? children}
          </span>
          {widest !== undefined && (
            <span className={face({ size: size ?? 'md', shown: false, align })} aria-hidden="true">
              <span className={size === 'sm' ? 'size-8 flex-none' : 'size-12 flex-none'} />
              {widest}
            </span>
          )}
        </span>
      ) : (
        children
      )}
    </button>
  );
  if (hint === undefined) return control;
  return (
    // An empty reason has nothing to say, and the tooltip stays, empty, so the element does too.
    <Tooltip label={hint === '' ? null : hint} keys={refused ? undefined : hintKeys} on={hintOn}>
      {control}
    </Tooltip>
  );
}
