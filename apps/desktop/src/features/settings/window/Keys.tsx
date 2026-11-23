// Settings' Keyboard rows that are this feature's: the keymap file, where it is and what's wrong
// with it, and the list of every key. Vim keys' row is the comments feature's.

import { Setting, SettingsCommand } from '@lo/ui';
import { Fragment, useSyncExternalStore } from 'react';

import { keymapState, subscribeKeymap } from '../../../window/commands/keymap.ts';
import { useKeys } from '../../../window/commands/registry.ts';
import { defineRow, useSettingsFile } from './shared.ts';

/** The keymap file's row: what it holds, where it is, beside the settings file, and what's wrong. */
function KeymapFile({ label, description }: { label: string; description: string }) {
  // The keys follow the keymap file, and so does what's wrong with it.
  useKeys();
  const keymap = useSyncExternalStore(subscribeKeymap, keymapState);
  const file = useSettingsFile();
  const path = file === undefined ? undefined : `${file.slice(0, file.lastIndexOf('/') + 1)}keymap`;
  return (
    <Setting
      label={label}
      description={description}
      note={
        keymap.problem && (
          <>
            {keymap.problem.title}
            {keymap.problem.reason !== undefined && (
              <span className="block">{keymap.problem.reason}</span>
            )}
          </>
        )
      }
      below={
        path === undefined ? undefined : (
          // It wraps after a slash, and mid-name only where a name is longer than the line.
          <span className="break-words text-fg-muted code-small">
            {path.split('/').map((part, index) => (
              <Fragment key={index}>
                {index > 0 && (
                  <>
                    /<wbr />
                  </>
                )}
                {part}
              </Fragment>
            ))}
          </span>
        )
      }
    >
      <SettingsCommand command="keys.openKeymap">Open</SettingsCommand>
    </Setting>
  );
}

/** The row that shows every key, by area. */
function Shortcuts({ label, description }: { label: string; description: string }) {
  return (
    <Setting label={label} description={description}>
      <SettingsCommand command="keys.help">Show</SettingsCommand>
    </Setting>
  );
}

export default [
  defineRow({
    id: 'settings.keymap',
    group: 'keyboard',
    order: 20,
    label: 'Keymap file',
    description: 'Holds changed keys.',
    words: () => ['keymap', 'remap', 'keys'],
    render: KeymapFile,
  }),
  defineRow({
    id: 'settings.shortcuts',
    group: 'keyboard',
    order: 30,
    label: 'Keyboard shortcuts',
    description: 'Every key, by the area it works in.',
    words: () => ['keys', 'help'],
    render: Shortcuts,
  }),
];
