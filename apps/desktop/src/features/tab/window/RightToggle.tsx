// The header's toggle for the right panel, the threads: pressed while it's open, with what the
// panel's views count for the tab, such as its unresolved threads, and the key that does the same.

import { Button } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { ViewPart, type View } from '../../../window/slots.tsx';
import { toggleRight, useRightOpen } from './panels.ts';
import type { PullTab, RightToggle as Toggle } from './shared.ts';

/** A view of the right panel, as the tab lists them. */
type Right = View<{ tab: PullTab }> & Toggle;

/** The first key the command `id` has now, as this system shows it, as one string. */
function keyOf(id: string): string | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system).join(' ');
}

/** Opens and closes the right panel, as `⌘⇧\` does, showing what its views count for `tab`. */
export function RightToggle({ tab, views }: { tab: PullTab; views: readonly Right[] }) {
  useKeys();
  const open = useRightOpen();
  const key = keyOf('tab.rightPanel');
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-pressed={open}
      title={key === undefined ? 'Threads panel' : `Threads panel (${key})`}
      onClick={toggleRight}
      data-lo-right-toggle
    >
      <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
        <rect x="2" y="2.75" width="12" height="10.5" rx="2" />
        <path d="M10 2.75v10.5" />
      </svg>
      <span className="sr-only">Threads panel</span>
      {views.map((view) => {
        const Count = view.count;
        return (
          Count && (
            <ViewPart key={view.id} id={view.id}>
              <Count tab={tab} />
            </ViewPart>
          )
        );
      })}
    </Button>
  );
}
