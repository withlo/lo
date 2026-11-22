// The overview's view when there's no overview to show. None yet, or none for a run of a stack's
// layers, is an empty state: what's absent, one line, and what to do about it here. One that can't
// be shown, couldn't be checked or couldn't be fetched is a problem in the view's place: what
// failed, why, the one thing to do, and what was found behind Details.

import { EmptyState, Problem, type EmptyAction, type ProblemAction } from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useEffect } from 'react';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { runLayersOf, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import updates from '../../updates/keys.ts';
import type { Problem as ReadProblem, SkillState } from '../contract.ts';
import { copyPrompt, promptFor } from './copy.ts';
import type { Standing } from './facts.ts';
import { loadNewer } from './follow.ts';
import { useNow } from './hooks.ts';
import { keyOf } from './labels.ts';
import { main } from './main.ts';
import {
  findingPlace,
  invalidSummary,
  newerDetails,
  NEWER_REASON,
  problemReason,
  sizeRows,
  tooLargeWords,
  writtenText,
} from './says.ts';
import { checkSkill, skillStore } from './skill.ts';
import { checkAgain, states } from './store.ts';

/** The command that asks GitHub for a newer Lo now, and says what it found. */
const CHECK = `${updates.feature}.${'check' satisfies keyof typeof updates.commands}`;
/** The commands the states offer, by id. */
const COPY_PROMPT = 'overview.copyPrompt';
const INSTALL_SKILL = 'overview.installSkill';
const RETRY = 'overview.retry';
/** The command that goes from a run of a stack's layers back to the layer it was chosen from. */
const BACK = 'stacks.back';

/** Whether no coding agent that's set up has the overview skill yet: the empty state offers it. */
function skillMissing(state: SkillState | undefined): boolean {
  if (state === undefined) return false;
  const setUp = state.agents.filter((agent) => agent.setUp);
  return setUp.length > 0 && setUp.every((agent) => !agent.installed && agent.blocked === null);
}

/** A prompt to copy into a coding agent, as code the reader can select. */
function PromptText({ prompt }: { prompt: string }) {
  return (
    <div className="lo-prompt w-full max-w-read-measure text-start">
      <pre className="lo-prompt__body lo-selectable">{prompt}</pre>
    </div>
  );
}

/**
 * No overview yet: the prompt a coding agent writes one from, and Copy prompt. A tab that isn't
 * watching for one to arrive offers to look again; else, while no agent has the skill, to install
 * it.
 */
export function NoOverview({ tab, standing }: { tab: PullTab; standing: Standing }) {
  useKeys();
  const state = useTabState(states, tab.id);
  const skill = useStore(skillStore, (store) => store.state);
  useEffect(() => {
    void checkSkill();
  }, []);
  const prompt = promptFor(tab, standing);
  const second: EmptyAction | undefined =
    state?.watching === false
      ? { command: RETRY, label: 'Check again' }
      : skillMissing(skill)
        ? INSTALL_SKILL
        : undefined;
  return (
    <EmptyState
      title="No overview yet"
      line="A coding agent writes one from this prompt."
      actions={second === undefined ? [COPY_PROMPT] : [COPY_PROMPT, second]}
    >
      {prompt !== undefined && <PromptText prompt={prompt} />}
    </EmptyState>
  );
}

/** Opens one of GitHub's pages, as a link out of the overview does. */
function openPage(url: string): void {
  client(tabContract)
    .openExternal({ url })
    .catch((error: unknown) => console.error("Lo couldn't open the page:", error));
}

/** Reads the overview again now, without waiting for the retry's count to run out. */
function tryNow(tab: PullTab): ProblemAction {
  return {
    label: 'Try now',
    onClick: () => {
      main()
        .retry({ id: tab.id })
        .catch((error: unknown) => console.error("Lo couldn't read the overview again:", error));
    },
  };
}

/** What to do about a read that failed: sign in again, GitHub's own page, or try now. */
function readAction(tab: PullTab, problem: ReadProblem): ProblemAction | undefined {
  switch (problem.kind) {
    case 'signedOut':
      return { label: 'Sign in again', onClick: signIn };
    case 'rateLimited':
      // Until the limit resets, there's nothing to try.
      return problem.secondary ? tryNow(tab) : undefined;
    case 'blocked': {
      const [link] = problem.links;
      return link ? { label: link.label, onClick: () => openPage(link.url) } : tryNow(tab);
    }
    case 'offline':
    case 'failed':
      return tryNow(tab);
    default:
      problem satisfies never;
      return tryNow(tab);
  }
}

/** Main couldn't fetch the overview, and has nothing to show: why, and when it's fetched again. */
export function ReadFailed({ tab, problem }: { tab: PullTab; problem: ReadProblem }) {
  const now = useNow(true);
  const details =
    problem.kind === 'blocked' || problem.kind === 'failed' || problem.kind === 'offline'
      ? withoutBidi(problem.message)
      : undefined;
  return (
    <Problem
      layout="view"
      title="Couldn’t fetch the overview"
      reason={problemReason(problem, now)}
      action={readAction(tab, problem)}
      details={details}
    />
  );
}

/** A run of a stack's layers on screen as one diff has no overview: each layer has its own. */
export function NoneInRun({ tab }: { tab: PullTab }) {
  useKeys();
  return (
    <EmptyState
      title={`No overview for ${runLayersOf(tab)}`}
      line="Each layer has its own."
      actions={[{ command: BACK, label: 'Show single layer' }]}
    />
  );
}

/** Copies the prompt that fixes or shrinks an overview, as `ya` does. */
function copyAction(prompt: string | undefined): ProblemAction | undefined {
  if (prompt === undefined) return undefined;
  return {
    label: 'Copy prompt',
    keys: keyOf(COPY_PROMPT),
    onClick: () => void copyPrompt(prompt),
  };
}

/** Shows the latest overview, pushed since this one, which may show where this one can't. */
function latestAction(tab: PullTab): ProblemAction {
  return { label: 'Show latest', onClick: () => loadNewer(tab.id) };
}

/** An overview that can't be shown: why, as its check found, and the one thing to do about it. */
export function CantShow({
  tab,
  standing,
}: {
  tab: PullTab;
  standing: Extract<Standing, { kind: 'unchecked' | 'invalid' | 'tooLarge' | 'newer' }>;
}) {
  useKeys();
  const now = useNow(true, 60_000);
  const state = useTabState(states, tab.id);
  const prompt = promptFor(tab, standing);
  const written = writtenText(standing.commit, now);
  // A later overview is the way on from any of these.
  const latest = state?.newer ? latestAction(tab) : undefined;
  switch (standing.kind) {
    case 'invalid':
      return (
        <Problem
          layout="view"
          title="Can’t show this overview"
          reason={invalidSummary(standing.findings)}
          action={latest ?? copyAction(prompt)}
          details={[
            written,
            ...standing.findings.map(
              (finding) => `${findingPlace(finding)} · ${withoutBidi(finding.message)}`,
            ),
          ].join('\n')}
        />
      );
    case 'tooLarge':
      return (
        <Problem
          layout="view"
          title="Can’t show this overview"
          reason={tooLargeWords(standing.what, standing.sizes)}
          action={latest ?? copyAction(prompt)}
          details={[
            written,
            ...sizeRows(standing.sizes).map((row) => `${row.kind} · ${row.size}`),
          ].join('\n')}
        />
      );
    case 'newer':
      return (
        <Problem
          layout="view"
          title="Can’t show this overview"
          reason={NEWER_REASON}
          action={
            latest ?? {
              label: registry().command(CHECK)?.label ?? 'Check for updates',
              onClick: () => {
                registry().run(CHECK, NO_TARGET);
              },
            }
          }
          details={[written, newerDetails(standing.format)].join('\n')}
        />
      );
    case 'unchecked':
      return (
        <Problem
          layout="view"
          title="Couldn’t check the overview"
          reason={standing.why === '' ? undefined : standing.why}
          action={latest ?? { label: 'Check again', onClick: () => checkAgain(tab.id) }}
          details={written}
        />
      );
    default:
      standing satisfies never;
      return null;
  }
}
