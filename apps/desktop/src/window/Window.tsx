import { CopyRoute, TooltipGroup } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useEffect, type UIEvent } from 'react';

import { contract as tabs } from '../features/tab/contract.ts';
import { TabPage, TabStrip } from '../features/tab/window/Frame.tsx';
import { dialogs, toasts } from '../features/tab/window/shared.ts';
import { Menus, useMenuTarget } from './commands/menus.tsx';
import { Notices } from './commands/notices.tsx';
import { Overlays } from './commands/overlays.tsx';
import { client } from './ipc.ts';
import { Slot } from './slots.tsx';

/** How the window copies: through main, since the window may use no clipboard of its own. */
const copy = (text: string) => client(tabs).copy({ text });

/**
 * Puts the shell, or the page itself, back where it was when something has scrolled it. Each hides
 * what overflows it, and a hidden box can still be scrolled from a script: by a focus, or a
 * `scrollIntoView`, on something past its edge. The page hears of a scroll before it draws the
 * frame, so the tab strip is never seen off the top.
 */
function unscroll(box: Element): void {
  if (box.scrollTop !== 0) box.scrollTop = 0;
  if (box.scrollLeft !== 0) box.scrollLeft = 0;
}

/** Puts the page back when it scrolls: its scroll is the document's, which no `onScroll` hears. */
function useUnscrolledPage(): void {
  useEffect(() => {
    const page = () => {
      if (document.scrollingElement) unscroll(document.scrollingElement);
    };
    document.addEventListener('scroll', page);
    return () => document.removeEventListener('scroll', page);
  }, []);
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
  useUnscrolledPage();
  return (
    <TooltipGroup>
      <CopyRoute copy={copy}>
        <div
          className="relative flex h-full flex-col overflow-hidden bg-bg-chrome"
          data-lo-scope="window"
          onScroll={(event: UIEvent<HTMLElement>) => unscroll(event.currentTarget)}
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
      </CopyRoute>
    </TooltipGroup>
  );
}
