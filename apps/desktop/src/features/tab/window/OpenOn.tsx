// The row of Settings for what a pull request's tab opens on: a choice of the middle views Settings
// can name that are there now, so Overview isn't one while overviews are off, and a line on where
// a tab opens when Overview can't be: for a pull request with none, or while overviews are off.

import { SegmentedControl } from '@lo/ui';

import { useViews } from '../../../window/slots.tsx';
import { useKnownSetting, type ControlProps } from '../../settings/window/shared.ts';
import { open, type OpenOn } from '../settings.ts';
import { middle } from './shared.ts';

/** The view Overview names, which comes and goes with overviews. */
const OVERVIEW = 'overview.view';

/** The ids of the middle views there now, following them as they come and go. */
function useMiddleIds(): ReadonlySet<string> {
  return new Set(useViews(middle).map(({ id }) => id));
}

/**
 * The choice of the views there now. A value whose view isn't there, Overview while overviews are
 * off, chooses none of them, so any can be chosen; the row's line says where a tab opens meanwhile.
 */
export function OpenOnChoice({ value, change }: ControlProps<OpenOn>) {
  const there = useMiddleIds();
  const items = Object.entries(open.options ?? {})
    .filter(([option]) => there.has(`${option}.view`))
    .map(([option, label]) => ({ value: option, label }));
  return (
    <SegmentedControl
      label={open.label}
      kind="choice"
      size="sm"
      items={items}
      value={value}
      onChange={(next) => {
        const parsed = open.schema.safeParse(next);
        if (parsed.success) change(parsed.data);
      }}
    />
  );
}

/**
 * The row's line: while there are overviews, what Overview opens on for a pull request with none;
 * while there are none and Overview is chosen, that a tab opens on the timeline.
 */
export function useOpenOnLine(): string {
  const there = useMiddleIds().has(OVERVIEW);
  const value = useKnownSetting(open);
  if (there) return 'With Overview, a pull request that has none opens on the timeline.';
  if (value === 'overview') return 'Overviews are off, so pull requests open on the timeline.';
  return open.description;
}
