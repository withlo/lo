// Settings' row for the `lo` command, in Integrations: what it does, where it's installed, if it
// is, installing it, and how the last install went.

import { Button, Problem, Setting } from '@lo/ui';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { defineRow } from '../../settings/window/shared.ts';
import type { Installed } from '../contract.ts';
import { checkCommand, commandStore, installCommand } from './command.ts';

/** A path, or a folder's, as code. */
function Code({ text }: { text: string }) {
  return <span className="break-all code-small">{text}</span>;
}

/** What the last install left to say on the row: a folder to add to `PATH`, or why it failed. */
function Result({ done }: { done: Installed | undefined }) {
  if (done?.kind === 'installed') {
    if (done.onPath) return null;
    return (
      <p className="text-fg-muted text-small">
        Add <Code text={done.path.slice(0, done.path.lastIndexOf('/'))} /> to{' '}
        <span className="code-small">PATH</span>.
      </p>
    );
  }
  const title = (
    <>
      Couldn’t install the <span className="code-small">lo</span> command
    </>
  );
  if (done?.kind === 'taken') {
    return (
      <Problem
        title={title}
        reason={
          <>
            Another <span className="code-small">lo</span> file is already there.
          </>
        }
        details={done.path}
      />
    );
  }
  return (
    <Problem
      title={title}
      details={done?.message}
      action={{ label: 'Try again', onClick: () => void installCommand('row') }}
    />
  );
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
            {done !== null && <Result done={done} />}
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
