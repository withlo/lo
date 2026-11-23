// @vitest-environment jsdom
// The overview skill's rows in a window of their own, with main answered by a stand-in bridge: the
// step on the welcome screen, the rows in Settings › Integrations, and the command in the palette.
// What main installs, and in which folders, is tested beside it, in a temporary home.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { install } from '@withlo/overview/install';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice, notices } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { Slot, Slots } from '../../../window/slots.tsx';
import { installBridge, type FakeBridge } from '../../../window/test/bridge.ts';
import { rows } from '../../settings/window/shared.ts';
import { setup } from '../../welcome/window/shared.ts';
import type { SkillAgent, SkillResult, SkillState } from '../contract.ts';
import feature from './index.ts';
import { COPIED_FOR, INSTALL_COMMAND, skillStore } from './skill.ts';

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
        blocked: null,
        ...claude,
      },
      {
        agent: 'codex',
        name: 'Codex',
        setUp: true,
        installed: false,
        config: '~/.codex',
        skills: '~/.agents/skills',
        blocked: null,
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
  // The window's keys, for the keys the rows show.
  createRegistry(feature.commands ?? [], 'mac');
  // As the window starts the feature, once: main's pushes reach the store.
  feature.start?.();
});

afterEach(() => {
  skillStore.setState({
    state: undefined,
    installing: false,
    failed: undefined,
    copied: undefined,
  });
});

/**
 * Main as the rows find it: the skill at `now`, and installing it answering `results` and, when
 * `after` is given, leaving things as it says.
 */
function main(
  now: SkillState,
  results: SkillResult[] = [],
  after?: SkillState,
): { bridge: FakeBridge; asked: () => unknown[]; leave: (state: SkillState) => void } {
  let current = now;
  for (const channel of Object.keys(answers)) delete answers[channel];
  Object.assign(answers, {
    'overview.currentSkill': () => current,
    'overview.installSkill': () => {
      if (after) current = after;
      return results;
    },
    'tab.copy': () => undefined,
  });
  shared.calls.length = 0;
  return {
    bridge: shared,
    asked: () => shared.calls.filter(([channel]) => channel === 'overview.installSkill'),
    // Things changing outside Lo, as a person fixing a folder does.
    leave: (next) => {
      current = next;
    },
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
        <section aria-label="Integrations">
          <Slot slot={rows} props={{}} />
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
/** Settings' row called `label`. */
const settingRow = (label: string) =>
  [...document.querySelectorAll<HTMLElement>('.setting-row')].find(
    (each) => each.querySelector('.text-ui-strong')?.textContent === label,
  ) ?? null;
const row = () => settingRow('Overview skill');

/** What the row says of each agent, a line each. */
const lines = () =>
  [...(row()?.querySelectorAll('[role="status"] li') ?? [])].map((each) => each.textContent);

function button(within: Element | null, text: string): HTMLButtonElement {
  const found = [...(within?.querySelectorAll('button') ?? [])].find((each) =>
    each.textContent.startsWith(text),
  );
  if (!found) throw new Error(`No button "${text}".`);
  return found;
}

/** The install command's Copy button. */
function copyButton(): HTMLButtonElement {
  return button(commandRow() ?? null, 'Copy');
}

/** What the Copy button says now: the face of its three that shows. */
function faceOf(copy: HTMLButtonElement): string | undefined {
  const shown = [...copy.querySelectorAll('.inline-grid > span')].find(
    (face) => !face.classList.contains('invisible'),
  );
  return shown?.textContent ?? undefined;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** Lets `ms` go by, with fake timers on. */
function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('the welcome screen’s step', () => {
  it('is "Overview skill", with what it is for and a picture of an overview', async () => {
    main(state());
    render();
    await settle();
    expect(step()?.querySelector('.text-ui-strong')?.textContent).toBe('Overview skill');
    expect(step()?.querySelector('[role="img"]')?.textContent).toContain('parse');
    expect(step()?.textContent).toContain(
      'Teaches Claude Code and Codex to write overviews that Lo shows.',
    );
    expect(button(step(), 'Install').disabled).toBe(false);
  });

  it('installs for each agent that is set up, and says so on the step alone', async () => {
    const asked = main(
      state({ setUp: true }, { setUp: false }),
      [{ kind: 'installed', agent: 'claude' }],
      state({ installed: true }, { setUp: false }),
    );
    render();
    await settle();
    const before = notices();
    click(button(step(), 'Install'));
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['claude'] }]]);
    expect(step()?.textContent).toContain('Installed');
    expect(step()?.querySelector('button')).toBeNull();
    expect(notices()).toEqual(before);
  });

  it('says on the step what stops an install, and that one failed, with a way to try again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const why = { kind: 'otherSkill', path: '~/.agents/skills/lo-overview', name: null } as const;
    main(state({ installed: true }, { blocked: why }));
    render();
    await settle();
    expect(step()?.textContent).toContain(
      '~/.agents/skills/lo-overview holds another skill. Move it, then install again.',
    );
    // A path is code.
    expect(
      [...(step()?.querySelectorAll('.code-small') ?? [])].map((each) => each.textContent),
    ).toContain('~/.agents/skills/lo-overview');
    answers['overview.installSkill'] = () => {
      throw new IpcError('internal', 'overview.installSkill failed.');
    };
    const before = notices();
    click(button(step(), 'Install'));
    await settle();
    expect(step()?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t install the overview skill',
    );
    expect(notices()).toEqual(before);
    expect(button(step(), 'Try again')).toBeDefined();
  });

  it('dims Install with why while no agent is set up, and asks nothing', async () => {
    const asked = main(state({ setUp: false }, { setUp: false }), [
      { kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } },
    ]);
    render();
    await settle();
    const dimmed = button(step(), 'Install');
    expect(dimmed.getAttribute('aria-disabled')).toBe('true');
    expect(dimmed.getAttribute('aria-description')).toBe('Set up Claude Code or Codex first');
    const before = notices();
    click(dimmed);
    await settle();
    expect(asked.asked()).toEqual([]);
    expect(notices()).toEqual(before);
  });
});

describe('Settings’ row', () => {
  it('says where the skill is for each agent, naming each folder', async () => {
    main(state({ installed: true }));
    render();
    await settle();
    expect(row()?.querySelector('.text-ui-strong')?.textContent).toBe('Overview skill');
    expect(lines()).toEqual([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · not installed',
    ]);
    expect(row()?.querySelector('[role="status"] .code-small')?.textContent).toBe(
      '~/.claude/skills',
    );
    expect(button(row(), 'Install for Codex')).toBeDefined();
  });

  it('dims Install with why while no agent is set up', async () => {
    main(state({ setUp: false }, { setUp: false }), [
      { kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } },
    ]);
    render();
    await settle();
    expect(lines()).toEqual(['Claude Code · not set up', 'Codex · not set up']);
    const dimmed = button(row(), 'Install');
    expect(dimmed.getAttribute('aria-disabled')).toBe('true');
    expect(dimmed.getAttribute('aria-description')).toBe('Set up Claude Code or Codex first');
  });

  it('says why alone, with no title, when the command asks while no agent is set up', async () => {
    const asked = main(state({ setUp: false }, { setUp: false }), [
      { kind: 'refused', agent: null, why: { kind: 'nothingSetUp' } },
    ]);
    render();
    await settle();
    // The command asks main as it runs, since an agent may have been set up since the rows looked.
    const command = feature.commands?.find((each) => each.id === 'overview.installSkill');
    expect(command?.handler?.enabled?.({ kind: 'none' })).toBe(true);
    await act(async () => {
      await command?.handler?.run({ kind: 'none' });
    });
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: [] }]]);
    expect(notice()).toMatchObject({ title: 'Set up Claude Code or Codex first', body: '' });
    expect(notice()?.tone).toBeUndefined();
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
    expect(lines()).toEqual([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · installed in ~/.agents/skills',
    ]);

    click(button(row(), 'Install again'));
    await settle();
    expect(asked.asked().at(-1)).toEqual([
      'overview.installSkill',
      { agents: ['claude', 'codex'] },
    ]);
  });

  it('says what stops an install for as long as something does, and no longer', async () => {
    const stuck = state(
      { installed: true },
      {
        blocked: { kind: 'otherSkill', path: '~/.agents/skills/lo-overview', name: 'review' },
      },
    );
    const { leave } = main(
      state(),
      [
        { kind: 'installed', agent: 'claude' },
        {
          kind: 'refused',
          agent: 'codex',
          why: { kind: 'otherSkill', path: '~/.agents/skills/lo-overview', name: 'review' },
        },
      ],
      stuck,
    );
    render();
    await settle();
    const before = notices();
    click(button(row(), 'Install'));
    await settle();
    const said = [
      'Claude Code · installed in ~/.claude/skills',
      'Codex · not installed ~/.agents/skills/lo-overview holds another skill, "review". Move it, then install again.',
    ];
    expect(lines()).toEqual(said);
    // Said on the row, which asked, and in no note besides.
    expect(notices()).toEqual(before);

    // Fixed outside Lo, which finds out when it comes to the front again.
    leave(state({ installed: true }));
    expect(lines()).toEqual(said);
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle();
    expect(lines()).toEqual([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · not installed',
    ]);
  });

  it('says a skill reached through a link is installed, and that Lo left it as it was', async () => {
    const link = {
      kind: 'link',
      path: '~/.claude/skills/lo-overview',
    } as const;
    const asked = main(state({ installed: true, blocked: link }, { installed: true }), [
      { kind: 'refused', agent: 'claude', why: link },
      { kind: 'installed', agent: 'codex' },
    ]);
    render();
    await settle();
    expect(lines()[0]).toBe(
      "Claude Code · installed, can’t update ~/.claude/skills/lo-overview is a link, and Lo doesn't install the skill through links. Remove it, then install again.",
    );
    const before = notices();
    click(button(row(), 'Install again'));
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['claude', 'codex'] }]]);
    expect(notices()).toEqual(before);
    expect(lines()[0]).toContain('Claude Code · installed, can’t update');
  });

  it('says once, on the row, that it couldn’t install, with a way to try again', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    onTestFinished(() => quiet.mockRestore());
    const asked = main(state());
    answers['overview.installSkill'] = () => {
      throw new IpcError('internal', 'overview.installSkill failed.');
    };
    render();
    await settle();
    const before = notices();
    click(button(row(), 'Install'));
    await settle();
    expect(row()?.querySelector('[role="alert"]')?.textContent).toBe(
      'Couldn’t install the overview skill',
    );
    // What failed, in its own words, is behind Details.
    click(button(row(), 'Details'));
    expect(row()?.textContent).toContain('overview.installSkill failed.');
    expect(notices()).toEqual(before);
    click(button(row(), 'Try again'));
    await settle();
    expect(asked.asked()).toHaveLength(2);
  });

  it('keeps the state main pushed over an answer it gave from before', async () => {
    const after = state({ installed: true }, { installed: true });
    const { bridge } = main(state(), [{ kind: 'installed', agent: 'claude' }]);
    // The answer after the install comes from before it, while main pushes where things stand.
    let asks = 0;
    answers['overview.currentSkill'] = () => {
      asks++;
      // The first asks are the rows' own as they appear, then the install's, then the one after it.
      if (asks === 4) bridge.push('overview.skill', after);
      return state();
    };
    render();
    await settle();
    click(button(step(), 'Install'));
    await settle();
    expect(asks).toBe(4);
    expect(step()?.textContent).toContain('Installed');
    expect(step()?.querySelector('button')).toBeNull();
    expect(lines()).toEqual([
      'Claude Code · installed in ~/.claude/skills',
      'Codex · installed in ~/.agents/skills',
    ]);
  });

  it('offers nothing to install while it learns where things stand after an install', async () => {
    const { bridge } = main(state(), [{ kind: 'installed', agent: 'claude' }]);
    let release: (() => void) | undefined;
    let asks = 0;
    answers['overview.currentSkill'] = async () => {
      asks++;
      // The fourth is the one after the install, which waits.
      if (asks === 4) await new Promise<void>((resolve) => (release = resolve));
      return asks === 4
        ? state({ installed: true }, { setUp: false })
        : state({}, { setUp: false });
    };
    render();
    await settle();
    click(button(step(), 'Install'));
    await settle();
    // The install is over, and the window hasn't heard where things stand: no button to press.
    expect(step()?.querySelector('button')?.getAttribute('aria-busy')).toBe('true');
    expect(button(row(), 'Install').getAttribute('aria-disabled')).toBe('true');
    // Pressed while it's busy, it asks for nothing more.
    click(step()?.querySelector('button') ?? document.body);
    act(() => release?.());
    await settle();
    expect(bridge.calls.filter(([channel]) => channel === 'overview.installSkill')).toHaveLength(1);
    expect(step()?.textContent).toContain('Installed');
    expect(step()?.querySelector('button')).toBeNull();
  });

  it('follows what main pushes', async () => {
    const { bridge } = main(state());
    render();
    await settle();
    act(() => bridge.push('overview.skill', state({ installed: true }, { installed: true })));
    expect(lines()).toContain('Codex · installed in ~/.agents/skills');
    expect(button(row(), 'Install again')).toBeDefined();
  });

  it('is busy while an install is under way', async () => {
    main(state());
    render();
    await settle();
    act(() => skillStore.setState({ installing: true }));
    expect(button(row(), 'Install').getAttribute('aria-busy')).toBe('true');
    const inStep = step()?.querySelector('button');
    expect(inStep?.getAttribute('aria-busy')).toBe('true');
    expect(inStep?.textContent).toContain('Installing…');
  });
});

describe('the command in the palette', () => {
  it('has no key, its control is Settings’ row, and installs as the buttons do', async () => {
    const asked = main(state(), [{ kind: 'installed', agent: 'claude' }]);
    const command = feature.commands?.find((each) => each.id === 'overview.installSkill');
    expect(command?.keys).toEqual([]);
    expect(command?.bar).toBeUndefined();
    expect(command?.control).toContain('Settings');
    await act(async () => {
      await command?.handler?.run({ kind: 'none' });
    });
    await settle();
    expect(asked.asked()).toEqual([['overview.installSkill', { agents: ['claude', 'codex'] }]]);
  });
});

/** Settings' row for the command that installs the skill from a terminal. */
const commandRow = () => settingRow('On another computer');
/** What the command row's Copy button says it did, to a screen reader. */
const commandStatus = () => commandRow()?.querySelector('[role="status"]')?.textContent;
/** What the window asked main to put on the clipboard. */
const copies = () =>
  shared.calls.filter(([channel]) => channel === 'tab.copy').map(([, input]) => input);

describe('Settings’ row for the command that installs the skill', () => {
  const command = INSTALL_COMMAND;

  it('pins the checker by the version the skill Lo installs runs', () => {
    const skills = mkdtempSync(join(tmpdir(), 'lo-skill-'));
    onTestFinished(() => rmSync(skills, { recursive: true, force: true }));
    const [installed] = install([{ agent: undefined, skills }]);
    const text = readFileSync(join(installed?.folder ?? skills, 'SKILL.md'), 'utf8');
    const pinned = new Set(text.match(/@withlo\/overview@\S+/g));
    expect([...pinned]).toHaveLength(1);
    expect(command).toBe(`npx ${[...pinned][0]} install`);
    expect(command).toMatch(/^npx @withlo\/overview@\d+\.\d+\.\d+ install$/);
  });

  it('shows the command, and the key that copies it', async () => {
    main(state());
    render();
    await settle();
    expect(commandRow()?.querySelector('.code-small')?.textContent).toBe(command);
    expect(commandRow()?.querySelector('.text-fg-muted')?.textContent).toBe(
      'The overview skill installs from a terminal.',
    );
    const copy = copyButton();
    expect([...copy.querySelectorAll('kbd')].map((each) => each.textContent)).toEqual(['y', 'c']);
    expect(copy.getAttribute('aria-description')).toBe('Keys y then c');
  });

  it('copies it with its button, and says so', async () => {
    main(state());
    render();
    await settle();
    click(copyButton());
    await settle();
    expect(copies()).toEqual([{ text: command }]);
    expect(faceOf(copyButton())).toBe('Copied');
    expect(commandStatus()).toBe('Copied');
  });

  it('goes back to "Copy" after a few seconds, and says each copy again', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    onTestFinished(() => {
      vi.useRealTimers();
    });
    main(state());
    render();
    await settle();
    click(copyButton());
    await settle();
    expect(faceOf(copyButton())).toBe('Copied');
    expect(commandStatus()).toBe('Copied');
    // Copying again before it went back starts the time again.
    advance(COPIED_FOR - 1000);
    click(copyButton());
    await settle();
    advance(COPIED_FOR - 1000);
    expect(faceOf(copyButton())).toBe('Copied');
    advance(1000);
    expect(faceOf(copyButton())).toBe('Copy');
    expect(commandStatus()).toBe('');
    // So the next copy is said as the first was.
    click(copyButton());
    await settle();
    expect(faceOf(copyButton())).toBe('Copied');
    expect(commandStatus()).toBe('Copied');
    expect(copies()).toHaveLength(3);
  });

  it('says on its button when it can’t copy the command, and in no note', async () => {
    const asked = main(state());
    render();
    await settle();
    click(copyButton());
    await settle();
    expect(faceOf(copyButton())).toBe('Copied');
    answers['tab.copy'] = () => {
      throw new IpcError('unavailable', 'The clipboard is busy.');
    };
    const before = notices();
    click(copyButton());
    await settle();
    expect(asked.bridge.calls.filter(([channel]) => channel === 'tab.copy')).toHaveLength(2);
    // Not "Copied", which would say the clipboard has what it doesn't.
    expect(faceOf(copyButton())).toBe('Couldn’t copy');
    expect(commandRow()?.querySelector('[role="status"]')?.textContent).toBe('Couldn’t copy');
    expect(notices()).toEqual(before);
  });

  it('copies it with y c, in Settings', async () => {
    main(state());
    render();
    await settle();
    const copy = feature.commands?.find((each) => each.id === 'overview.copyInstallCommand');
    expect(copy?.keys).toEqual(['y c']);
    expect(copy?.when).toEqual({ scope: 'settings' });
    await act(async () => {
      await copy?.handler?.run({ kind: 'none' });
    });
    await settle();
    expect(copies()).toEqual([{ text: command }]);
    expect(faceOf(copyButton())).toBe('Copied');
  });
});
