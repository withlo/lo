// @vitest-environment jsdom
// The overview's view in a window of its own, with main answered by a stand-in bridge and the
// overview checked as the window checks it, in this process: what it draws while the tab opens and
// after, each state, and that a result checked again, or copied, leaves every node on screen as it
// was, its folds open and its focus where it was. What Settings says and showing the diff are
// stood in for, so each test says what Settings holds and sees when the tab hands over to the diff.

import { commandsOf, holdRegistry } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { IpcError } from '../../../ipc/contract.ts';
import { notice, notices, withdraw } from '../../../window/commands/notices.tsx';
import { createRegistry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { HOLD_LIMIT } from '../../revisions/contract.ts';
import type { Setting } from '../../settings/contract.ts';
import tabKeys from '../../tab/keys.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { OverviewCommit, OverviewState, SkillState } from '../contract.ts';
import keys from '../keys.ts';
import { checkOverview, parseOverview } from '../background/index.ts';
import settingsKeys from '../../settings/keys.ts';
import updatesKeys from '../../updates/keys.ts';
import { Checking } from './checking.ts';
import { copyPrompt as copyPromptOf } from './copy.ts';
import { OverviewMark } from './Mark.tsx';
import { openings } from './opening.ts';
import { OverviewView } from './Overview.tsx';
import { blockInOverview, blockKey } from './shared.ts';
import { OverviewStatus } from './Status.tsx';
import { checked, publish, readAgain, states } from './store.ts';

/** What Settings says a pull request opens on: unknown until main has said. */
const settings = vi.hoisted(() => ({ open: 'overview' as 'overview' | 'diff' | undefined }));
/** The diff, shown as the tab hands over to it. */
const showDiff = vi.hoisted(() => vi.fn<(tab: string) => boolean>(() => true));

vi.mock(import('../../settings/window/shared.ts'), async (original) => ({
  ...(await original()),
  useKnownSetting: <T,>(setting: Setting<T>): T | undefined =>
    settings.open === undefined ? undefined : setting.schema.parse(settings.open),
}));
vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  showDiff,
}));

const encoder = new TextEncoder();
const HEAD = 'a'.repeat(40);
const SVG = encoder.encode(
  '<svg viewBox="0 0 100 50" xmlns="http://www.w3.org/2000/svg"><g id="parse"><rect x="0" y="0" width="40" height="40" fill="var(--fig-blue)"/></g></svg>',
);
const TEXT = encoder.encode(
  [
    `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n`,
    '## tl;dr\n\nIt reads [lines](term:line).\n',
    '## How it works\n',
    ':::code src/a.ts#L1-L2\n:::\n',
    ':::fold Why it moves\nNothing imports it.\n:::\n',
    ':::figure figures/flow.svg\nThe flow.\n\n- [parse](code:src/a.ts#L1)\n:::\n',
    '## Glossary\n\n- **Line**: one line.\n',
  ].join('\n'),
);

let next = 0;

/** A pull request's tab of its own, so no test finds another's state. */
function tabOf(): PullTab {
  next += 1;
  return { id: `t${next}`, kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 7 };
}

function commitOf(): OverviewCommit {
  return {
    id: 'c'.repeat(40),
    source: 'base',
    repository: { owner: 'rozed-dev', name: 'e2e' },
    byline: { login: 'ravi-k', name: 'Ravi', at: Date.now() - 2 * 86_400_000 },
    entries: [
      { path: 'artifact.md', kind: 'file', size: TEXT.length, id: 'b'.repeat(40) },
      { path: 'figures', kind: 'folder', size: null, id: 'd'.repeat(40) },
      { path: 'figures/flow.svg', kind: 'file', size: SVG.length, id: 'e'.repeat(40) },
    ],
    truncated: false,
    read: true,
  };
}

function stateOf(tab: PullTab, change: Partial<OverviewState> = {}): OverviewState {
  return {
    id: tab.id,
    ref: 'refs/lo/pr/7',
    watching: true,
    found: 'commit',
    overview: commitOf(),
    newer: null,
    saved: false,
    problem: null,
    code: 'waiting',
    ...change,
  };
}

const SKILL: SkillState = {
  agents: [
    {
      agent: 'claude',
      name: 'Claude Code',
      setUp: true,
      installed: false,
      config: '~/.claude',
      skills: '~/.claude/skills',
      blocked: null,
    },
    {
      agent: 'codex',
      name: 'Codex',
      setUp: false,
      installed: false,
      config: '~/.codex',
      skills: '~/.agents/skills',
      blocked: null,
    },
  ],
};

/** Whether main's clipboard refuses what it's given, and how main answers a read again. */
const answers = vi.hoisted(() => ({ copyFails: false, retried: (): void => undefined }));

const bridge = installBridge({
  'tab.copy': () => {
    if (answers.copyFails) throw new IpcError('failed', 'The clipboard is busy.');
  },
  'tab.openExternal': () => undefined,
  'overview.currentSkill': () => SKILL,
  // Answered once the test says main's read is done.
  'overview.retry': () =>
    new Promise<void>((resolve) => {
      answers.retried = resolve;
    }),
});

/** Runs of "Check for updates" and Copy prompt, whose handlers are stood in for. */
const checkUpdates = vi.hoisted(() => vi.fn<() => void>());
const copyPrompt = vi.hoisted(() => vi.fn<() => void>());

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  // Held as the key listener holds it, so the views' buttons find their commands.
  holdRegistry(
    createRegistry(
      [
        ...commandsOf(tabKeys),
        ...commandsOf(keys).map((command) =>
          command.id === 'overview.copyPrompt'
            ? { ...command, handler: { run: copyPrompt } }
            : command,
        ),
        ...commandsOf(settingsKeys),
        ...commandsOf(updatesKeys).map((command) =>
          command.id === 'updates.check' ? { ...command, handler: { run: checkUpdates } } : command,
        ),
      ],
      'mac',
    ),
  );
});

afterEach(() => {
  vi.useRealTimers();
  settings.open = 'overview';
  showDiff.mockClear();
  checkUpdates.mockClear();
  copyPrompt.mockClear();
});

/** The title of the problem the view shows in the overview's place, for a standing of `kind`. */
function problemTitle(view: HTMLElement, kind: string): string | undefined {
  return (
    view.querySelector(`[data-lo-overview="${kind}"] [role="alert"] > p:first-child`)
      ?.textContent ?? undefined
  );
}

/** The button on `view` whose words start with `label`. */
function buttonOf(view: HTMLElement, label: string): HTMLButtonElement | undefined {
  return [...view.querySelectorAll('button')].find((each) => each.textContent?.startsWith(label));
}

/** The toasts showing, by their lines, oldest first. */
function toasts(): string[] {
  return notices().map((note) => note.title);
}

/** What `button` reads now: its face in view, of those it holds room for, without its key. */
function faceOf(button: HTMLButtonElement | undefined): string | undefined {
  const faces = button?.querySelectorAll('.inline-grid > span');
  if (!faces || faces.length === 0) return button?.textContent ?? undefined;
  const shown = [...faces].find(
    (face) => !face.classList.contains('invisible') && face.getAttribute('aria-hidden') !== 'true',
  );
  return shown?.textContent ?? undefined;
}

/**
 * A tab's checking, as the store's, publishing as the store does, with its jobs run in this
 * process and what they answer copied as a port copies it. Main refuses the overview's files
 * `refusals` times first, as it does before it knows the tab's account.
 */
function checkingFor(tab: PullTab, text = TEXT, refusals = 0): Checking {
  let refused = 0;
  return new Checking(tab.id, {
    files: async ({ paths }) => {
      if (refused < refusals) {
        refused += 1;
        throw new IpcError('moved', "That isn't the overview on screen, or the newer one.");
      }
      return paths.map((path) => {
        const bytes = path === 'artifact.md' ? text : SVG;
        return { kind: 'file' as const, size: bytes.length, bytes };
      });
    },
    code: async () => ({ kind: 'noGit' }),
    parse: async ({ artifact }) => structuredClone(parseOverview(artifact)),
    check: async (input) => structuredClone(await checkOverview(input)),
    publish: (value) => publish(tab.id, value),
    log: () => {},
  });
}

/** Lets what's waiting on the check or main settle, until `done` holds. */
async function until(done: () => boolean): Promise<void> {
  for (let round = 0; round < 200 && !done(); round++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  }
  expect(done()).toBe(true);
}

/**
 * The overview's view for `tab`, in a window of its own, with the overview's mark and its item in
 * the status bar beside it; on screen until `shown` says the reader showed another view.
 */
function render(tab: PullTab) {
  const container = document.createElement('div');
  container.className = 'lo-app';
  document.body.append(container);
  const root = createRoot(container);
  const draw = (shown: boolean) =>
    act(() =>
      root.render(
        <Slots views={[]}>
          <OverviewMark tab={tab} />
          <footer>
            <OverviewStatus tab={tab} />
          </footer>
          <OverviewView tab={tab} shown={shown} />
        </Slots>,
      ),
    );
  draw(true);
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  onTestFinished(() => {
    unmount();
    container.remove();
  });
  return Object.assign(container, { shown: draw, unmount });
}

/**
 * Whether the view draws the tab's placeholder and nothing of the overview. The placeholder says
 * nothing for its first moments, so it's told by its box, not its words.
 */
function waits(view: HTMLElement): boolean {
  return (
    view.querySelector('[data-lo-placeholder]') !== null &&
    view.querySelector('[data-lo-overview]') === null
  );
}

describe('as the tab opens', () => {
  it('draws the tab’s placeholder while it doesn’t know, then the overview once it shows', async () => {
    const tab = tabOf();
    const view = render(tab);
    expect(waits(view)).toBe(true);
    // The mark's room is kept while Lo finds out.
    expect(view.querySelector('.lo-ovmark--pending')).not.toBeNull();
    const checking = checkingFor(tab);
    act(() => states.set(tab.id, stateOf(tab)));
    checking.take(stateOf(tab));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    expect(openings.get(tab.id)).toMatchObject({ on: 'overview', late: false, seen: true });
    expect(showDiff).not.toHaveBeenCalled();
    expect(view.querySelector('.lo-ov-byline')?.textContent).toContain('ravi-k · 2 d ago');
    expect(view.querySelector('.lo-ovmark--pending')).toBeNull();
    expect(view.querySelector('.lo-ovmark[role="img"]')).not.toBeNull();
  });

  it('opens on the overview from its text alone, its figure and byline filling in after', async () => {
    const tab = tabOf();
    const view = render(tab);
    // Main has the text, and holds the figure back until let go.
    let letGo!: () => void;
    const held = new Promise<void>((resolve) => (letGo = resolve));
    const checking = new Checking(tab.id, {
      files: async ({ paths }) => {
        if (paths[0] !== 'artifact.md') await held;
        return paths.map((path) => {
          // Bytes of this window's own kind, which the check takes as a figure's.
          const bytes = Uint8Array.from(path === 'artifact.md' ? TEXT : SVG);
          return { kind: 'file' as const, size: bytes.length, bytes };
        });
      },
      code: async () => ({ kind: 'noGit' }),
      parse: async ({ artifact }) => structuredClone(parseOverview(artifact)),
      check: async (input) => structuredClone(await checkOverview(input)),
      publish: (value) => publish(tab.id, value),
      log: () => {},
    });
    const unread = stateOf(tab, { overview: { ...commitOf(), byline: null } });
    act(() => states.set(tab.id, unread));
    checking.take(unread);
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    expect(openings.get(tab.id)).toMatchObject({ on: 'overview', late: false });
    expect(view.querySelector('.lo-figure[aria-busy="true"]')?.textContent).toContain(
      'Reading figure 1…',
    );
    expect(view.querySelector('.lo-ov-byline')?.textContent).not.toContain('ravi-k');

    letGo();
    await until(() => view.querySelector('.lo-figure[aria-busy]') === null);
    expect(view.querySelector('.lo-figure--broken')).toBeNull();
    expect(view.querySelector('.lo-figure__frame svg:not(.lo-i)')).not.toBeNull();
    act(() => states.set(tab.id, stateOf(tab)));
    expect(view.querySelector('.lo-ov-byline')?.textContent).toContain('ravi-k · ');
  });

  it('opens on the overview once a check main refused at first goes through, within the bound', async () => {
    const tab = tabOf();
    const checking = checkingFor(tab, TEXT, 1);
    act(() => states.set(tab.id, stateOf(tab)));
    const view = render(tab);
    checking.take(stateOf(tab));
    await until(() => checked.get(tab.id)?.kind === 'failed');
    // Refused, it's not yet known whether it shows.
    expect(waits(view)).toBe(true);
    // Main speaks again, as it does once it knows the tab's account.
    act(() => states.set(tab.id, stateOf(tab, { saved: true })));
    checking.take(stateOf(tab, { saved: true }));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    expect(openings.get(tab.id)).toMatchObject({ on: 'overview', late: false });
    expect(showDiff).not.toHaveBeenCalled();
  });

  it('opens on the diff at the bound when a check keeps failing, says why, and only offers one that goes through later', async () => {
    vi.useFakeTimers();
    const tab = tabOf();
    const commit = commitOf();
    act(() => {
      states.set(tab.id, stateOf(tab, { overview: commit }));
      checked.set(tab.id, { kind: 'failed', key: 'k', commit, why: 'The port closed.' });
    });
    const view = render(tab);
    act(() => {
      vi.advanceTimersByTime(HOLD_LIMIT - 1);
    });
    expect(waits(view)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: true });
    expect(showDiff).toHaveBeenCalledTimes(1);
    expect(problemTitle(view, 'unchecked')).toBe('Can’t check the overview');
    expect(view.textContent).toContain('Check again');

    // The diff is on screen, and the check goes through.
    view.shown(false);
    vi.useRealTimers();
    checkingFor(tab).take(stateOf(tab, { overview: commit }));
    await until(() => checked.get(tab.id)?.kind === 'checked');
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff' });
    expect(showDiff).toHaveBeenCalledTimes(1);
    expect(view.querySelector('footer')?.textContent).toContain('Overview ready');
  });

  it('opens on the diff at the bound when it still doesn’t know, and never comes back', () => {
    vi.useFakeTimers();
    const tab = tabOf();
    const view = render(tab);
    act(() => {
      vi.advanceTimersByTime(HOLD_LIMIT - 1);
    });
    expect(openings.get(tab.id).on).toBeUndefined();
    expect(waits(view)).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: true });
    expect(showDiff).toHaveBeenCalledWith(tab.id);
    expect(view.querySelector('[data-lo-overview="reading"]')).not.toBeNull();
  });

  it('stays on the view the reader picks while it waits', () => {
    vi.useFakeTimers();
    const tab = tabOf();
    const view = render(tab);
    // The reader shows the diff, then the overview again.
    view.shown(false);
    view.shown(true);
    act(() => {
      vi.advanceTimersByTime(HOLD_LIMIT);
    });
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', chose: true });
    expect(showDiff).not.toHaveBeenCalled();
    expect(view.querySelector('[data-lo-overview="reading"]')).not.toBeNull();
  });

  it('waits for what Settings says, and opens on the diff it says', () => {
    vi.useFakeTimers();
    settings.open = undefined;
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    act(() => {
      vi.advanceTimersByTime(HOLD_LIMIT - 1);
    });
    expect(openings.get(tab.id).on).toBeUndefined();
    expect(waits(view)).toBe(true);
    settings.open = 'diff';
    view.shown(true);
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: false });
    expect(showDiff).toHaveBeenCalledWith(tab.id);
  });

  it('opens on the diff at once when there’s no overview', () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: true });
    expect(view.querySelector('[data-lo-overview="none"]')).not.toBeNull();
  });
});

describe('a run of a stack’s layers on screen as one diff', () => {
  it('says it has no overview, naming its layers, and leaves the tab to open on the diff', () => {
    // On screen, the run's view holds no stack: its tab in the strip does, and names the places.
    const tab: PullTab = { ...tabOf(), run: { layers: [6, 7], start: 'a'.repeat(40), from: 7 } };
    const view = render(tab);
    expect(view.querySelector('[data-lo-overview="run"] h2')?.textContent).toBe(
      'No overview for these layers',
    );
    expect(view.textContent).toContain('Each layer has its own.');
    expect(openings.get(tab.id).on).toBeUndefined();
  });
});

describe('the blocks a tab’s overview has', () => {
  it('are known by the commit it describes and the lines each names, once it’s checked', async () => {
    const tab = tabOf();
    const key = blockKey(HEAD, 'src/a.ts', 1, 2);
    expect(blockInOverview(tab.id, key)).toBe('unknown');
    const checking = checkingFor(tab);
    states.set(tab.id, stateOf(tab));
    checking.take(stateOf(tab));
    expect(blockInOverview(tab.id, key)).toBe('unknown');
    await until(() => checked.get(tab.id)?.kind === 'checked');
    expect(blockInOverview(tab.id, key)).toBe(true);
    // Another commit's block of the same lines, or other lines, aren't its.
    expect(blockInOverview(tab.id, blockKey('b'.repeat(40), 'src/a.ts', 1, 2))).toBe(false);
    expect(blockInOverview(tab.id, blockKey(HEAD, 'src/a.ts', 1, 3))).toBe(false);
    // With none, it has none.
    states.set(tab.id, stateOf(tab, { overview: null, found: 'none' }));
    expect(blockInOverview(tab.id, key)).toBe(false);
  });
});

describe('with no overview', () => {
  it('offers the prompt to write one, Copy prompt, and the skill while no agent has it', async () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    await until(() => buttonOf(view, 'Install overview skill') !== undefined);
    expect(view.querySelector('h2')?.textContent).toBe('No overview yet');
    expect(view.textContent).toContain('A coding agent writes one from this prompt.');
    expect(view.querySelector('pre')?.textContent).toContain(
      'https://github.com/rozed-dev/e2e/pull/7',
    );
    expect([...view.querySelectorAll('button')].map(faceOf)).toEqual([
      'Copy prompt',
      'Install overview skill',
    ]);
    act(() => buttonOf(view, 'Copy prompt')?.click());
    expect(copyPrompt).toHaveBeenCalledOnce();
  });

  it('says how a copy of its prompt went on Copy prompt, by its press or `ya`, and else in a toast', async () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    const copy = () => buttonOf(view, 'Copy prompt');
    onTestFinished(() => {
      withdraw('Copied prompt', '');
      withdraw('Couldn’t copy the prompt', '');
    });
    const before = toasts().length;
    await act(() => copyPromptOf(tab.id, 'The prompt'));
    expect(faceOf(copy())).toBe('Copied');
    expect(view.querySelector('[role="status"]')?.textContent).toBe('Copied');
    answers.copyFails = true;
    onTestFinished(() => {
      answers.copyFails = false;
    });
    await act(() => copyPromptOf(tab.id, 'The prompt'));
    expect(faceOf(copy())).toBe('Couldn’t copy');
    expect(toasts().length).toBe(before);
    // With no Copy prompt button drawn, as from another state, a toast says it.
    view.unmount();
    await act(() => copyPromptOf(tab.id, 'The prompt'));
    expect(toasts().at(-1)).toBe('Couldn’t copy the prompt');
    expect(notice()?.failed).toBe(true);
    answers.copyFails = false;
    await act(() => copyPromptOf(tab.id, 'The prompt'));
    expect(toasts().at(-1)).toBe('Copied prompt');
  });

  it('offers to look again where main reads the ref once, checking until main has', async () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null, watching: false })));
    const view = render(tab);
    await until(() => buttonOf(view, 'Check again') !== undefined);
    expect(buttonOf(view, 'Install overview skill')).toBeUndefined();
    const again = buttonOf(view, 'Check again');
    expect(faceOf(again)).toBe('Check again');
    act(() => readAgain(tab.id));
    expect(again?.getAttribute('aria-busy')).toBe('true');
    expect(faceOf(again)).toBe('Checking…');
    await until(() => bridge.calls.some(([channel]) => channel === 'overview.retry'));
    await act(async () => {
      answers.retried();
      await Promise.resolve();
    });
    await until(() => again?.getAttribute('aria-busy') === null);
    expect(faceOf(again)).toBe('Check again');
  });
});

describe('an overview that can’t be shown', () => {
  it('lists the findings by line, and copies a prompt that holds none of them', async () => {
    const tab = tabOf();
    const broken = encoder.encode(
      `---\nformat: 1\npr: 7\ncommit: ${HEAD}\n---\n\n## tl;dr\n\nIt reads.\n\n:::chart\n:::\n`,
    );
    const checking = checkingFor(tab, broken);
    const state = stateOf(tab, {
      overview: {
        ...commitOf(),
        entries: [{ path: 'artifact.md', kind: 'file', size: broken.length, id: 'b'.repeat(40) }],
      },
    });
    act(() => states.set(tab.id, state));
    const view = render(tab);
    checking.take(state);
    await until(() => view.querySelector('[data-lo-overview="invalid"]') !== null);
    expect(problemTitle(view, 'invalid')).toBe('Can’t show this overview');
    expect(view.textContent).toContain('It has 1 problem.');
    act(() => buttonOf(view, 'Details')?.click());
    const details = view.querySelector('.problem-details')?.textContent ?? '';
    expect(details).toMatch(/^ccccccc · ravi-k · 2 d ago\nLine 11 · .*chart/);
    const copy = buttonOf(view, 'Copy prompt');
    const before = bridge.calls.length;
    act(() => copy?.click());
    await until(() => bridge.calls.slice(before).some(([channel]) => channel === 'tab.copy'));
    const copied = bridge.calls.slice(before).find(([channel]) => channel === 'tab.copy')?.[1];
    expect(JSON.stringify(copied)).toContain('Fix the Lo overview for this pull request:');
    expect(JSON.stringify(copied)).not.toContain('chart');
    // It says so itself, at its own width, and no toast says it again.
    await until(() => faceOf(copy) === 'Copied');
    expect(notices().map((note) => note.title)).not.toContain('Copied prompt');
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff' });
  });

  it('says when an overview needs a newer Lo, with the way to get one', () => {
    const tab = tabOf();
    const commit = commitOf();
    act(() => {
      states.set(tab.id, stateOf(tab, { overview: commit }));
      checked.set(tab.id, {
        kind: 'checked',
        key: 'k',
        commit,
        parsed: undefined,
        checked: { outcome: { kind: 'newer', format: 3 }, findings: [] },
        figures: new Map(),
        coming: [],
        code: { kind: 'none' },
      });
    });
    const view = render(tab);
    expect(problemTitle(view, 'newer')).toBe('Can’t show this overview');
    expect(view.textContent).toContain('It needs a newer version of Lo.');
    act(() => buttonOf(view, 'Details')?.click());
    expect(view.querySelector('.problem-details')?.textContent).toContain(
      'Format 3. This version reads format 1.',
    );
  });

  it('runs a check for updates from its button, and opens no page itself', () => {
    const tab = tabOf();
    const commit = commitOf();
    act(() => {
      states.set(tab.id, stateOf(tab, { overview: commit }));
      checked.set(tab.id, {
        kind: 'checked',
        key: 'k',
        commit,
        parsed: undefined,
        checked: { outcome: { kind: 'newer', format: 3 }, findings: [] },
        figures: new Map(),
        coming: [],
        code: { kind: 'none' },
      });
    });
    const view = render(tab);
    const get = buttonOf(view, 'Check for updates');
    expect(checkUpdates).not.toHaveBeenCalled();
    act(() => get?.click());
    expect(checkUpdates).toHaveBeenCalledTimes(1);
    expect(bridge.calls.filter(([channel]) => channel === 'tab.openExternal')).toEqual([]);
  });

  it('says when it couldn’t be fetched and when it’s fetched again, with Try now, busy once pressed', async () => {
    const tab = tabOf();
    act(() =>
      states.set(
        tab.id,
        stateOf(tab, {
          found: 'unknown',
          overview: null,
          problem: { kind: 'offline', message: 'reset', retryAt: Date.now() + 8_000 },
        }),
      ),
    );
    const view = render(tab);
    expect(view.querySelector('[role="alert"] > p:first-child')?.textContent).toBe(
      'Can’t fetch the overview',
    );
    // The count is for the eye: a screen reader hears the wait as first drawn, spelled out, so the
    // alert isn't read each second.
    expect(view.querySelector('[role="alert"]')?.textContent).toMatch(
      /^Can’t fetch the overviewOffline\. Retrying in ([78]) sin \1 seconds\.$/,
    );
    const retry = buttonOf(view, 'Try now');
    expect(retry?.getAttribute('aria-busy')).toBeNull();
    act(() => retry?.click());
    await until(() => bridge.calls.some(([channel]) => channel === 'overview.retry'));
    expect(retry?.getAttribute('aria-busy')).toBe('true');
  });
});

/**
 * The overview's box, `top` pixels down the page, which a test moves as a banner over it comes or
 * goes, telling the box's resize observers as a browser would.
 */
function boxed() {
  const box = { top: 130 };
  /** The observers watching each element. */
  const watching = new Map<Element, Set<ResizeObserver>>();
  const told = new WeakMap<ResizeObserver, ResizeObserverCallback>();
  vi.stubGlobal(
    'ResizeObserver',
    class implements ResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        told.set(this, callback);
      }
      observe(element: Element) {
        watching.set(element, new Set([...(watching.get(element) ?? []), this]));
      }
      unobserve(element: Element) {
        watching.get(element)?.delete(this);
      }
      disconnect() {
        for (const observers of watching.values()) observers.delete(this);
      }
    },
  );
  const layout = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: Element,
  ) {
    return this.classList.contains('lo-ov') ? new DOMRect(0, box.top, 600, 400) : new DOMRect();
  });
  onTestFinished(() => {
    layout.mockRestore();
    vi.unstubAllGlobals();
  });
  return {
    /** The box moves to `top`, as a banner over it comes or goes. */
    move(top: number) {
      box.top = top;
      for (const [element, observers] of watching) {
        if (!element.classList.contains('lo-ov')) continue;
        for (const observer of observers) act(() => told.get(observer)?.([], observer));
      }
    },
  };
}

describe('its place on the page', () => {
  it('is where it’s first seen: drawn behind another view, a banner that goes meanwhile leaves no room above it', async () => {
    const page = boxed();
    const tab = tabOf();
    const checking = checkingFor(tab);
    act(() => states.set(tab.id, stateOf(tab)));
    const view = render(tab);
    // The reader shows another view before the overview has drawn.
    view.shown(false);
    checking.take(stateOf(tab));
    await until(() => view.querySelector('.lo-ov') !== null);
    await until(() => view.querySelector('.lo-ov.is-drawing') === null);
    // The banner over it goes while it's behind the other view.
    page.move(100);
    // Shown, the frame that shows it tells of the box as it is.
    view.shown(true);
    page.move(100);
    const box = view.querySelector<HTMLElement>('.lo-ov')!;
    expect(box.style.paddingTop).toBe('');
    // Seen, it stays where it is as the next banner goes.
    page.move(130);
    page.move(100);
    expect(box.style.paddingTop).toBe('30px');
  });
});

describe('an overview on screen', () => {
  it('keeps every node, its folds open and focus where it was, when it’s checked again or copied', async () => {
    const tab = tabOf();
    const checking = checkingFor(tab);
    // The local copy couldn't be fetched: each code block says so in its code's place.
    act(() => states.set(tab.id, stateOf(tab, { code: 'failed' })));
    const view = render(tab);
    checking.take(stateOf(tab, { code: 'failed' }));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    // Seen once its blocks have drawn, or at the bound: the tab's placeholder goes.
    await until(() => view.querySelector('.lo-ov.is-drawing') === null);
    const first = checked.get(tab.id);

    // The reader opens the fold, and puts focus on a term in the lead.
    const fold = view.querySelector('details');
    const term = view.querySelector<HTMLElement>('.lo-term');
    if (!fold || !term) throw new Error('no fold or term');
    act(() => {
      fold.open = true;
      term.focus();
    });
    const nodes = [...view.querySelectorAll('*')];

    // Git turns out to be missing, so it's checked again, and finds the same.
    checking.take(stateOf(tab, { code: 'noGit' }));
    await until(() => checked.get(tab.id) !== first);
    // The same result, copied as a port copies it, comes again.
    act(() => publish(tab.id, structuredClone(checked.get(tab.id))));

    const after = [...view.querySelectorAll('*')];
    expect(after.length).toBe(nodes.length);
    expect(after.every((node, index) => node === nodes[index])).toBe(true);
    expect(view.querySelector('details')).toBe(fold);
    expect(fold.open).toBe(true);
    expect(document.activeElement).toBe(term);
  });

  it.each([
    [
      'rozed-bot wrote this overview just now · written for r2 · from fork',
      'rozed-bot wrote this ov…',
    ],
    ['” · written for r2', 'written for r2'],
    ['\u202Erozed-bot\u202C', 'rozed-bot'],
    ['👩‍👩‍👧‍👦'.repeat(30), `${'👩‍👩‍👧‍👦'.repeat(23)}…`],
  ])(
    'draws the name a commit gives its author quoted, plain and on its own: %s',
    async (name, drawn) => {
      const tab = tabOf();
      const commit = { ...commitOf(), byline: { login: null, name, at: Date.now() - 60_000 } };
      const checking = checkingFor(tab);
      act(() => states.set(tab.id, stateOf(tab, { overview: commit })));
      const view = render(tab);
      checking.take(stateOf(tab, { overview: commit }));
      await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
      const byline = view.querySelector<HTMLElement>('[data-lo-byline]');
      if (!byline) throw new Error('no byline');
      expect(byline.textContent).toMatch(new RegExp(`^“${drawn}” · 1 min ago·written for`));
      // Nothing in it closes Lo's quotes, or sets a part apart as the byline does, and it's cut
      // short.
      expect(byline.querySelector('[data-lo-commit-name]')?.textContent).toBe(`“${drawn}”`);
      expect(byline.querySelector('.lo-ov-name__text')?.textContent).toBe(drawn);
      // Not drawn as a login: no avatar of its initials, and nothing in bold.
      expect(byline.querySelector('.lo-ov-byline__figure')).not.toBeNull();
      expect(
        [...byline.querySelectorAll('strong')].some((each) =>
          /rozed|written/.test(each.textContent ?? ''),
        ),
      ).toBe(false);
    },
  );

  it('offers a newer overview, pushed while it’s on screen, in its byline', async () => {
    const tab = tabOf();
    const checking = checkingFor(tab);
    act(() => states.set(tab.id, stateOf(tab)));
    const view = render(tab);
    checking.take(stateOf(tab));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    const article = view.querySelector('.lo-ov__article');
    act(() => states.set(tab.id, stateOf(tab, { newer: { ...commitOf(), id: 'f'.repeat(40) } })));
    expect(view.querySelector('.lo-ov-byline')?.textContent).toContain(
      'Overview updated·Show latest',
    );
    // Offered, never put in place of the one on screen.
    expect(view.querySelector('.lo-ov__article')).toBe(article);
  });
});
