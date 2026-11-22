// The overview skill's rows: the step on the welcome screen, and the rows in Settings' Command line,
// for installing it and for the command that installs it from a terminal.

import { Button, Key, keyAria, Setting, SetupItem } from '@lo/ui';
import { Fragment, useEffect } from 'react';
import { useStore } from 'zustand';

import { useKeys } from '../../../window/commands/registry.ts';
import { keyOf } from './labels.ts';
import {
  checkSkill,
  copyInstallCommand,
  INSTALL_COMMAND,
  installSkill,
  skillStore,
} from './skill.ts';
import { ABOUT, installedEverywhere, installLabel, standing } from './words.ts';

function SkillIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3M6.5 8.5h4M6.5 11h4" />
    </svg>
  );
}

/**
 * Where the skill stands, asked for as a row appears and again whenever Lo comes to the front, since
 * its folders change outside Lo: a link taken away, or an agent set up, while Lo was behind.
 */
function useSkill() {
  useEffect(() => {
    void checkSkill();
    const again = () => void checkSkill();
    window.addEventListener('focus', again);
    return () => window.removeEventListener('focus', again);
  }, []);
  return useStore(skillStore);
}

const BOX = 'flex flex-col rounded-sm border border-border bg-bg-raised px-8 py-4';

/**
 * One picture of an overview, small: a sentence about the change, then a figure of the code it
 * goes through, as an agent with the skill writes them. It's drawn, not a real overview, and a
 * screen reader hears what it shows.
 */
function Picture() {
  return (
    <div
      role="img"
      aria-label="An overview: a sentence about the change, over a figure of three modules it goes through"
      className="flex flex-col gap-8 rounded-md bg-bg-well px-12 py-8 select-none"
    >
      <span className="truncate text-fg-muted text-small">
        Input becomes lines, then text. Wrap is passed on, not called.
      </span>
      <div className="flex min-w-0 items-center" aria-hidden="true">
        {(['parse', 'format', 'wrap'] as const).map((name, index) => (
          <Fragment key={name}>
            {index > 0 && <span className="h-0 w-24 flex-none border-t border-border-strong" />}
            <span className={BOX}>
              <span className="text-small">{name}</span>
              <span className="text-fg-muted code-small">src/{name}.ts</span>
            </span>
          </Fragment>
        ))}
      </div>
    </div>
  );
}

/** Installing the overview skill for each agent that's set up, a row of the welcome's set-up step. */
export function SkillStep() {
  const { state, installing } = useSkill();
  return (
    <SetupItem
      icon={<SkillIcon />}
      title="Overview skill"
      description={ABOUT}
      done={installedEverywhere(state) ? 'Installed' : undefined}
      figure={<Picture />}
    >
      <Button size="sm" busy={installing} working="Installing…" onClick={() => void installSkill()}>
        Install
      </Button>
    </SetupItem>
  );
}

/** The skill's row in Settings: where it stands for each agent, and installing it. */
export function SkillRow() {
  const { state, installing, said } = useSkill();
  return (
    <Setting
      label="Overview skill"
      description={<span role="status">{said ?? standing(state)}</span>}
    >
      <Button disabled={installing} onClick={() => void installSkill()}>
        {installLabel(state)}
      </Button>
    </Setting>
  );
}

/**
 * The command that installs the skill from a terminal, by the version of the checker Lo's own skill
 * runs, with a button that copies it, as `yc` does.
 */
export function InstallCommandRow() {
  useKeys();
  const copied = useStore(skillStore, (state) => state.copied);
  useEffect(() => {
    skillStore.setState({ copied: false });
  }, []);
  const keys = keyOf('overview.copyInstallCommand');
  return (
    <Setting
      label="Install from a terminal"
      description={
        <>
          <span className="text-fg code-small select-all">{INSTALL_COMMAND}</span> installs the
          skill Lo does, for each agent set up on the computer you run it on.
        </>
      }
    >
      <Button {...keyAria(keys, undefined)} onClick={() => void copyInstallCommand()}>
        {/* Both labels take the room of the longer, so the button and the row hold still. */}
        <span className="inline-grid justify-items-center">
          <span className="col-start-1 row-start-1">{copied ? 'Copied' : 'Copy'}</span>
          <span className="invisible col-start-1 row-start-1" aria-hidden="true">
            Copied
          </span>
        </span>
        {keys !== undefined && <Key keys={keys} quiet decorative />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? 'Copied the command.' : ''}
      </span>
    </Setting>
  );
}
