// The overview skill's rows: the step on the welcome screen, and the rows in Settings ›
// Integrations, for installing it and for the command that installs it from a terminal.

import { Button, CopyFaces, CopyStatus, Key, keyAria, Problem, Setting, SetupItem } from '@lo/ui';
import { Fragment, useEffect } from 'react';
import { useStore } from 'zustand';

import { useKeys } from '../../../window/commands/registry.ts';
import { defineRow } from '../../settings/window/shared.ts';
import { keyOf } from './labels.ts';
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
      figure={<Picture />}
      below={
        failed !== undefined ? (
          <InstallFailed details={failed} />
        ) : stopped.length > 0 ? (
          <p className="text-fg-muted text-small">{stopped.join(' ')}</p>
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
                        <span className="block">{each.why}</span>
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
});
