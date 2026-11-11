import { Dialog as Base } from '@base-ui/react/dialog';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';

import { useTakeFocus } from './focus.ts';
import { useReturnFocus } from './returnFocus.ts';

export interface DialogProps {
  open: boolean;
  /** `Esc`, or a click outside it, asks for it to close. */
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  /** A line under the title. */
  description?: ReactNode;
  /** What it asks or shows. */
  children?: ReactNode;
  /**
   * Its foot: what it acts as on the left, such as the account, then a {@link DialogSpacer}, then
   * its buttons, each with its key.
   */
  foot?: ReactNode;
  /** What has focus once it opens: its main button, as a rule. */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /** A key pressed anywhere in it, before the control with focus gets it. */
  onKeyDown?: ((event: KeyboardEvent<HTMLDivElement>) => void) | undefined;
  /** Where the dialog is put in the page: an element inside `.lo-app`. */
  container?: HTMLElement | null | undefined;
  /** It has closed, and focus has gone back to where it was. */
  onClosed?: (() => void) | undefined;
  /** For tests to find it by. */
  testId?: string | undefined;
}

/**
 * A focused decision over a dimmed window, such as signing in. It says exactly what will happen
 * before anything does. `⏎` confirms and `Esc` cancels: show both on its buttons. Never stack two.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  foot,
  initialFocus,
  onKeyDown,
  container,
  onClosed,
  testId,
}: DialogProps) {
  const returnFocus = useReturnFocus(open);
  // What `initialFocus` names has focus as the dialog mounts, not a frame on. Without it, Base UI
  // chooses where focus goes.
  const takeFocus = useTakeFocus(initialFocus);
  return (
    <Base.Root
      open={open}
      onOpenChange={(next) => onOpenChange(next)}
      onOpenChangeComplete={(next) => {
        if (!next) {
          returnFocus();
          onClosed?.();
        }
      }}
    >
      <Base.Portal container={container}>
        <Base.Backdrop className="fixed inset-0 z-dialog bg-scrim" />
        <Base.Viewport className="fixed inset-0 z-dialog flex items-center justify-center p-16">
          <Base.Popup
            ref={initialFocus ? takeFocus : undefined}
            initialFocus={initialFocus}
            finalFocus={false}
            data-lo-scope="dialog"
            data-testid={testId}
            onKeyDown={onKeyDown}
            className="flex max-h-full w-dialog-w max-w-full flex-col overflow-hidden rounded-lg bg-bg-overlay text-fg shadow-dialog text-ui"
          >
            <div className="flex items-start gap-12 ps-20 pe-16 pt-16 pb-4">
              <div className="min-w-0">
                <Base.Title className="m-0 text-title">{title}</Base.Title>
                {description !== undefined && (
                  <Base.Description className="m-0 mt-2 text-fg-muted text-small">
                    {description}
                  </Base.Description>
                )}
              </div>
            </div>
            <div className="flex min-h-0 flex-col gap-12 overflow-auto px-20 pt-12 pb-16">
              {children}
            </div>
            {foot !== undefined && (
              <div className="flex flex-none flex-wrap items-center gap-8 border-t border-border-subtle bg-bg-chrome py-12 ps-20 pe-16 text-fg-muted text-small">
                {foot}
              </div>
            )}
          </Base.Popup>
        </Base.Viewport>
      </Base.Portal>
    </Base.Root>
  );
}

/** Pushes what follows it in a dialog's foot to the end. */
export function DialogSpacer() {
  return <span className="flex-1" />;
}
