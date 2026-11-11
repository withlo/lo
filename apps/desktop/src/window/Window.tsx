import { TabBar } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';

import { Menus, useMenuTarget } from './commands/menus.tsx';
import { Notices } from './commands/notices.tsx';
import { Overlays } from './commands/overlays.tsx';

/**
 * Lo's window: the tab strip, empty until pull requests can be opened, over the middle view, with
 * key help, the command palette and right-click menus over both when they're open. The window is
 * the `window` scope for keys, and `Esc` gives focus back to the middle.
 */
export function Window() {
  // A right-click on nothing in particular lists the window's own actions.
  const menu = useMenuTarget(NO_TARGET);
  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-bg-chrome"
      data-lo-scope="window"
      {...menu}
    >
      <TabBar tabs={[]} />
      <main className="flex-1" data-lo-middle tabIndex={-1} />
      <Overlays />
      <Menus />
      <Notices />
    </div>
  );
}
