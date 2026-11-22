// Settings' row for the `lo` command, in Integrations: what it does, where it's installed, if it
// is, installing it, and how the last install went.

import { Button, Setting } from '@lo/ui';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { defineRow } from '../../settings/window/shared.ts';
import { checkCommand, commandStore, installCommand } from './command.ts';
import { InstallResult } from './InstallResult.tsx';

/** A path, or a folder's, as code. */
function Code({ text }: { text: string }) {
  return <span className="break-all code-small">{text}</span>;
}

function CommandRow() {
  const { state, installing, done } = useStore(commandStore);
  useEffect(() => {
    void checkCommand();
  }, []);
  const [first] = state?.installed ?? [];
  const current = state?.installed.some((each) => each.current) ?? false;
  // Where it's installed goes under the row's line, as a path does, with how the last install went.
  const where = first !== undefined && (
    <p role="status" className="text-fg-muted text-small">
      Installed at <Code text={first.path} />.{current ? '' : ' It opens another copy of Lo.'}
    </p>
  );
  return (
    <Setting
      label={
        <>
          <span className="code-text">lo</span> command
        </>
      }
      description={
        <>
          Opens a pull request from a terminal with{' '}
          <span className="code-small">lo &lt;link&gt;</span>.
        </>
      }
      below={
        where || done !== null ? (
          <div className="flex flex-col gap-4">
            {where}
            {done !== null && <InstallResult done={done} />}
          </div>
        ) : undefined
      }
    >
      {/* Not the command's button: an install from here says how it went here, not in a note. */}
      <Button busy={installing} working="Installing…" onClick={() => void installCommand('row')}>
        {first === undefined ? 'Install' : 'Install again'}
      </Button>
    </Setting>
  );
}

export default defineRow({
  id: 'open.command',
  group: 'integrations',
  order: 10,
  label: 'lo command',
  description: 'Opens a pull request from a terminal with lo <link>.',
  words: () => ['terminal', 'command line', 'install', 'PATH'],
  render: CommandRow,
});
