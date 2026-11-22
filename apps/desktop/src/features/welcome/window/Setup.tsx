// The welcome's third step: what Lo works with outside its window, one row each, with where each
// stands. Lo's own rows are the `lo` command and sending pull request links to Lo; other features
// add theirs through the `welcome.setup` slot.

import { Button, Problem, SetupItem, SetupList } from '@lo/ui';
import { useEffect, useId, type ReactNode } from 'react';

import { Slot } from '../../../window/slots.tsx';
import {
  findCommand,
  installCommand,
  useCommand,
  useCommandInstall,
  type Installed,
} from '../../open/window/shared.ts';
import { StepHeading } from './Heading.tsx';
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

/** `lo`, as code, as a name that's code is in a label. */
const LO = <span className="code-text">lo</span>;

/** What the row's last install left to say under its line: a folder to add to `PATH`, or why not. */
function Result({ done }: { done: Installed | undefined }): ReactNode {
  if (done?.kind === 'installed') {
    if (done.onPath) return null;
    return (
      <p className="m-0 text-fg-muted text-small">
        Add{' '}
        <span className="break-all text-fg code-small">
          {done.path.slice(0, done.path.lastIndexOf('/'))}
        </span>{' '}
        to your PATH.
      </p>
    );
  }
  const title = <>Couldn’t install the {LO} command</>;
  if (done?.kind === 'taken') {
    return (
      <Problem
        title={title}
        reason={<>Another {LO} file is already there.</>}
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

/** Installing the `lo` command, through the open feature, which says how it went on this row. */
export function CommandStep() {
  const command = useCommand();
  const { installing, done } = useCommandInstall();
  useEffect(() => {
    void findCommand();
  }, []);
  const installed = command?.installed.some((each) => each.current) ?? false;
  // Nothing to say under the row: no install asked for from it, or one that's on PATH.
  const quiet = done === null || (done?.kind === 'installed' && done.onPath);
  return (
    <SetupItem
      icon={<TerminalIcon />}
      title={<>{LO} command</>}
      description={
        <>
          Opens a pull request from a terminal with{' '}
          <span className="text-fg code-small">lo &lt;link&gt;</span>.
        </>
      }
      done={installed ? 'Installed' : undefined}
      below={quiet ? undefined : <Result done={done} />}
    >
      <Button
        size="sm"
        busy={installing}
        working="Installing…"
        onClick={() => void installCommand('row')}
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
      <StepHeading
        id={heading}
        title="Use Lo with your other tools"
        line="Each of these is also in Settings › Integrations."
      />
      <SetupList labelledBy={heading}>
        <Slot slot={setup} props={{}} />
      </SetupList>
    </>
  );
}
