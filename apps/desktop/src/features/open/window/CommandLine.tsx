// Settings' Command line section: the `lo` command, where it is, and installing it.

import { Button, Setting } from '@lo/ui';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { defineSection } from '../../settings/window/shared.ts';
import { checkCommand, commandStore, installCommand } from './command.ts';

/** The `lo` command's row: where it's installed, if it is, and a button to install it. */
function CommandRow() {
  const { state, installing, said } = useStore(commandStore);
  useEffect(() => {
    void checkCommand();
  }, []);
  const [first] = state?.installed ?? [];
  const current = state?.installed.some((each) => each.current) ?? false;
  const where =
    first === undefined
      ? 'Open a pull request from a terminal with lo <link>.'
      : current
        ? `Installed at ${first.path}. Open a pull request from a terminal with lo <link>.`
        : `Installed at ${first.path} by another copy of Lo. Install it again to open this one.`;
  return (
    <Setting
      label={
        <>
          The <span className="code-text">lo</span> command
        </>
      }
      description={<span role="status">{said ?? where}</span>}
    >
      <Button disabled={installing} onClick={() => void installCommand()}>
        {first === undefined ? 'Install' : 'Install again'}
      </Button>
    </Setting>
  );
}

export default defineSection({
  id: 'open.command',
  order: 70,
  title: 'Command line',
  description: 'Opening pull requests from a terminal.',
  render: () => <CommandRow />,
});
