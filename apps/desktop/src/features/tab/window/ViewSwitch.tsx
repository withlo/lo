// The header's view switch: the middle views that have a label, each with its mark, the one on
// screen chosen, and the key that steps through them. With the code beside, its thumb covers both
// views on screen, and a click on either gives that view focus.

import { SegmentedControl } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { ViewPart, type View } from '../../../window/slots.tsx';
import { focusView } from './panels.ts';
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
 * mark, and the one on screen, `shown`, chosen, the views `onScreen` beside it covered with it. A
 * click on a view on screen gives it focus; on another, it comes into sight in its place. Nothing
 * while fewer than two have one.
 */
export function ViewSwitch({
  tab,
  views,
  shown,
  onScreen,
}: {
  tab: PullTab;
  views: readonly Middle[];
  shown: string | undefined;
  onScreen: readonly string[];
}) {
  useKeys();
  const labeled = views.filter((view) => view.label !== undefined);
  if (labeled.length < 2) return null;
  const inSwitch = (id: string | undefined) => labeled.some((view) => view.id === id);
  // A file whole beside a reading view isn't in the switch: the reading view is what it shows.
  const listed = onScreen.filter(inSwitch);
  const chosen = inSwitch(shown) ? shown : listed[0];
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
      value={chosen}
      current={listed.length > 1 ? listed : undefined}
      onChange={(id) => {
        if (!onScreen.includes(id) || !focusView(id)) showMiddle(tab.id, id);
      }}
      keys={keyOf('tab.nextView')}
    />
  );
}
