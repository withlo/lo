import { Popover as Base } from '@base-ui/react/popover';
import {
  useCallback,
  useRef,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';

import { useTakeFocus } from './focus.ts';
import { giveFocusBack, useHeld, useOnClose } from './motion.ts';

export interface PopoverProps {
  open: boolean;
  /** `Esc`, a press outside it, or its trigger asks for it to open or close. */
  onOpenChange: (open: boolean) => void;
  /**
   * The control that opens it: one element, a `button` as a rule. The popover opens beside it, and
   * gives focus back to it.
   */
  trigger?: ReactElement<Record<string, unknown>> | undefined;
  /**
   * What it opens beside, for one that something else opens, such as a key: an element of the
   * page. Focus goes back to where it was.
   */
  anchor?: Element | null | undefined;
  /** Which side of that it opens on, unless there's no room. */
  side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  align?: 'start' | 'center' | 'end' | undefined;
  /** What it is, for screen readers, when no {@link PopoverTitle} in it says. */
  label?: string | undefined;
  /** The key scope its keys are read in: `dialog`, or one of its own. */
  scope?: string | undefined;
  /** What's in it. It keeps what it showed while it leaves. */
  children?: ReactNode;
  /** Classes for the panel: its width, its padding and how it lays its parts out. */
  className?: string | undefined;
  /** What has focus once it opens. Without one, the panel itself. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** The panel's element. */
  popupRef?: Ref<HTMLDivElement> | undefined;
  /**
   * It has closed, and focus has gone back. This comes as it starts to leave, not once it has
   * faded: nothing waits on an animation.
   */
  onClosed?: (() => void) | undefined;
  /** Where the popover is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

/**
 * A small panel beside what it's about: a status item's details, a picker. It's the one way Lo
 * draws a popover, so each comes and goes alike: with the Pop move, from the side it's anchored
 * on, taking focus as it mounts and giving it back the moment it's asked to close. Focus that went
 * somewhere else by itself, as a click on another control sends it, stays there.
 */
export function Popover({
  open,
  onOpenChange,
  trigger,
  anchor,
  side = 'bottom',
  align = 'start',
  label,
  scope,
  children,
  className,
  initialFocus,
  popupRef,
  onClosed,
  container,
}: PopoverProps) {
  const held = useHeld(open, { children, label });
  const popup = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  // What had focus as it starts to open is what gets it back, when no trigger of its own does.
  const origin = useRef<Element | null>(null);
  const was = useRef(false);
  if (open !== was.current) {
    was.current = open;
    if (open) origin.current = globalThis.document?.activeElement ?? null;
  }
  useOnClose(open, () => {
    const back = opener.current ?? origin.current;
    origin.current = null;
    giveFocusBack(
      back instanceof HTMLElement || back instanceof SVGElement ? back : null,
      popup.current,
    );
    onClosed?.();
  });
  // The panel takes focus as it mounts, not a frame on, so a key pressed then is its own.
  const takeFocus = useTakeFocus(initialFocus);
  const mounted = useCallback(
    (element: HTMLDivElement | null) => {
      popup.current = element;
      takeFocus(element);
      if (typeof popupRef === 'function') popupRef(element);
      else if (popupRef) popupRef.current = element;
    },
    [takeFocus, popupRef],
  );
  return (
    <Base.Root open={open} onOpenChange={(next) => onOpenChange(next)}>
      {trigger !== undefined && (
        <Base.Trigger
          ref={(element: HTMLElement | null) => {
            opener.current = element;
          }}
          render={trigger}
        />
      )}
      <Base.Portal container={container}>
        <Base.Positioner
          anchor={trigger === undefined ? anchor : undefined}
          side={side}
          align={align}
          sideOffset={6}
          collisionPadding={8}
          className="z-popover outline-none"
        >
          <Base.Popup
            ref={mounted}
            initialFocus={false}
            finalFocus={false}
            // Leaving, it takes no focus: a caller that focuses something in it as it closes, a
            // frame or two on, would leave focus on nothing once it's gone.
            inert={!open}
            aria-label={held.label}
            data-lo-scope={scope}
            className={`move-pop rounded-md bg-bg-overlay text-fg shadow-pop outline-none text-ui ${className ?? ''}`}
          >
            {held.children}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}

/** A popover's heading, which names it to a screen reader. */
export const PopoverTitle = Base.Title;

/** A line under a popover's heading, which a screen reader reads with it. */
export const PopoverDescription = Base.Description;
