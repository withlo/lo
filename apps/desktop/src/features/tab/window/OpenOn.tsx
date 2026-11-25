// The row of Settings for what a pull request's tab opens on: a choice of the middle views Settings
// can name that are there now, so Overview isn't one while overviews are off, and while it is, a
// line on what Overview opens on for a pull request with none.

import { SegmentedControl } from '@lo/ui';

import { useViews } from '../../../window/slots.tsx';
import type { ControlProps } from '../../settings/window/shared.ts';
import { open, type OpenOn } from '../settings.ts';
import { middle } from './shared.ts';

/** The view Overview names, which comes and goes with overviews. */
const OVERVIEW = 'overview.view';

/** The ids of the middle views there now, following them as they come and go. */
function useMiddleIds(): ReadonlySet<string> {
  return new Set(useViews(middle).map(({ id }) => id));
}

/**
 * The choice of the views there now. A value whose view isn't there shows as the one a tab opens
 * on in its place, the timeline, as the tab does (`middleOf`).
 */
export function OpenOnChoice({ value, change }: ControlProps<OpenOn>) {
  const there = useMiddleIds();
  const items = Object.entries(open.options ?? {})
    .filter(([option]) => there.has(`${option}.view`))
    .map(([option, label]) => ({ value: option, label }));
  const shown = there.has(`${value}.view`) ? value : 'timeline';
  return (
    <SegmentedControl
      label={open.label}
      kind="choice"
      size="sm"
      items={items}
      value={shown}
      onChange={(next) => {
        const parsed = open.schema.safeParse(next);
        if (parsed.success) change(parsed.data);
      }}
    />
  );
}

/** The row's line: while there are overviews, what Overview opens on for a pull request with none. */
export function useOpenOnLine(): string {
  return useMiddleIds().has(OVERVIEW)
    ? 'With Overview, a pull request that has none opens on the timeline.'
    : open.description;
}
