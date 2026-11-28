// The overview's view when there's no overview to show. None yet, or none for a run of a stack's
// layers, is an empty state: what's absent, one line, and what to do about it here. One that can't
// be shown, couldn't be checked or couldn't be fetched is a problem in the view's place: what
// failed, why, the one thing to do, and what was found behind Details.

import {
  CopyFaces,
  CopyStatus,
  Countdown,
  EmptyState,
  Key,
  Problem,
  useCopySaid,
  type CopySaid,
  type EmptyAction,
  type ProblemAction,
} from '@lo/ui';
import { NO_TARGET } from '@lo/ui/commands';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';

import { registry, useKeys } from '../../../window/commands/registry.ts';
import { client } from '../../../window/ipc.ts';
import { signIn } from '../../accounts/window/shared.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { useRunLayers, useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import updates from '../../updates/keys.ts';
import type { Problem as ReadProblem, SkillState } from '../contract.ts';
import { answerCopies, copyPrompt, promptFor } from './copy.ts';
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
import { checkAgain, rereading, states } from './store.ts';

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

/**
 * What tab `id`'s Copy prompt button says of the last copy of its prompt, by the button or by `ya`,
 * while it's `seen`: drawn, in the view on screen. A copy made while none is seen, as from another
 * view, which keeps this one drawn but hidden, says so in a toast.
 */
function usePromptCopied(id: string, seen: boolean): CopySaid | undefined {
  const [said, say] = useCopySaid();
  useEffect(() => (seen ? answerCopies(id, say) : undefined), [seen, id, say]);
  return said;
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
export function NoOverview({
  tab,
  standing,
  onScreen,
}: {
  tab: PullTab;
  standing: Standing;
  /** Whether the view is on screen, so its Copy prompt answers a copy. */
  onScreen: boolean;
}) {
  useKeys();
  const state = useTabState(states, tab.id);
  const looking = useTabState(rereading, tab.id);
  const skill = useStore(skillStore, (store) => store.state);
  const copied = usePromptCopied(tab.id, onScreen);
  useEffect(() => {
    void checkSkill();
  }, []);
  const prompt = promptFor(tab, standing);
  const copy: EmptyAction = { command: COPY_PROMPT, copied: copied ?? null };
  const second: EmptyAction | undefined =
    state?.watching === false
      ? { command: RETRY, label: 'Check again', busy: looking, working: 'Checking…' }
      : skillMissing(skill)
        ? INSTALL_SKILL
        : undefined;
  return (
    <EmptyState
      icon="file-text"
      title="No overview yet"
      line="A coding agent writes one from this prompt."
      actions={second === undefined ? [copy] : [copy, second]}
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

/** What to do about a read that failed: sign in again, GitHub's own page, or `again`, Try now. */
function readAction(problem: ReadProblem, again: ProblemAction): ProblemAction | undefined {
  switch (problem.kind) {
    case 'signedOut':
      return { label: 'Sign in again', onClick: signIn };
    case 'rateLimited':
      // Until the limit resets, there's nothing to try.
      return problem.secondary ? again : undefined;
    case 'blocked': {
      const [link] = problem.links;
      return link ? { label: link.label, onClick: () => openPage(link.url) } : again;
    }
    case 'offline':
    case 'failed':
      return again;
    default:
      problem satisfies never;
      return again;
  }
}

/**
 * Main couldn't fetch the overview, and has nothing to show: why, and when it's fetched again,
 * counted down. Try now reads it again without waiting, and is busy until main says how that went:
 * a problem with a new time to try again, or the overview.
 */
export function ReadFailed({ tab, problem }: { tab: PullTab; problem: ReadProblem }) {
  // The try that Try now asked for, by when the problem it was pressed on said to try again.
  const [tried, setTried] = useState<number | undefined>(undefined);
  const { cause, retryAt } = problemReason(problem);
  const details =
    problem.kind === 'blocked' || problem.kind === 'failed' || problem.kind === 'offline'
      ? withoutBidi(problem.message)
      : undefined;
  const tryNow: ProblemAction = {
    label: 'Try now',
    busy: tried === problem.retryAt,
    working: 'Trying…',
    onClick: () => {
      setTried(problem.retryAt);
      main()
        .retry({ id: tab.id })
        .catch((error: unknown) => {
          console.error("Lo couldn't read the overview again:", error);
          setTried(undefined);
        });
    },
  };
  return (
    <Problem
      layout="view"
      title="Can’t show the overview"
      reason={
        <>
          {cause}
          {retryAt !== undefined && (
            <>
              {cause === '' ? '' : ' '}
              Retrying <Countdown at={retryAt} />.
            </>
          )}
        </>
      }
      action={readAction(problem, tryNow)}
      details={details}
    />
  );
}

/** A run of a stack's layers on screen as one diff has no overview: each layer has its own. */
export function NoneInRun({ tab }: { tab: PullTab }) {
  useKeys();
  const layers = useRunLayers(tab.id);
  return (
    <EmptyState
      icon="layers"
      title={`No overview for ${layers}`}
      line="Each layer has its own."
      actions={[{ command: BACK, label: 'Show single layer' }]}
    />
  );
}

/**
 * Copies the prompt that fixes or shrinks tab `id`'s overview, as `ya` does, and reads "Copied" or
 * "Couldn’t copy" as the last copy came to, as every Copy button does.
 */
function copyAction(
  id: string,
  prompt: string | undefined,
  copied: CopySaid | undefined,
): ProblemAction | undefined {
  if (prompt === undefined) return undefined;
  const keys = keyOf(COPY_PROMPT);
  return {
    // Its key's chip goes in each of its faces, beside the words that show.
    label: (
      <CopyFaces
        said={copied}
        chip={keys === undefined ? undefined : <Key keys={keys} decorative />}
      >
        Copy prompt
      </CopyFaces>
    ),
    onClick: () => void copyPrompt(id, prompt),
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
  onScreen,
}: {
  tab: PullTab;
  standing: Extract<Standing, { kind: 'unchecked' | 'invalid' | 'tooLarge' | 'newer' }>;
  /** Whether the view is on screen, so its Copy prompt answers a copy. */
  onScreen: boolean;
}) {
  useKeys();
  const now = useNow(true, 60_000);
  const state = useTabState(states, tab.id);
  const [checking, setChecking] = useState(false);
  const prompt = promptFor(tab, standing);
  const written = writtenText(standing.commit, now);
  // A later overview is the way on from any of these.
  const latest = state?.newer ? latestAction(tab) : undefined;
  // Copy prompt is the way on from an overview that's wrong or too large.
  const copies =
    latest === undefined &&
    prompt !== undefined &&
    (standing.kind === 'invalid' || standing.kind === 'tooLarge');
  const copied = usePromptCopied(tab.id, copies && onScreen);
  switch (standing.kind) {
    case 'invalid':
      return (
        <>
          <Problem
            layout="view"
            title="Can’t show this overview"
            reason={invalidSummary(standing.findings)}
            action={latest ?? copyAction(tab.id, prompt, copied)}
            details={[
              written,
              ...standing.findings.map(
                (finding) => `${findingPlace(finding)} · ${withoutBidi(finding.message)}`,
              ),
            ].join('\n')}
          />
          {copies && <CopyStatus said={copied} />}
        </>
      );
    case 'tooLarge':
      return (
        <>
          <Problem
            layout="view"
            title="Can’t show this overview"
            reason={tooLargeWords(standing.what, standing.sizes)}
            action={latest ?? copyAction(tab.id, prompt, copied)}
            details={[
              written,
              ...sizeRows(standing.sizes).map((row) => `${row.kind} · ${row.size}`),
            ].join('\n')}
          />
          {copies && <CopyStatus said={copied} />}
        </>
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
          title="Can’t check the overview"
          reason={standing.why === '' ? undefined : standing.why}
          action={
            latest ?? {
              label: 'Check again',
              busy: checking,
              working: 'Checking…',
              onClick: () => {
                setChecking(true);
                void checkAgain(tab.id).finally(() => setChecking(false));
              },
            }
          }
          details={
            standing.details === undefined
              ? written
              : [written, withoutBidi(standing.details)].join('\n')
          }
        />
      );
    default:
      standing satisfies never;
      return null;
  }
}
