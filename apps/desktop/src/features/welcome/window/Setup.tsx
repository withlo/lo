// The welcome's fifth step: what Lo works with outside its window, one row each, with where each
// stands. Lo's own rows are the `lo` command and sending pull request links to Lo; other features
// add theirs through the `welcome.setup` slot.

import { Button, Setting, SettingsCommand, SetupItem, SetupList } from '@lo/ui';
import { useEffect, useId, type ReactNode } from 'react';

import { Slot } from '../../../window/slots.tsx';
import { defineRow } from '../../settings/window/shared.ts';
import {
  findCommand,
  installCommand,
  InstallResult,
  useCommand,
  useCommandInstall,
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
      below={quiet ? undefined : <InstallResult done={done} />}
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

/** Opens the dialog of rules for the apps that open links, from the welcome or Settings. */
const showRules = () => welcomeStore.setState({ rules: true });

/** Sending pull request links from other apps to Lo, which opens the dialog of rules. */
export function LinksStep() {
  return (
    <SetupItem
      icon={<LinkIcon />}
      title="Send pull request links to Lo"
      description="Pull request links clicked in other apps open in Lo."
    >
      <Button size="sm" onClick={showRules}>
        Show rules
      </Button>
    </SetupItem>
  );
}

/** A row of Settings: its label and line, as `defineRow` gives them. */
interface RowProps {
  label: string;
  description: string;
}

function Links({ label, description }: RowProps) {
  return (
    <Setting label={label} description={description}>
      <Button onClick={showRules}>Show rules</Button>
    </Setting>
  );
}

function Welcome({ label, description }: RowProps) {
  return (
    <Setting label={label} description={description}>
      <SettingsCommand command="welcome.show">Show</SettingsCommand>
    </Setting>
  );
}

/** Settings' row for sending pull request links to Lo, in Integrations, as the welcome has it. */
export const LinksRow = defineRow({
  id: 'welcome.linksRow',
  group: 'integrations',
  // After the `lo` command (10), as on the welcome.
  order: 15,
  label: 'Link routers',
  description: 'Opens pull request links clicked in other apps.',
  words: () => ['send pull request links to Lo', 'Finicky', 'Velja', 'Choosy', 'browser', 'rules'],
  render: Links,
});

/** Settings' row in About that opens the welcome again. */
export const WelcomeRow = defineRow({
  id: 'welcome.row',
  group: 'about',
  // After the version (10) and automatic checks (20), before the licenses (40).
  order: 30,
  label: 'Welcome to Lo',
  description: 'Opens the welcome again, at its first step.',
  words: () => ['welcome', 'set up', 'tour', 'start'],
  render: Welcome,
});

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
