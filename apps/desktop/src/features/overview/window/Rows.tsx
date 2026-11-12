// The overview skill's rows: the step on the welcome screen, and the row in Settings' Command line.

import { Button, Setting, SetupItem } from '@lo/ui';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { checkSkill, installSkill, skillStore } from './skill.ts';
import { ABOUT, installedEverywhere, installLabel, standing } from './words.ts';

function SkillIcon() {
  return (
    <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3M6.5 8.5h4M6.5 11h4" />
    </svg>
  );
}

/** Installing the overview skill for each agent that's set up, on the welcome screen. */
export function SkillStep() {
  const { state, installing } = useStore(skillStore);
  useEffect(() => {
    void checkSkill();
  }, []);
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
  const { state, installing, said } = useStore(skillStore);
  useEffect(() => {
    void checkSkill();
  }, []);
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
