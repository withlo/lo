// The overview's view when there's no overview to show: none yet, with the prompt to write one and
// the skill's rows; one that can't be shown, saying why, with the way to the diff in each case; and
// one that couldn't be read, saying when Lo tries again.

import { Button, Key, SetupItem, SetupList, Spinner } from '@lo/ui';
import { useEffect, useState, type ReactNode } from 'react';
import { useStore } from 'zustand';

import { useKeys } from '../../../window/commands/registry.ts';
import { showDiff } from '../../diff/window/shared.ts';
import { client } from '../../../window/ipc.ts';
import { contract as tabContract } from '../../tab/contract.ts';
import { useTabState, withoutBidi, type PullTab } from '../../tab/window/shared.ts';
import type { Problem, SkillAgent, SkillState } from '../contract.ts';
import type { Standing } from './facts.ts';
import { copyPrompt, promptFor } from './copy.ts';
import { WrittenBy } from './Author.tsx';
import { useNow } from './hooks.ts';
import { keyOf } from './labels.ts';
import { main } from './main.ts';
import {
  findingPlace,
  invalidSummary,
  newerWords,
  problemWords,
  sizeRows,
  tooLargeWords,
} from './says.ts';
import { NewerOffer } from './Shown.tsx';
import { checkSkill, installSkill, skillStore } from './skill.ts';
import { refusalWords } from './words.ts';
import { checkAgain, states } from './store.ts';

/** Where a newer Lo comes from, until Lo updates itself. */
export const RELEASES = 'https://github.com/withlo/lo/releases';

type Tone = 'danger' | 'warn' | 'info' | 'quiet';

/** The icon at the top of a state: what kind of news it is. */
function StateIcon({ tone }: { tone: Tone }) {
  const tones: Record<Tone, { className: string; path: ReactNode }> = {
    danger: {
      className: 'lo-i lo-ovstate__icon is-danger',
      path: (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M5.75 5.75l4.5 4.5M10.25 5.75l-4.5 4.5" />
        </>
      ),
    },
    warn: {
      className: 'lo-i lo-ovstate__icon is-warn',
      path: (
        <>
          <path d="M7.13 2.5a1 1 0 0 1 1.74 0l5.2 9.5a1 1 0 0 1-.87 1.5H2.8a1 1 0 0 1-.87-1.5Z" />
          <path d="M8 6.25v3M8 11.25v.01" />
        </>
      ),
    },
    info: {
      className: 'lo-i lo-ovstate__icon is-info',
      path: (
        <>
          <circle cx="8" cy="8" r="6.25" />
          <path d="M8 11V5.5M5.5 8 8 5.5 10.5 8" />
        </>
      ),
    },
    quiet: {
      className: 'lo-i lo-ovstate__icon',
      path: (
        <>
          <path d="M4 2.25h5.5L12 4.75v9H4Z" />
          <path d="M9.5 2.25v2.5H12M6 7.75h4M6 10.25h2.5" />
        </>
      ),
    },
  };
  const { className, path } = tones[tone];
  return (
    <svg className={className} viewBox="0 0 16 16" aria-hidden="true">
      {path}
    </svg>
  );
}

/** A state of the overview's view: a column in the middle of the sheet. */
function StateColumn({
  icon,
  title,
  children,
  actions,
}: {
  icon: ReactNode;
  title: string;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="lo-ovstate">
      <div className="lo-ovstate__col">
        {icon}
        <h2>{title}</h2>
        {children}
        {actions !== undefined && <div className="lo-ovstate__actions">{actions}</div>}
      </div>
    </div>
  );
}

/** What the view says while it's finding out what to show. */
export function Quiet({ children }: { children: ReactNode }) {
  return (
    <div className="grid h-full place-items-center p-32 text-center text-fg-muted text-ui">
      <p className="max-w-read-measure">{children}</p>
    </div>
  );
}

/** The way to the diff, with its key, primary where it's the one thing to do. */
function ToDiff({ tab, primary }: { tab: PullTab; primary: boolean }) {
  const keys = keyOf('tab.nextView');
  return (
    <Button variant={primary ? 'primary' : 'secondary'} onClick={() => showDiff(tab.id)}>
      Go to the diff
      {keys !== undefined && <Key keys={keys} quiet decorative />}
    </Button>
  );
}

/** A button that copies the prompt the state offers, with `ya`, saying so once it has. */
function CopyButton({
  prompt,
  label,
  primary = false,
  size,
}: {
  prompt: string | undefined;
  label: string;
  primary?: boolean;
  size?: 'sm' | undefined;
}) {
  const [copied, setCopied] = useState(false);
  const keys = keyOf('overview.copyPrompt');
  if (prompt === undefined) return null;
  return (
    <Button
      variant={primary ? 'primary' : 'secondary'}
      size={size}
      onClick={() => {
        copyPrompt(prompt)
          .then(() => setCopied(true))
          .catch((error: unknown) => console.error("Lo couldn't copy the prompt:", error));
      }}
    >
      {copied ? 'Copied' : label}
      {keys !== undefined && <Key keys={keys} quiet decorative />}
    </Button>
  );
}

/** What the skill's row for one agent says: what installing does, or what stops it. */
function agentWords(agent: SkillAgent, state: SkillState): string {
  if (!agent.setUp) return `${agent.name} isn't set up here: Lo found no ${agent.config}.`;
  if (agent.blocked !== null) return refusalWords(agent.blocked, state);
  return agent.installed ? `Installed in ${agent.skills}` : `Adds lo-overview to ${agent.skills}`;
}

/** The skill's row for one agent, in the list on the empty view. */
function AgentRow({
  agent,
  state,
  installing,
}: {
  agent: SkillAgent;
  state: SkillState;
  installing: boolean;
}) {
  return (
    <SetupItem
      icon={
        <svg className="lo-i" viewBox="0 0 16 16" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="2" />
          <path d="M4.75 6.5 6.75 8l-2 1.5M8.5 10h3" />
        </svg>
      }
      title={agent.name}
      description={agentWords(agent, state)}
    >
      <Button
        size="sm"
        disabled={installing || !agent.setUp || agent.installed || agent.blocked !== null}
        onClick={() => void installSkill([agent.agent])}
      >
        {agent.installed ? 'Installed' : 'Install'}
      </Button>
    </SetupItem>
  );
}

/** No overview yet: what one is, the prompt that writes one, and the skill for each agent. */
export function NoOverview({ tab, standing }: { tab: PullTab; standing: Standing }) {
  useKeys();
  const state = useTabState(states, tab.id);
  const skill = useStore(skillStore);
  const agents = skill.state;
  useEffect(() => {
    void checkSkill();
  }, []);
  const ref = state?.ref ?? `refs/lo/pr/${tab.number}`;
  const prompt = promptFor(tab, standing);
  const notCommit = standing.kind === 'none' && standing.notCommit;
  const settings = keyOf('settings.open');
  const toDiff = keyOf('tab.nextView');
  return (
    <div className="lo-ovstate">
      <div className="lo-ovstate__col">
        <StateIcon tone="quiet" />
        <h2>No overview yet</h2>
        <p>
          {notCommit && (
            <>
              <span className="code-text">{ref}</span> holds something other than a commit, so it
              isn’t an overview.{' '}
            </>
          )}
          An overview explains a PR in prose, figures and its real code. Lo doesn’t write them:
          paste this prompt into a coding agent, and it writes one and pushes it to{' '}
          <span className="text-fg code-text">{ref}</span>.{' '}
          {state?.watching === false
            ? 'Open the PR again once it’s pushed to see it.'
            : 'It shows here as soon as it lands.'}
        </p>
        {prompt !== undefined && (
          <div className="lo-prompt">
            <div className="lo-prompt__head">
              Prompt for your agent
              <CopyButton prompt={prompt} label="Copy" primary size="sm" />
            </div>
            <pre className="lo-prompt__body lo-selectable">{prompt}</pre>
          </div>
        )}
        {agents && agents.agents.length > 0 && (
          <div className="flex flex-col gap-8">
            <span className="label-caps text-fg-muted text-label">
              No skill yet? Install it once
            </span>
            <SetupList label="The overview skill">
              {agents.agents.map((agent) => (
                <AgentRow
                  key={agent.agent}
                  agent={agent}
                  state={agents}
                  installing={skill.installing}
                />
              ))}
            </SetupList>
            {skill.said !== undefined && (
              <p className="text-small" role="status">
                {skill.said}
              </p>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-16 text-fg-muted text-small">
          {toDiff !== undefined && (
            <span className="inline-flex items-center gap-6">
              <Key keys={toDiff} quiet decorative />
              Go to the diff
            </span>
          )}
          {settings !== undefined && (
            <span className="inline-flex items-center gap-6">
              <Key keys={settings} quiet decorative />
              Open on the overview or the diff
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** Main couldn't read the ref, and has nothing to show: why, and when it tries again. */
export function ReadFailed({ tab, problem }: { tab: PullTab; problem: Problem }) {
  const state = useTabState(states, tab.id);
  const now = useNow(true);
  const ref = state?.ref ?? `refs/lo/pr/${tab.number}`;
  const links = problem.kind === 'blocked' ? problem.links : [];
  return (
    <StateColumn
      icon={<Spinner />}
      title="Couldn’t fetch the overview"
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => {
              main()
                .retry({ id: tab.id })
                .catch((error: unknown) => console.error("Lo couldn't read it again:", error));
            }}
          >
            Retry now
          </Button>
          {links.map((link) => (
            <Button
              key={link.url}
              onClick={() => {
                client(tabContract)
                  .openExternal({ url: link.url })
                  .catch((error: unknown) => console.error("Lo couldn't open the link:", error));
              }}
            >
              {link.label}
            </Button>
          ))}
          <ToDiff tab={tab} primary={false} />
        </>
      }
    >
      <p>{problemWords(problem, ref, now)}</p>
    </StateColumn>
  );
}

/** An overview that can't be shown: why, as its check found, and the way to the diff. */
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
  const newer = state?.newer ? <NewerOffer tab={tab.id} /> : null;
  const prompt = promptFor(tab, standing);
  switch (standing.kind) {
    case 'invalid':
      return (
        <StateColumn
          icon={<StateIcon tone="danger" />}
          title="This overview can’t be read"
          actions={
            <>
              <ToDiff tab={tab} primary />
              <CopyButton prompt={prompt} label="Copy a prompt to fix it" />
              {newer}
            </>
          }
        >
          <p>
            {invalidSummary(standing.findings)} It’s at{' '}
            <WrittenBy commit={standing.commit} now={now} />.
          </p>
          {standing.findings.length > 0 && (
            <ul className="lo-ovstate__report" aria-label="Problems">
              {standing.findings.map((finding, index) => (
                <li key={index}>
                  <span>{withoutBidi(findingPlace(finding))}</span>
                  <span>{withoutBidi(finding.message)}</span>
                </li>
              ))}
            </ul>
          )}
        </StateColumn>
      );
    case 'tooLarge':
      return (
        <StateColumn
          icon={<StateIcon tone="warn" />}
          title="This overview is too large to show"
          actions={
            <>
              <ToDiff tab={tab} primary />
              <CopyButton prompt={prompt} label="Copy a prompt to shrink it" />
              {newer}
            </>
          }
        >
          <p>
            {tooLargeWords(standing.what, standing.sizes)} It’s at{' '}
            <WrittenBy commit={standing.commit} now={now} />.
          </p>
          {standing.sizes.kinds.length > 0 && (
            <ul className="lo-ovstate__report" aria-label="Sizes">
              {sizeRows(standing.sizes).map((row) => (
                <li key={row.kind}>
                  <span>{row.kind}</span>
                  <span>{row.size}</span>
                </li>
              ))}
            </ul>
          )}
        </StateColumn>
      );
    case 'newer':
      return (
        <StateColumn
          icon={<StateIcon tone="info" />}
          title="This overview needs a newer Lo"
          actions={
            <>
              <Button
                variant="primary"
                onClick={() => {
                  client(tabContract)
                    .openExternal({ url: RELEASES })
                    .catch((error: unknown) => console.error("Lo couldn't open the page:", error));
                }}
              >
                Get a newer Lo
              </Button>
              <ToDiff tab={tab} primary={false} />
              {newer}
            </>
          }
        >
          <p>{newerWords(standing.format)}</p>
        </StateColumn>
      );
    case 'unchecked':
      return (
        <StateColumn
          icon={<StateIcon tone="danger" />}
          title="Lo couldn’t check this overview"
          actions={
            <>
              <Button variant="primary" onClick={() => checkAgain(tab.id)}>
                Check again
              </Button>
              <ToDiff tab={tab} primary={false} />
              {newer}
            </>
          }
        >
          <p>{withoutBidi(standing.why)}</p>
        </StateColumn>
      );
    default:
      standing satisfies never;
      return null;
  }
}
