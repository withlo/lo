import { Button, Key, Setting } from '@lo/ui';
import { keyLabels, NO_TARGET } from '@lo/ui/commands';
import { useSyncExternalStore } from 'react';

import { keymapState, subscribeKeymap } from '../../../window/commands/keymap.ts';
import { registry, useKeys } from '../../../window/commands/registry.ts';
import { defineSection, useSettingsFile } from './shared.ts';

/** The first key `id` has now, as this system shows it, if it has one. */
function keyOf(id: string): string[] | undefined {
  const [first] = registry().keysOf(id);
  return first && keyLabels(first, registry().system);
}

function Keys() {
  // The keys follow the keymap file, and so does what's wrong with it.
  useKeys();
  const keymap = useSyncExternalStore(subscribeKeymap, keymapState);
  const file = useSettingsFile();
  // The keymap file sits beside the settings file.
  const path = file === undefined ? undefined : `${file.slice(0, file.lastIndexOf('/') + 1)}keymap`;
  const help = keyOf('keys.help');
  return (
    <Setting
      label="Keymap file"
      description={
        <>
          {path !== undefined && <span className="break-all code-small">{path}</span>}
          {keymap.problem !== undefined && (
            <span className="block text-danger">{keymap.problem}</span>
          )}
        </>
      }
    >
      {keymap.canOpen && (
        <Button onClick={() => registry().run('keys.openKeymap', NO_TARGET)}>Open</Button>
      )}
      <Button variant="ghost" onClick={() => registry().run('keys.help', NO_TARGET)}>
        Every key
        {help !== undefined && <Key keys={help} quiet decorative />}
      </Button>
    </Setting>
  );
}

export default defineSection({
  id: 'settings.keys',
  title: 'Keys',
  order: 60,
  render: Keys,
});
