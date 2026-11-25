// The overview's rows outside Settings › Pull requests: whether there are overviews, on the
// welcome's step that says what one is; and the overview skill's, its step on the welcome's set-up
// step and its rows in Settings › Integrations, for installing it and for the command that installs
// it from a terminal.

import {
  Button,
  CopyFaces,
  CopyStatus,
  Key,
  keyAria,
  Problem,
  Setting,
  SetupItem,
  Switch,
  Ticks,
} from '@lo/ui';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { useKeys } from '../../../window/commands/registry.ts';
import { defineRow, useSettingChange } from '../../settings/window/shared.ts';
import { on } from '../settings.ts';
import { keyOf } from './labels.ts';
import { overviews } from './shared.ts';
import {
  checkSkill,
  copyInstallCommand,
  drawCopyButton,
  FAILED,
  INSTALL_COMMAND,
  installSkill,
  skillStore,
} from './skill.ts';
import { ABOUT, installedEverywhere, installLabel, notSetUp, standing } from './words.ts';

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

/**
 * Whether there are overviews, a row of the welcome's step that says what one is: the switch its
 * row in Settings has, with a line on what turning it off takes away.
 */
export function OverviewsRow() {
  const { value, change, problem } = useSettingChange(on);
  return (
    <SetupItem
      title={on.label}
      description="Turn off to take overviews, their prompts and the overview skill out of Lo."
      below={problem}
    >
      <Switch checked={value} aria-label={on.label} onCheckedChange={(next) => void change(next)} />
    </SetupItem>
  );
}

/** Installs the skill from a row, which says how it went, and nothing else does. */
const install = () => void installSkill(undefined, 'row');

/** An install main couldn't be asked for, on the row that asked, with a way to try again. */
function InstallFailed({ details }: { details: string }) {
  return (
    <Problem title={FAILED} action={{ label: 'Try again', onClick: install }} details={details} />
  );
}

/** Installing the overview skill for each agent that's set up, a row of the welcome's set-up step. */
export function SkillStep() {
  const { state, installing, failed } = useSkill();
  // What stops an install for an agent, which the step says under it, as Settings' row does.
  const stopped = state === undefined ? [] : standing(state).flatMap((each) => each.why ?? []);
  return (
    <SetupItem
      icon={<SkillIcon />}
      title="Overview skill"
      description={ABOUT}
      done={installedEverywhere(state) ? 'Installed' : undefined}
      below={
        failed !== undefined ? (
          <InstallFailed details={failed} />
        ) : stopped.length > 0 ? (
          <p className="text-fg-muted text-small">
            <Ticks text={stopped.join(' ')} />
          </p>
        ) : undefined
      }
    >
      <Button
        size="sm"
        busy={installing}
        working="Installing…"
        disabled={notSetUp(state) !== undefined}
        hint={notSetUp(state)}
        onClick={install}
      >
        Install
      </Button>
    </SetupItem>
  );
}

/** The skill's row in Settings: what it's for, where it stands for each agent, and installing it. */
function Skill({ label, description }: { label: string; description: string }) {
  const { state, installing, failed } = useSkill();
  return (
    <Setting
      label={label}
      description={description}
      below={
        failed !== undefined ? (
          <InstallFailed details={failed} />
        ) : (
          <div role="status" className="text-fg-muted text-small">
            {state !== undefined && (
              <ul>
                {standing(state).map((each) => (
                  <li key={each.line}>
                    {each.line}
                    {each.folder !== undefined && (
                      <>
                        {' '}
                        <span className="code-small">{each.folder}</span>
                      </>
                    )}
                    {each.why !== undefined && (
                      <>
                        {' '}
                        <span className="block">
                          <Ticks text={each.why} />
                        </span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      }
    >
      <Button
        busy={installing}
        working="Installing…"
        disabled={notSetUp(state) !== undefined}
        hint={notSetUp(state)}
        onClick={install}
      >
        {installLabel(state)}
      </Button>
    </Setting>
  );
}

export const SkillRow = defineRow({
  id: 'overview.skillRow',
  group: 'integrations',
  order: 20,
  label: 'Overview skill',
  description: 'Teaches Claude Code and Codex to write overviews.',
  words: () => ['agent', 'install', 'Claude Code', 'Codex'],
  render: Skill,
  present: overviews,
});

/**
 * The command that installs the skill from a terminal, by the version of the checker Lo's own skill
 * runs, with a button that copies it, as `yc` does.
 */
function InstallCommand({ label, description }: { label: string; description: string }) {
  useKeys();
  const copied = useStore(skillStore, (state) => state.copied);
  useEffect(() => {
    skillStore.setState({ copied: undefined });
    return drawCopyButton();
  }, []);
  const keys = keyOf('overview.copyInstallCommand');
  return (
    <Setting
      label={label}
      description={description}
      below={<span className="break-all text-fg code-small select-all">{INSTALL_COMMAND}</span>}
    >
      <Button {...keyAria(keys, undefined)} onClick={() => void copyInstallCommand()}>
        {/* Each face takes the room of the widest, so the button and the row hold still. */}
        <CopyFaces said={copied}>Copy</CopyFaces>
        {keys !== undefined && <Key keys={keys} quiet decorative />}
      </Button>
      <CopyStatus said={copied} />
    </Setting>
  );
}

export const InstallCommandRow = defineRow({
  id: 'overview.installCommand',
  group: 'integrations',
  order: 30,
  label: 'On another computer',
  // The command itself is under the row's line.
  description: 'The overview skill installs from a terminal.',
  words: () => ['overview skill', 'terminal', 'install', 'copy', INSTALL_COMMAND],
  render: InstallCommand,
  present: overviews,
});
