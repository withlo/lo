import { NO_TARGET } from '@lo/ui/commands';
import type { UIEvent } from 'react';

import { TabPage, TabStrip } from '../features/tab/window/Frame.tsx';
import { dialogs, toasts } from '../features/tab/window/shared.ts';
import { Menus, useMenuTarget } from './commands/menus.tsx';
import { Notices } from './commands/notices.tsx';
import { Overlays } from './commands/overlays.tsx';
import { Slot } from './slots.tsx';

/**
 * Puts the shell back where it was when something has scrolled it. It hides what overflows it, and
 * a hidden box can still be scrolled from a script: by a focus, or a `scrollIntoView`, on something
 * past its edge. The page hears of a scroll before it draws the frame, so the tab strip is never
 * seen off the top.
 */
function unscroll(event: UIEvent<HTMLElement>): void {
  const shell = event.currentTarget;
  if (shell.scrollTop !== 0) shell.scrollTop = 0;
  if (shell.scrollLeft !== 0) shell.scrollLeft = 0;
}

/**
 * Lo's window: the tab strip over the tab on screen, in the middle, with key help, the command
 * palette, features' dialogs and right-click menus over both when they're open, and the toasts at
 * the bottom right: a note that passes, and below it what features keep there until it's acted on.
 * The window is the `window` scope for keys, and `Esc` gives focus back to the middle.
 */
export function Window() {
  // A right-click on nothing in particular lists the window's own actions.
  const menu = useMenuTarget(NO_TARGET);
  return (
    <div
      className="relative flex h-full flex-col overflow-hidden bg-bg-chrome"
      data-lo-scope="window"
      onScroll={unscroll}
      {...menu}
    >
      <TabStrip />
      <main className="relative flex min-h-0 flex-1 flex-col" data-lo-middle tabIndex={-1}>
        <TabPage />
      </main>
      <Overlays />
      <Slot slot={dialogs} props={{}} />
      <Menus />
      <Notices waiting={<Slot slot={toasts} props={{}} />} />
    </div>
  );
}
