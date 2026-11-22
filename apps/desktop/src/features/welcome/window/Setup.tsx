// The welcome's third step: what Lo works with outside its window, one row each, with where each
// stands. Lo's own rows are the `lo` command and sending pull request links to Lo; other features
// add theirs through the `welcome.setup` slot.

import { Button, SetupItem, SetupList } from '@lo/ui';
import { useEffect, useId, useState, type ReactNode } from 'react';

import { Slot } from '../../../window/slots.tsx';
import { findCommand, installCommand, useCommand } from '../../open/window/shared.ts';
import { setup } from './shared.ts';
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

/** Installing the `lo` command, through the open feature, which says in a notice when it can't. */
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
          <span className="code-text">lo</span> command
        </>
      }
      description={
        <>
          Opens a pull request from a terminal with{' '}
          <span className="text-fg code-small">lo &lt;link&gt;</span>.
        </>
      }
      done={installed ? 'Installed' : undefined}
    >
      <Button
        size="sm"
        busy={installing}
        working="Installing…"
        onClick={() => {
          setInstalling(true);
          void installCommand().finally(() => setInstalling(false));
        }}
      >
        Install
      </Button>
    </SetupItem>
  );
}

/** Sending pull request links from other apps to Lo, which opens the dialog of rules. */
export function LinksStep() {
  return (
    <SetupItem
      icon={<LinkIcon />}
      title="Send pull request links to Lo"
      description="Pull request links clicked in other apps open in Lo."
    >
      <Button size="sm" onClick={() => welcomeStore.setState({ rules: true })}>
        Show rules
      </Button>
    </SetupItem>
  );
}

export function SetupStep(): ReactNode {
  const heading = useId();
  return (
    <>
      <div className="flex flex-col gap-6">
        <h1 id={heading} className="m-0 text-heading">
          Use Lo with your other tools
        </h1>
        <p className="m-0 text-fg-muted text-ui">
          Each of these is also in Settings › Integrations.
        </p>
      </div>
      <SetupList labelledBy={heading}>
        <Slot slot={setup} props={{}} />
      </SetupList>
    </>
  );
}
