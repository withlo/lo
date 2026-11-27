// What a pull request's tab opens on, and the row of Settings for it: a choice of the middle views
// Settings can name that are there now, so Overview isn't one while overviews are off, and a line
// on where a tab opens when Overview can't be: for a pull request with none, or while overviews are
// off. The welcome's step that says what an overview is has the same row. Both show what tabs open
// on, which a value saved under the key `tab.open` replaced decides until main has carried it.

import { SegmentedControl, SetupItem } from '@lo/ui';

import { useViews } from '../../../window/slots.tsx';
import {
  useInFile,
  useKnownSetting,
  useSettingChange,
  type ControlProps,
} from '../../settings/window/shared.ts';
import { before, open, type OpenOn } from '../settings.ts';
import { middle } from './shared.ts';

/** The view Overview names, which comes and goes with overviews. */
const OVERVIEW = 'overview.view';

/**
 * What a pull request's tab opens on, once main has said what the settings file holds, and
 * `undefined` until then: `tab.open`, or, while the file has no `tab.open`, a `diff` saved under
 * the key it replaced, as main carries it over (`main/carry.ts`). So it's the same before main has
 * carried it as after, and while it can't, as when the file can't be written.
 */
export function useOpensOn(): OpenOn | undefined {
  const saved = useKnownSetting(open);
  const inFile = useInFile(open);
  const earlier = useKnownSetting(before);
  if (saved === undefined) return undefined;
  return inFile === false && earlier === 'diff' ? 'diff' : saved;
}

/** The ids of the middle views there now, following them as they come and go. */
function useMiddleIds(): ReadonlySet<string> {
  return new Set(useViews(middle).map(({ id }) => id));
}

/**
 * The choice of the views there now, with the one tabs open on chosen ({@link useOpensOn}). A value
 * whose view isn't there, Overview while overviews are off, chooses none of them, so any can be
 * chosen; the row's line says where a tab opens meanwhile.
 */
export function OpenOnChoice({ value, change }: Pick<ControlProps<OpenOn>, 'value' | 'change'>) {
  const there = useMiddleIds();
  const shown = useOpensOn() ?? value;
  const items = Object.entries(open.options ?? {})
    .filter(([option]) => there.has(`${option}.view`))
    .map(([option, label]) => ({ value: option, label }));
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

/**
 * The row's line: while there are overviews, what Overview opens on for a pull request with none;
 * while there are none and Overview is chosen, that a tab opens on the timeline.
 */
export function useOpenOnLine(): string {
  const there = useMiddleIds().has(OVERVIEW);
  const value = useOpensOn();
  if (there) return 'With Overview, a pull request that has none opens on the timeline.';
  if (value === 'overview') return 'Overviews are off, so pull requests open on the timeline.';
  return open.description;
}

/**
 * The row on the welcome's step that says what an overview is: the label, the line and the choice
 * the row in Settings has, written as it's changed, with the `Problem` that row shows for a change
 * the file refused under it.
 */
export function OpenOnRow() {
  const { value, change, problem } = useSettingChange(open);
  return (
    <SetupItem title={open.label} description={useOpenOnLine()} below={problem}>
      <OpenOnChoice value={value} change={(next) => void change(next)} />
    </SetupItem>
  );
}
