// @vitest-environment jsdom
// The overview's view in a window of its own, with main answered by a stand-in bridge and the
// overview checked as the window checks it, in this process: what it draws while the tab opens and
// after, each state, and that a result checked again, or copied, leaves every node on screen as it
// was, its folds open and its focus where it was.

import { commandsOf } from '@lo/ui/commands';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import { createRegistry } from '../../../window/commands/registry.ts';
import { Slots } from '../../../window/slots.tsx';
import { installBridge } from '../../../window/test/bridge.ts';
import { HOLD_LIMIT } from '../../revisions/contract.ts';
import tabKeys from '../../tab/keys.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { OverviewCommit, OverviewState, SkillState } from '../contract.ts';
import keys from '../keys.ts';
import { checkOverview, parseOverview } from '../background/index.ts';
import settingsKeys from '../../settings/keys.ts';
import { Checking } from './checking.ts';
import { openings } from './opening.ts';
import { OverviewView } from './Overview.tsx';
import { checked, publish, states } from './store.ts';

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

const bridge = installBridge({
  'tab.copy': () => undefined,
  'overview.currentSkill': () => SKILL,
  'overview.retry': () => undefined,
});

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
  createRegistry([...commandsOf(tabKeys), ...commandsOf(keys), ...commandsOf(settingsKeys)], 'mac');
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A tab's checking, as the store's, publishing as the store does, with its jobs run in this
 * process and what they answer copied as a port copies it.
 */
function checkingFor(tab: PullTab, text = TEXT): Checking {
  return new Checking(tab.id, {
    files: async ({ paths }) =>
      paths.map((path) => {
        const bytes = path === 'artifact.md' ? text : SVG;
        return { kind: 'file' as const, size: bytes.length, bytes };
      }),
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

/** The overview's view for `tab`, on screen, in a window of its own. */
function render(tab: PullTab) {
  const container = document.createElement('div');
  container.className = 'lo-app';
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <Slots views={[]}>
        <OverviewView tab={tab} shown />
      </Slots>,
    ),
  );
  onTestFinished(() => {
    act(() => root.unmount());
    container.remove();
  });
  return container;
}

describe('as the tab opens', () => {
  it('draws the tab’s placeholder while it doesn’t know, then the overview once it shows', async () => {
    const tab = tabOf();
    const view = render(tab);
    expect(view.textContent).toBe('Opening the pull request…');
    const checking = checkingFor(tab);
    act(() => states.set(tab.id, stateOf(tab)));
    checking.take(stateOf(tab));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
    expect(openings.get(tab.id)).toMatchObject({ on: 'overview', late: false, seen: true });
    expect(view.querySelector('.lo-ov-byline')?.textContent).toContain(
      'ravi-k wrote this overview 2 days ago',
    );
  });

  it('opens on the diff at the bound when it still doesn’t know, and never comes back', () => {
    vi.useFakeTimers();
    const tab = tabOf();
    const view = render(tab);
    act(() => {
      vi.advanceTimersByTime(HOLD_LIMIT - 1);
    });
    expect(openings.get(tab.id).on).toBeUndefined();
    expect(view.textContent).toBe('Opening the pull request…');
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: true });
    expect(view.querySelector('[data-lo-overview="reading"]')).not.toBeNull();
  });

  it('opens on the diff at once when there’s no overview', () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    expect(openings.get(tab.id)).toMatchObject({ on: 'diff', late: true });
    expect(view.querySelector('[data-lo-overview="none"]')).not.toBeNull();
  });
});

describe('with no overview', () => {
  it('offers the prompt to write one, the skill for each agent and the way to the diff', async () => {
    const tab = tabOf();
    act(() => states.set(tab.id, stateOf(tab, { found: 'none', overview: null })));
    const view = render(tab);
    await until(() => (view.textContent ?? '').includes('Claude Code'));
    expect(view.querySelector('h2')?.textContent).toBe('No overview yet');
    expect(view.querySelector('pre')?.textContent).toContain(
      'https://github.com/rozed-dev/e2e/pull/7',
    );
    expect(view.textContent).toContain('It shows here as soon as it lands.');
    expect(view.textContent).toContain("Codex isn't set up here: Lo found no ~/.codex.");
    expect(view.textContent).toContain('Go to the diff');
    expect(view.textContent).toContain('Open on the overview or the diff');
    const copy = [...view.querySelectorAll('button')].find((each) =>
      each.textContent?.startsWith('Copy'),
    );
    act(() => copy?.click());
    await until(() => bridge.calls.some(([channel]) => channel === 'tab.copy'));
    expect(bridge.calls.find(([channel]) => channel === 'tab.copy')?.[1]).toEqual({
      text: view.querySelector('pre')?.textContent,
    });
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
    expect(view.querySelector('h2')?.textContent).toBe('This overview can’t be read');
    const rows = [...view.querySelectorAll('.lo-ovstate__report li')].map((each) =>
      [...each.children].map((cell) => cell.textContent),
    );
    expect(rows[0]?.[0]).toBe('line 11');
    expect(rows[0]?.[1]).toContain('chart');
    const copy = [...view.querySelectorAll('button')].find((each) =>
      each.textContent?.startsWith('Copy a prompt to fix it'),
    );
    const before = bridge.calls.length;
    act(() => copy?.click());
    await until(() => bridge.calls.slice(before).some(([channel]) => channel === 'tab.copy'));
    const copied = bridge.calls.slice(before).find(([channel]) => channel === 'tab.copy')?.[1];
    expect(JSON.stringify(copied)).toContain('Fix the Lo overview for this pull request:');
    expect(JSON.stringify(copied)).not.toContain('chart');
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
        code: { kind: 'none' },
      });
    });
    const view = render(tab);
    expect(view.querySelector('h2')?.textContent).toBe('This overview needs a newer Lo');
    expect(view.textContent).toContain("It's written in format 3, and this Lo reads format 1.");
    expect(view.textContent).toContain('Get a newer Lo');
  });

  it('says when it couldn’t be read and when Lo tries again, with Retry now', async () => {
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
    expect(view.querySelector('h2')?.textContent).toBe('Couldn’t fetch the overview');
    expect(view.textContent).toMatch(/Trying again in [78] s\./);
    const retry = [...view.querySelectorAll('button')].find(
      (each) => each.textContent === 'Retry now',
    );
    act(() => retry?.click());
    await until(() => bridge.calls.some(([channel]) => channel === 'overview.retry'));
  });
});

describe('an overview on screen', () => {
  it('keeps every node, its folds open and focus where it was, when it’s checked again or copied', async () => {
    const tab = tabOf();
    const checking = checkingFor(tab);
    act(() => states.set(tab.id, stateOf(tab)));
    const view = render(tab);
    checking.take(stateOf(tab));
    await until(() => view.querySelector('[data-lo-overview="shown"]') !== null);
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
      'A newer overview was pushed·Load it',
    );
    // Offered, never put in place of the one on screen.
    expect(view.querySelector('.lo-ov__article')).toBe(article);
  });
});
