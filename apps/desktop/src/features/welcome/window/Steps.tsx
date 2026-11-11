// The optional steps Lo puts in the welcome screen's `welcome.setup` slot: installing the `lo`
// command, and sending pull request links to Lo.

import { Button, SetupItem } from '@lo/ui';
import { useEffect, useState } from 'react';

import { findCommand, installCommand, useCommand } from '../../open/window/shared.ts';
import { welcomeStore } from './store.ts';

function TerminalIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5 6 8l-3 3.5M8 12h5" />
    </svg>
  );
}

function LinkIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M6.5 9.5l3-3M7 4.5l1-1a2.47 2.47 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1A2.47 2.47 0 0 1 4.5 9l1-1" />
    </svg>
  );
}

/** Installing the `lo` command, through the open feature, which says how it went in a notice. */
export function CommandStep() {
  const command = useCommand();
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    void findCommand();
  }, []);
  const installed = command?.installed.some((each) => each.current) ?? false;
  return (
    <SetupItem
      icon={<TerminalIcon />}
      title={
        <>
          Install the <span className="code-text">lo</span> command
        </>
      }
      description={
        <>
          Open a PR from a terminal with <span className="text-fg code-small">lo &lt;link&gt;</span>
          .
        </>
      }
    >
      <Button
        size="sm"
        disabled={installing || installed}
        onClick={() => {
          setInstalling(true);
          void installCommand().finally(() => setInstalling(false));
        }}
      >
        {installed ? 'Installed' : 'Install'}
      </Button>
    </SetupItem>
  );
}

/** Sending pull request links from other apps to Lo, which opens the dialog of rules. */
export function LinksStep() {
  return (
    <SetupItem
      icon={<LinkIcon />}
      title="Send PR links to Lo"
      description="Lets a link router such as Finicky hand GitHub PR links to Lo. Your browser stays the default."
    >
      <Button size="sm" onClick={() => welcomeStore.setState({ rules: true })}>
        Set up
      </Button>
    </SetupItem>
  );
}
