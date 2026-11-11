import { TabBar } from '@lo/ui';

/**
 * Lo's window: the tab strip, empty until pull requests can be opened, over the middle view. The
 * window is the `window` scope for keys, and `Esc` gives focus back to the middle.
 */
export function Window() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-chrome" data-lo-scope="window">
      <TabBar tabs={[]} />
      <main className="flex-1" data-lo-middle tabIndex={-1} />
    </div>
  );
}
