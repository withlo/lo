import { TabBar } from '@lo/ui';

/** Lo's window: the tab strip, empty until pull requests can be opened, over the body. */
export function Window() {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-bg-chrome">
      <TabBar tabs={[]} />
      <main className="flex-1" />
    </div>
  );
}
