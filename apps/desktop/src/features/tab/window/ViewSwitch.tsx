// The header's view switch: the middle views that have a label, each with its mark, the one on
// screen chosen, and the key that steps through them.

import { SegmentedControl } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { ViewPart, type View } from '../../../window/slots.tsx';
import { showMiddle, type MiddleSwitch, type PullTab } from './shared.ts';

/** A middle view, as the tab lists them. */
type Middle = View<{ tab: PullTab; shown: boolean }> & MiddleSwitch;

/** The first key the command `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

/**
 * The switch between a pull request's middle views, in the header: each that has a label, with its
 * mark, and the one on screen, `shown`, chosen. Nothing while fewer than two have one.
 */
export function ViewSwitch({
  tab,
  views,
  shown,
}: {
  tab: PullTab;
  views: readonly Middle[];
  shown: string | undefined;
}) {
  useKeys();
  const labeled = views.filter((view) => view.label !== undefined);
  if (labeled.length < 2) return null;
  return (
    <SegmentedControl
      label="View"
      kind="views"
      items={labeled.map((view) => {
        const Mark = view.mark;
        return {
          value: view.id,
          label: (
            <>
              {Mark && (
                <ViewPart id={view.id}>
                  <Mark tab={tab} />
                </ViewPart>
              )}
              {view.label}
            </>
          ),
        };
      })}
      value={labeled.some((view) => view.id === shown) ? shown : undefined}
      onChange={(id) => {
        showMiddle(tab.id, id);
      }}
      keys={keyOf('tab.nextView')}
    />
  );
}
