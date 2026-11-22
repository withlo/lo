import { Tooltip as Base } from '@base-ui/react/tooltip';
import { createContext, useContext, type ReactElement, type ReactNode } from 'react';

import { Key } from './Key.tsx';

/** How long the pointer rests on a control before its tooltip comes, in milliseconds. */
export const TOOLTIP_DELAY = 500;

const Container = createContext<HTMLElement | null | undefined>(undefined);

export interface TooltipGroupProps {
  children?: ReactNode;
  /** Where tooltips are put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
}

/**
 * Makes neighbours of the controls inside it: once one tooltip has shown, the next control's comes
 * with no delay, so a row of icon buttons can be read by running the pointer along it. One goes
 * around the window.
 */
export function TooltipGroup({ children, container }: TooltipGroupProps) {
  return (
    <Base.Provider delay={TOOLTIP_DELAY} closeDelay={0}>
      <Container value={container}>{children}</Container>
    </Base.Provider>
  );
}

export interface TooltipProps {
  /** What the control is or does, in a few words: "Next unread file". */
  label: ReactNode;
  /** Its key, as the system shows each key of it: `[']', 'f']`. */
  keys?: readonly string[] | undefined;
  /** Which side of the control it shows on, unless there's no room. */
  side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  /** The control: one element, which takes the props that make it the trigger. */
  children: ReactElement<Record<string, unknown>>;
}

/**
 * A control's name and its key, shown after the pointer rests on it or focus reaches it by key.
 * It names the control and nothing more: it never carries an error, a state, or anything that's
 * the only place to learn something. `Button` takes one through its `hint`.
 *
 * It isn't the control's accessible name: an icon button still has its `aria-label`, and gives its
 * key with `aria-keyshortcuts`, as `Button` does from its `hintShortcut`.
 */
export function Tooltip({ label, keys, side = 'bottom', children }: TooltipProps) {
  const container = useContext(Container);
  return (
    <Base.Root>
      <Base.Trigger render={children} delay={TOOLTIP_DELAY} />
      <Base.Portal container={container ?? globalThis.document?.querySelector('.lo-app')}>
        <Base.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-tooltip">
          <Base.Popup className="tooltip move-pop flex items-center gap-8 rounded-sm bg-bg-overlay px-8 py-4 text-fg shadow-pop text-small">
            {label}
            {keys !== undefined && keys.length > 0 && <Key keys={keys} quiet decorative />}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
