import { Tooltip as Base } from '@base-ui/react/tooltip';
import {
  createContext,
  useCallback,
  useContext,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { cutShort } from './cut.ts';
import { Glyphs } from './Icon.tsx';
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
  /**
   * What the control is or does, in a few words: "Next unread file". With `null` there's nothing
   * to show and it stays shut, in place: a control whose tooltip comes and goes is the same
   * element throughout.
   */
  label: ReactNode;
  /** Its key, as the system shows each key of it: `[']', 'f']`. */
  keys?: readonly string[] | undefined;
  /** Which side of the control it shows on, unless there's no room. */
  side?: 'top' | 'bottom' | 'left' | 'right' | undefined;
  /**
   * With `'hover'`, it comes for the pointer alone and never for focus: for a control a view puts
   * focus on by itself, such as a dialog's main button, where a tooltip nobody asked for would
   * sit over the view as it opens.
   */
  on?: 'hover' | undefined;
  /**
   * It shows only while the text it's around is cut short with an ellipsis, as a long path or
   * title is in a narrow row, and its label is then that text whole. A name drawn whole has no
   * tooltip: it would only say it again.
   */
  cut?: boolean | undefined;
  /** The control: one element, which takes the props that make it the trigger. */
  children: ReactElement<Record<string, unknown>>;
}

/**
 * A control's name and its key, shown after the pointer rests on it or focus reaches it by key.
 * It names the control and nothing more: it never carries an error, a state, or anything that's
 * the only place to learn something. The one exception is a dimmed control, whose tooltip is the
 * reason it can't be used now, which a screen reader hears as the control's description. `Button`
 * takes either through its `hint`.
 *
 * A mark with no words, such as a file's change letter, shows its name alone, with no key. So does a
 * name cut short, with `cut`: the name whole, only while it's cut.
 *
 * It isn't the control's accessible name: an icon button still has its `aria-label`, and gives its
 * key with `aria-keyshortcuts`, as `Button` does from its `hintShortcut`.
 */
export function Tooltip({ label, keys, side = 'bottom', on, cut, children }: TooltipProps) {
  const container = useContext(Container);
  const trigger = useRef<HTMLElement | null>(null);
  // One function throughout, so the ref Base UI merges it into, and the control's own, stay put.
  const setTrigger = useCallback((element: HTMLElement | null) => {
    trigger.current = element;
  }, []);
  return (
    <Base.Root
      disabled={label === null}
      onOpenChange={(open, details) => {
        if (!open) return;
        if (on === 'hover' && details.reason === 'trigger-focus') details.cancel();
        // Asked as it's about to show, so a row that narrowed or widened since is taken as it is.
        else if (cut === true && !(trigger.current !== null && cutShort(trigger.current))) {
          details.cancel();
        }
      }}
    >
      <Base.Trigger ref={setTrigger} render={children} delay={TOOLTIP_DELAY} />
      <Base.Portal container={container ?? globalThis.document?.querySelector('.lo-app')}>
        <Base.Positioner side={side} sideOffset={6} collisionPadding={8} className="z-tooltip">
          <Base.Popup className="tooltip move-pop flex items-center gap-8 rounded-sm bg-bg-overlay px-8 py-4 text-fg shadow-pop text-small">
            {typeof label === 'string' ? (
              <span>
                <Glyphs text={label} />
              </span>
            ) : (
              label
            )}
            {keys !== undefined && keys.length > 0 && <Key keys={keys} quiet decorative />}
          </Base.Popup>
        </Base.Positioner>
      </Base.Portal>
    </Base.Root>
  );
}
