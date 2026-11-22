import { Dialog as Base } from '@base-ui/react/dialog';
import { cva } from 'class-variance-authority';
import { useCallback, useRef, type KeyboardEvent, type ReactNode, type RefObject } from 'react';

import { Button } from './Button.tsx';
import { useTakeFocus } from './focus.ts';
import { Key } from './Key.tsx';
import { motionReduced, useHeld, useOnClose } from './motion.ts';
import { Problem, type ProblemProps } from './Problem.tsx';
import { useReturnFocus } from './returnFocus.ts';

/** How wide a dialog is: `sm` for a question, `md` for a form, `lg` for something to read. */
export type DialogSize = 'sm' | 'md' | 'lg';

/**
 * Where a dialog that does something has got to. `ask`: nothing is sent yet. `working`: it's being
 * done. `done`: it worked, for a dialog that stays to say so. `failed`: it didn't, and can be tried
 * again.
 */
export type DialogState = 'ask' | 'working' | 'done' | 'failed';

/** What a dialog does: its one main button. */
export interface DialogAction {
  /** The action and what it acts on: "Merge #264", never "OK" or "Confirm". */
  label: string;
  /** What the button says while it's being done, the verb alone: "Merging…". */
  working?: string | undefined;
  onRun: () => void;
  /** The key that runs it, as the system shows it: `['⏎']`. */
  keys?: readonly string[] | undefined;
  /** `danger` for what destroys or refuses. */
  tone?: 'primary' | 'danger' | undefined;
  /** Why it can't be run yet, said to a screen reader; the button is greyed and does nothing. */
  disabled?: string | undefined;
}

export interface DialogProps {
  open: boolean;
  /**
   * `Esc`, or a click outside it, asks for it to close. While its `state` is `working` it isn't
   * asked: what's being done can't be left, as its Cancel says.
   */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  /** What it asks or shows. */
  children?: ReactNode;
  /** How wide it is. `md` without one. */
  size?: DialogSize | undefined;
  /**
   * Where it has got to, for a dialog with an `action`. The body stays the same through all four:
   * only the foot changes, so nothing jumps.
   */
  state?: DialogState | undefined;
  /**
   * What it does. With one, the dialog draws its own foot: the button that leaves, then this one.
   * The button that leaves reads `Cancel` until something is sent, `Close` after a failure, and
   * `Done` once it has worked.
   */
  action?: DialogAction | undefined;
  /** What went wrong, shown above the foot while `state` is `failed`. The title isn't said again. */
  problem?: Omit<ProblemProps, 'layout' | 'action'> | undefined;
  /** The start of the foot it draws: what it acts as, such as the account. */
  note?: ReactNode;
  /** The key on the button that leaves, as the system shows it: `['Esc']`. */
  leaveKeys?: readonly string[] | undefined;
  /**
   * A foot of its own, in place of the one `action` draws, for a dialog that only shows something:
   * what it acts as on the left, then a {@link DialogSpacer}, then its buttons, each with its key.
   */
  foot?: ReactNode;
  /**
   * What has focus once it opens. Without one it's the main button of the foot the dialog draws,
   * or what Base UI chooses.
   */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** A key pressed anywhere in it, before the control with focus gets it. */
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** Where the dialog is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /**
   * It has closed, and focus has gone back to where it was, if focus was still its own: focus that
   * moved into a dialog or popup that opened in its place stays there. This comes as it starts to
   * leave, not once it has faded: nothing waits on an animation. It keeps what it showed while it
   * fades, so a caller is free to clear its state here.
   */
  onClosed?: (() => void) | undefined;
  /** For tests to find it by. */
  testId?: string | undefined;
}

const popup = cva(
  'move-sheet flex max-h-full max-w-full flex-col overflow-hidden rounded-lg bg-bg-overlay text-fg shadow-dialog text-ui',
  {
    variants: {
      size: { sm: 'w-dialog-w-sm', md: 'w-dialog-w', lg: 'w-dialog-w-lg' },
    },
  },
);

/**
 * A focused decision over a dimmed window, such as signing in. It says exactly what will happen
 * before anything does. `⏎` confirms and `Esc` cancels: show both on its buttons. Never stack two.
 *
 * Its top edge stays where it is: a step taller than the last grows downward. It comes and goes
 * with the Sheet move, and gives focus back the moment it's asked to close.
 */
export function Dialog(props: DialogProps) {
  const { open, onOpenChange, initialFocus, onKeyDown, container, onClosed, testId } = props;
  // What it shows stays as it was while it leaves.
  const { title, description, children, size, state, action, problem, note, leaveKeys, foot } =
    useHeld(open, props);
  const returnFocus = useReturnFocus(open);
  const panel = useRef<HTMLDivElement | null>(null);
  useOnClose(open, () => {
    returnFocus(panel.current);
    onClosed?.();
  });
  const main = useRef<HTMLButtonElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const focus = initialFocus ?? (action !== undefined && foot === undefined ? main : undefined);
  // What `focus` names has focus as the dialog mounts, not a frame on, and without scrolling its
  // body. Without it, Base UI chooses where focus goes.
  const takeFocus = useTakeFocus(focus);
  const grow = useGrow(body);
  const mounted = useCallback(
    (element: HTMLDivElement | null) => {
      panel.current = element;
      grow(element);
      if (focus) takeFocus(element);
    },
    [grow, takeFocus, focus],
  );
  return (
    <Base.Root
      open={open}
      onOpenChange={(next, details) => {
        // Esc and a click outside refuse while it works, as its Cancel does.
        if (!next && open && props.state === 'working') {
          details.cancel();
          return;
        }
        onOpenChange(next);
      }}
    >
      <Base.Portal container={container}>
        <Base.Backdrop className="move-scrim fixed inset-0 z-dialog bg-scrim" />
        <Base.Viewport className="fixed inset-0 z-dialog flex items-start justify-center px-16 pt-dialog-top pb-16">
          <Base.Popup
            ref={mounted}
            // Base UI would focus it again a frame on, scrolling the body to it.
            initialFocus={focus === undefined ? undefined : skip}
            finalFocus={false}
            // Leaving, it takes no focus: a caller that focuses something in it as it closes, a
            // frame or two on, would leave focus on nothing once it's gone.
            inert={!open}
            data-lo-scope="dialog"
            data-testid={testId}
            onKeyDown={onKeyDown}
            className={popup({ size: size ?? 'md' })}
          >
            <div className="flex flex-none items-start gap-12 px-20 pt-16 pb-4">
              <div className="min-w-0">
                <Base.Title className="m-0 text-title">{title}</Base.Title>
                {description !== undefined && (
                  <Base.Description className="m-0 mt-2 text-fg-muted text-small">
                    {description}
                  </Base.Description>
                )}
              </div>
            </div>
            <div
              ref={body}
              className="flex min-h-0 flex-col gap-12 overflow-auto px-20 pt-12 pb-16"
            >
              {children}
              {foot === undefined && state === 'failed' && problem !== undefined && (
                <Problem {...problem} layout="inline" />
              )}
            </div>
            {foot !== undefined ? (
              <Foot>{foot}</Foot>
            ) : (
              action !== undefined && (
                <Foot>
                  {note}
                  <DialogSpacer />
                  {state !== 'done' && (
                    <Button
                      aria-disabled={state === 'working' ? true : undefined}
                      onClick={() => {
                        if (state !== 'working') onOpenChange(false);
                      }}
                    >
                      {state === 'failed' ? 'Close' : 'Cancel'}
                      {leaveKeys && <Key keys={leaveKeys} decorative />}
                    </Button>
                  )}
                  {state === 'done' ? (
                    <Button ref={main} variant="primary" onClick={() => onOpenChange(false)}>
                      Done
                      {action.keys && <Key keys={action.keys} decorative />}
                    </Button>
                  ) : (
                    <Button
                      ref={main}
                      variant={action.tone ?? 'primary'}
                      busy={state === 'working'}
                      working={action.working}
                      aria-disabled={action.disabled === undefined ? undefined : true}
                      aria-description={action.disabled}
                      onClick={() => {
                        if (action.disabled === undefined) action.onRun();
                      }}
                    >
                      {state === 'failed' ? 'Try again' : action.label}
                      {action.keys && <Key keys={action.keys} decorative />}
                    </Button>
                  )}
                </Foot>
              )
            )}
          </Base.Popup>
        </Base.Viewport>
      </Base.Portal>
    </Base.Root>
  );
}

function Foot({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-none flex-wrap items-center gap-8 border-t border-border-subtle bg-bg-chrome px-20 py-12 text-fg-muted text-small">
      {children}
    </div>
  );
}

/** Tells Base UI to focus nothing: the dialog has focused what it means to. */
const skip = () => false;

/**
 * A ref for a dialog's panel that moves its height when what's in it changes, as one step of a
 * dialog gives way to a taller one: the panel grows to the new height in the Sheet move's time,
 * and its top edge stays put. A window resized changes it at once.
 *
 * While it grows the panel has `data-growing`, and its body is clipped at the top, not scrolled:
 * the body is shorter than what's in it until the move ends, and would show a scroll bar or scroll
 * to a control focused meanwhile.
 */
function useGrow(body: RefObject<HTMLElement | null>): (panel: HTMLElement | null) => void {
  const watch = useRef<ResizeObserver | undefined>(undefined);
  return useCallback(
    (panel: HTMLElement | null) => {
      watch.current?.disconnect();
      watch.current = undefined;
      if (!panel || typeof ResizeObserver === 'undefined') return;
      const view = panel.ownerDocument.defaultView;
      let last: number | undefined;
      let within = { width: view?.innerWidth, height: view?.innerHeight };
      let moving = false;
      watch.current = new ResizeObserver(() => {
        // Its own frames, as it grows.
        if (moving) return;
        const from = last;
        const to = panel.offsetHeight;
        last = to;
        const was = within;
        within = { width: view?.innerWidth, height: view?.innerHeight };
        if (from === undefined || from === to || to === 0) return;
        if (was.width !== within.width || was.height !== within.height) return;
        if (motionReduced() || typeof panel.animate !== 'function') return;
        // Leaving: it fades where it is.
        if (panel.hasAttribute('data-ending-style') || panel.hasAttribute('data-closed')) return;
        const style = getComputedStyle(panel);
        const move = panel.animate(
          { height: [`${from}px`, `${to}px`] },
          {
            duration: milliseconds(style.getPropertyValue('--lo-dur')),
            easing: style.getPropertyValue('--lo-ease-in-out').trim() || 'ease-in-out',
          },
        );
        moving = true;
        panel.setAttribute('data-growing', '');
        const inside = body.current;
        if (inside) {
          inside.scrollTop = 0;
          // `clip` on both axes: `overflow-y: clip` beside `overflow-x: auto` would be `hidden`,
          // which still scrolls to a control that takes focus.
          inside.style.overflow = 'clip';
        }
        const rest = () => {
          moving = false;
          panel.removeAttribute('data-growing');
          inside?.style.removeProperty('overflow');
          last = panel.offsetHeight;
        };
        move.finished.then(rest, rest);
      });
      watch.current.observe(panel);
    },
    [body],
  );
}

/** A CSS time as milliseconds: `160ms`, `0.16s`. */
function milliseconds(time: string): number {
  const value = Number.parseFloat(time);
  if (Number.isNaN(value)) return 0;
  return time.trim().endsWith('ms') ? value : value * 1000;
}

/** Pushes what follows it in a dialog's foot to the end. */
export function DialogSpacer() {
  return <span className="flex-1" />;
}
