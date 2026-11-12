// The diff's row in Settings' Pull requests: its layout, side by side or inline, which `gi` changes
// from any diff too.

import { Key, SegmentedControl, Setting } from '@lo/ui';
import { keyLabels } from '@lo/ui/commands';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { changeSetting, useSetting } from '../../settings/window/shared.ts';
import { layout } from '../settings.ts';

/** The first key the command `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

export function LayoutRow() {
  useKeys();
  const chosen = useSetting(layout);
  const keys = keyOf('diff.inline');
  return (
    <Setting
      label="Diff layout"
      description={
        keys === undefined ? undefined : (
          <>
            Also <Key keys={keys} quiet decorative /> in any diff.
          </>
        )
      }
    >
      <SegmentedControl
        label="Diff layout"
        kind="choice"
        size="sm"
        items={[
          { value: 'split', label: 'Side by side' },
          { value: 'inline', label: 'Inline' },
        ]}
        value={chosen}
        onChange={(next) => {
          void changeSetting(layout, next);
        }}
      />
    </Setting>
  );
}
