// @vitest-environment jsdom
// The overview's markers in the diff: on the lines it points at as written, at the commit it
// describes; mapped to the head on screen once each file is worked out there, with none on lines
// that changed or went, nor on a file that's gone; none at any other commit, nor for a reference
// that doesn't resolve; the diff told as they change; and "Read it in the overview" showing the
// overview at the note's block, only for the overview the tab has now.

import { checkArtifact, parseArtifact } from '@lo/artifact';
import { diffText } from '@lo/diff';
import { generationOf } from '@lo/ui/markdown';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installBridge } from '../../../window/test/bridge.ts';
import type { Explainer } from '../../diff/window/shared.ts';
import type { PullView } from '../../tab/contract.ts';
import type { FileSinceText, OverviewCommit, OverviewState } from '../contract.ts';
import { treeEntries } from '../jobs.ts';
import type { CheckedOverview } from './checking.ts';
import { OVERVIEW_VIEW } from './labels.ts';

const R1 = '1'.repeat(40);
const R2 = '2'.repeat(40);
const R3 = '3'.repeat(40);

/** What the diff and the tab were told, and the tab's head and overview, as the test sets them. */
const fake = vi.hoisted(() => {
  /** Who's told as the overview, or what its check found, changes. */
  const listeners = new Set<() => void>();
  return {
    explainer: undefined as Explainer | undefined,
    changed: [] as string[],
    shown: [] as [string, string][],
    pull: undefined as PullView | undefined,
    state: undefined as OverviewState | undefined,
    result: undefined as CheckedOverview | undefined,
    listeners,
    /** A store that reads `get`, and tells `listeners` when the test says it changed. */
    watched: <T>(get: () => T) => ({
      get,
      set() {},
      update() {},
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    }),
  };
});

vi.mock(import('../../diff/window/shared.ts'), async (original) => ({
  ...(await original()),
  setExplainer: (given) => {
    fake.explainer = given;
    return () => {};
  },
  explainedChanged: (tab) => {
    fake.changed.push(tab);
  },
  diffTexts: (files) =>
    Promise.resolve(
      files.map((file) => ({
        ok: true as const,
        diff: diffText(file.old ?? undefined, file.new ?? undefined, { whitespace: true }),
        tokens: {},
        changes: { deleted: [], added: [] },
      })),
    ),
}));

vi.mock(import('../../tab/window/shared.ts'), async (original) => ({
  ...(await original()),
  pullOf: () => fake.pull,
  showMiddle: (tab, id) => {
    fake.shown.push([tab, id]);
    return true;
  },
  localCopyOf: () => undefined,
  onLocalCopy: () => () => {},
}));

vi.mock(import('./store.ts'), async (original) => ({
  ...(await original()),
  states: fake.watched(() => fake.state),
  checked: fake.watched(() => fake.result),
}));

const { followMarkers } = await import('./markers.ts');
const { reveals } = await import('./follow.ts');

/** What main answers for each file since the overview's commit, by its path there. */
const files = new Map<string, FileSinceText>();

installBridge({
  'overview.sinceFile': (input) => {
    const path = String(Reflect.get(Object(input), 'path'));
    const found = files.get(path);
    if (!found) throw new Error(`No file at ${path}.`);
    return found;
  },
});

/** `src/a.ts` at the overview's commit, and at the head, renamed `src/b.ts`. */
const OLD = 'a\nb\nc\nd\n';
const NOW = 'added\na\nb\nC\nd\n';

const BODY = `
## tl;dr

It splits.

## How it works

The parser splits [line two](code:src/a.ts#L2) apart:

:::code src/a.ts#L1-L4
:::

:::code src/gone.ts#L1-L2
:::
`;

const SAID = 'The parser splits line two apart:';

let tab = 't0';
let tabs = 0;

beforeAll(() => {
  followMarkers();
});

beforeEach(() => {
  tabs += 1;
  tab = `t${tabs}`;
  fake.changed.length = 0;
  fake.shown.length = 0;
  files.clear();
  files.set('src/a.ts', {
    kind: 'changed',
    path: 'src/b.ts',
    pushed: true,
    texts: { old: OLD, new: NOW },
  });
});

/** Tab `tab`'s head on screen. */
function at(head: string): void {
  fake.pull = {
    id: tab,
    loading: false,
    acting: null,
    header: null,
    connection: { kind: 'live' },
    problem: null,
    shown: head,
    newer: null,
  };
}

/** Tab `tab`'s overview, written for `commit`, as the window checked it: `src/gone.ts` isn't there. */
async function shown(commit: string): Promise<number> {
  const text = new TextEncoder().encode(`---\nformat: 1\npr: 80\ncommit: ${commit}\n---\n${BODY}`);
  const overview: OverviewCommit = {
    id: 'c'.repeat(40),
    source: 'base',
    repository: { owner: 'o', name: 'r' },
    byline: { login: 'o', name: 'O', at: 0 },
    entries: [{ path: 'artifact.md', kind: 'file', size: text.length, id: 'b'.repeat(40) }],
    truncated: false,
    read: true,
  };
  const parsed = parseArtifact(text);
  const code = new TextEncoder().encode(OLD);
  const checked = await checkArtifact(
    parsed,
    { entries: treeEntries(overview.entries), read: async () => ({ kind: 'missing' }) },
    async (_commit, path) =>
      path === 'src/a.ts' ? { kind: 'file', size: code.length, bytes: code } : { kind: 'missing' },
    { pr: 80 },
  );
  fake.state = {
    id: tab,
    ref: 'refs/lo/pr/80',
    watching: true,
    found: 'commit',
    overview,
    newer: null,
    saved: false,
    problem: null,
    code: 'ready',
  };
  fake.result = {
    kind: 'checked',
    key: 'k',
    commit: overview,
    parsed,
    checked,
    figures: new Map(),
    code: { kind: 'none' },
  };
  for (const listener of fake.listeners) listener();
  return generationOf(parsed.tree);
}

/** What the diff marks in tab `tab` at `head`. */
const linesAt = (head: string) => fake.explainer?.linesAt(tab, head);

/** Lets what's under way settle. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('the overview’s markers', () => {
  it('mark its lines as written at the commit it describes, and none at another', async () => {
    const tree = await shown(R1);
    at(R1);
    const note = { label: 'How it works', text: SAID };
    expect(linesAt(R1)).toEqual([
      { path: 'src/a.ts', from: 2, to: 2, block: `${tree}.3`, note },
      // A reference that doesn't resolve marks nothing.
      { path: 'src/a.ts', from: 1, to: 4, block: `${tree}.4`, note },
    ]);
    // As when the diff compares other revisions.
    expect(linesAt(R3)).toEqual([]);
  });

  it('mark the head on screen once each file is worked out, leaving out lines changed since', async () => {
    const tree = await shown(R1);
    at(R2);
    // Nothing until Lo has worked out how the file changed, and the diff is told once it has.
    expect(linesAt(R2)).toEqual([]);
    await settled();
    expect(fake.changed).toContain(tab);
    const note = { label: 'How it works', text: SAID };
    // Line 3 changed, and a line was added at the top: the file is src/b.ts now.
    expect(linesAt(R2)).toEqual([
      { path: 'src/b.ts', from: 3, to: 3, block: `${tree}.3`, note },
      { path: 'src/b.ts', from: 2, to: 3, block: `${tree}.4`, note },
      { path: 'src/b.ts', from: 5, to: 5, block: `${tree}.4`, note },
    ]);
    // Not on the overview's own commit, which the diff doesn't show then.
    expect(linesAt(R1)).toHaveLength(2);
  });

  it('mark nothing of a file gone since', async () => {
    files.set('src/a.ts', { kind: 'deleted' });
    await shown(R1);
    at(R2);
    linesAt(R2);
    await settled();
    expect(linesAt(R2)).toEqual([]);
  });

  it('tell the diff when the overview changes, and mark nothing without one shown', async () => {
    await shown(R1);
    at(R1);
    linesAt(R1);
    fake.changed.length = 0;
    fake.result = undefined;
    for (const listener of fake.listeners) listener();
    // The test's tabs share one overview: each diff that asked is told.
    expect(fake.changed).toContain(tab);
    expect(linesAt(R1)).toEqual([]);
  });

  it('show the overview at the note’s block when it asks, only for the overview the tab has now', async () => {
    const tree = await shown(R1);
    at(R1);
    expect(fake.explainer?.read(tab, `${tree}.4`)).toBe(true);
    expect(fake.shown).toEqual([[tab, OVERVIEW_VIEW]]);
    expect(reveals.get(tab)?.block).toBe(4);
    // A note from an overview the tab had before.
    expect(fake.explainer?.read(tab, `${tree + 1000}.4`)).toBe(false);
    expect(fake.explainer?.read(tab, 'block')).toBe(false);
    expect(fake.shown).toHaveLength(1);
  });
});
