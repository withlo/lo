// @vitest-environment jsdom
// The overview skill's rows in a window of their own, with main answered by a stand-in bridge: the
// step on the welcome screen, the row in Settings' Command line, and the command in the app menu.
// What main installs, and in which folders, is tested beside it, in a temporary home.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished } from 'vitest';

import { notice } from '../../../window/commands/notices.tsx';
import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import { commandLine } from '../../open/window/shared.ts';
import { setup } from '../../welcome/window/shared.ts';
import type { SkillAgent, SkillResult, SkillState } from '../contract.ts';
import feature from './index.ts';
import { skillStore } from './skill.ts';

/** Both agents as main reports them, `changes` over each. */
function state(claude: Partial<SkillAgent> = {}, codex: Partial<SkillAgent> = {}): SkillState {
  return {
    agents: [
      {
        agent: 'claude',
        name: 'Claude Code',
        setUp: true,
        installed: false,
        config: '~/.claude',
        skills: '~/.claude/skills',
        ...claude,
      },
      {
        agent: 'codex',
        name: 'Codex',
        setUp: true,
        installed: false,
        config: '~/.codex',
        skills: '~/.agents/skills',
        ...codex,
      },
    ],
  };
}

/** What main answers each channel with now: the bridge reads it as it is asked. */
const answers: Record<string, (input: unknown) => unknown> = {};
let shared: FakeBridge;

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  shared = installBridge(answers);
  // As the window starts the feature, once: main's pushes reach the store.
  feature.start?.();
});

afterEach(() => {
  skillStore.setState({ state: undefined, installing: false, said: undefined });
});

/**
 * Main as the rows find it: the skill at `now`, and installing it answering `results` and, when
 * `after` is given, leaving things as it says.
 */
function main(
  now: SkillState,
  results: SkillResult[] = [],
  after?: SkillState,
): { bridge: FakeBridge; asked: () => unknown[] } {
  let current = now;
  for (const channel of Object.keys(answers)) delete answers[channel];
  Object.assign(answers, {
    'overview.currentSkill': () => current,
    'overview.installSkill': () => {
      if (after) current = after;
      return results;
    },
  });
  shared.calls.length = 0;
  return {
    bridge: shared,
    asked: () => shared.calls.filter(([channel]) => channel === 'overview.installSkill'),
  };
}

/** Lets every answer main gave, and what follows from it, happen. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < 8; turn++) await Promise.resolve();
  });
}

/** Both slots the rows fill, as the welcome screen and Settings draw them. */
function render(): HTMLElement {
  const host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  act(() =>
    root.render(
      <Slots views={feature.views ?? []}>
        <ul aria-label="Optional steps">
          <Slot slot={setup} props={{}} />
        </ul>
        <section aria-label="Command line">
          <Slot slot={commandLine} props={{}} />
        </section>
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

const step = () => document.querySelector<HTMLElement>('[aria-label="Optional steps"] > li');
const row = () => document.querySelector<HTMLElement>('[aria-label="Command line"]');

function button(within: Element | null, text: string): HTMLButtonElement {
  const found = [...(within?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}".`);
  return found;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('the welcome screen’s step', () => {
  it('is "Install the overview skill", with what it is for', async () => {
    main(state());
    render();
    await settle();
    expect(step()?.querySelector('.text-ui-strong')?.textContent).toBe(
      'Install the overview skill',
    );
    expect(step()?.textContent).toContain(
      'Teaches Claude Code and Codex to write overviews that Lo shows.',
    );
    expect(button(step(), 'Install').disabled).toBe(false);
  });

  it('installs for each agent that is set up, and says so', async () => {
    const asked = main(
      state({ setUp: true }, { setUp: false }),
      [{ kind: 'installed', agent: 'claude' }],
      state({ installed: true }, { setUp: false }),
    );
    render();
    await settle();
    click(button(step(), 'Install'));
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['claude'] }]]);
    expect(button(step(), 'Installed').disabled).toBe(true);
    expect(notice()).toEqual({
      title: 'Install overview skill',
      body: 'Installed the overview skill for Claude Code in ~/.claude/skills.',
    });
  });

  it('says so in a notice when no agent is set up', async () => {
    const asked = main(state({ setUp: false }, { setUp: false }), [
      { kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } },
    ]);
    render();
    await settle();
    click(button(step(), 'Install'));
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: [] }]]);
    expect(notice()?.body).toBe(
      'Lo found neither Claude Code nor Codex set up on this computer. Set one up, then install the skill.',
    );
    expect(button(step(), 'Install').disabled).toBe(false);
  });
});

describe('Settings’ row', () => {
  it('says where the skill is for each agent, naming each folder', async () => {
    main(state({ installed: true }));
    render();
    await settle();
    expect(row()?.querySelector('.text-ui-strong')?.textContent).toBe('Overview skill');
    expect(row()?.querySelector('[role="status"]')?.textContent).toBe(
      'Installed for Claude Code in ~/.claude/skills. Not installed for Codex, which reads ~/.agents/skills.',
    );
    expect(button(row(), 'Install for Codex')).toBeDefined();
  });

  it('installs for the rest, and then offers to install again', async () => {
    const asked = main(
      state({ installed: true }),
      [{ kind: 'installed', agent: 'codex' }],
      state({ installed: true }, { installed: true }),
    );
    render();
    await settle();
    click(button(row(), 'Install for Codex'));
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['codex'] }]]);
    expect(row()?.querySelector('[role="status"]')?.textContent).toBe(
      'Installed for Claude Code in ~/.claude/skills. Installed for Codex in ~/.agents/skills.',
    );

    click(button(row(), 'Install again'));
    await settle();
    expect(asked.asked().at(-1)).toEqual([
      'overview.installSkill',
      { agents: ['claude', 'codex'] },
    ]);
  });

  it('says why an agent was refused, until the next install', async () => {
    main(state(), [
      { kind: 'installed', agent: 'claude' },
      {
        kind: 'refused',
        agent: 'codex',
        why: { kind: 'otherSkill', path: '/h/.agents/skills/lo-overview', name: 'review' },
      },
    ]);
    render();
    await settle();
    click(button(row(), 'Install'));
    await settle();
    expect(row()?.querySelector('[role="status"]')?.textContent).toBe(
      'Installed the overview skill for Claude Code in ~/.claude/skills. Not installed for Codex. /h/.agents/skills/lo-overview holds another skill, "review". Move it, then install again.',
    );
  });

  it('follows what main pushes', async () => {
    const { bridge } = main(state());
    render();
    await settle();
    act(() => bridge.push('overview.skill', state({ installed: true }, { installed: true })));
    expect(row()?.querySelector('[role="status"]')?.textContent).toContain(
      'Installed for Codex in ~/.agents/skills.',
    );
    expect(button(row(), 'Install again')).toBeDefined();
  });

  it('is disabled while an install is under way', async () => {
    main(state());
    render();
    await settle();
    act(() => skillStore.setState({ installing: true }));
    expect(button(row(), 'Install').disabled).toBe(true);
    expect(button(step(), 'Install').disabled).toBe(true);
  });
});

describe('the command in the app menu', () => {
  it('has no key, and installs as the buttons do', async () => {
    const asked = main(state(), [{ kind: 'installed', agent: 'claude' }]);
    const [command] = feature.commands ?? [];
    expect(command?.id).toBe('overview.installSkill');
    expect(command?.keys).toEqual([]);
    expect(command?.bar).toEqual({ menu: 'App', order: 20 });
    await act(async () => {
      await command?.handler?.run({ kind: 'none' });
    });
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['claude', 'codex'] }]]);
  });
});
