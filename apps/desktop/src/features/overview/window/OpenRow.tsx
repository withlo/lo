// The overview's row in Settings' Pull requests: what a pull request opens on when it has an
// overview.

import { SegmentedControl, Setting } from '@lo/ui';

import { changeSetting, useSetting } from '../../settings/window/shared.ts';
import { open } from '../settings.ts';

export function OpenRow() {
  const chosen = useSetting(open);
  return (
    <Setting
      label="Open on"
      description="When a PR has an overview. Without one, it always opens on the diff."
    >
      <SegmentedControl
        label="Open on"
        kind="choice"
        size="sm"
        items={[
          { value: 'overview', label: 'Overview' },
          { value: 'diff', label: 'Diff' },
        ]}
        value={chosen}
        onChange={(next) => {
          void changeSetting(open, next);
        }}
      />
    </Setting>
  );
}
