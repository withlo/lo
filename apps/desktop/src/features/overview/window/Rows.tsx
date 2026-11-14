// The overview skill's rows: the step on the welcome screen, and the rows in Settings' Command line,
// for installing it and for the command that installs it from a terminal.

import { Button, Key, keyAria, Setting, SetupItem } from '@lo/ui';
import { useEffect } from 'react';
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

/** Installing the overview skill for each agent that's set up, on the welcome screen. */
export function SkillStep() {
  const { state, installing } = useSkill();
  const installed = installedEverywhere(state);
  return (
    <SetupItem icon={<SkillIcon />} title="Install the overview skill" description={ABOUT}>
      <Button size="sm" disabled={installing || installed} onClick={() => void installSkill()}>
        {installed ? 'Installed' : 'Install'}
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
          <span className="text-fg select-all code-small">{INSTALL_COMMAND}</span> installs the
          skill Lo does, for each agent set up where it runs.
        </>
      }
    >
      <Button {...keyAria(keys, undefined)} onClick={() => void copyInstallCommand()}>
        {copied ? 'Copied' : 'Copy'}
        {keys !== undefined && <Key keys={keys} quiet decorative />}
      </Button>
      <span role="status" className="sr-only">
        {copied ? 'Copied the command.' : ''}
      </span>
    </Setting>
  );
}
