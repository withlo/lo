import { NO_TARGET } from '@lo/ui/commands';

import { TabPage, TabStrip } from '../features/tab/window/Frame.tsx';
import { dialogs, toasts } from '../features/tab/window/shared.ts';
import { Menus, useMenuTarget } from './commands/menus.tsx';
import { Notices } from './commands/notices.tsx';
import { Overlays } from './commands/overlays.tsx';
import { Slot } from './slots.tsx';

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
      className="relative flex h-full flex-col overflow-clip bg-bg-chrome"
      data-lo-scope="window"
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
