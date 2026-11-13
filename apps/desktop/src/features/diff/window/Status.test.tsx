// @vitest-environment jsdom
// What the status bar says of the diff on screen when GitHub couldn't compare a layer, or a run of
// them, with where it starts: read from the files drawn, as the bar over a run reads them.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeAll, describe, expect, it, onTestFinished, vi } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';
import type { DiffState } from '../contract.ts';
import type { Snapshot } from './loader.ts';
import { DiffStatus } from './Status.tsx';

/** What the loader the status reads says now. */
const loader = vi.hoisted(() => ({ snapshot: undefined as Snapshot | undefined }));

vi.mock('./tabs.ts', () => ({
  loaderOf: () => ({
    snapshot: () => loader.snapshot,
    subscribe: () => () => undefined,
  }),
}));

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true);
});

const START = 'a'.repeat(40);

const STATE: DiffState = {
  id: 't1:83-84',
  at: 'b'.repeat(40),
  comparison: null,
  compareFrom: START,
  since: null,
  waiting: null,
  from: 'github',
  start: null,
  files: [],
  partial: false,
  uncompared: true,
  problem: null,
};

/** The snapshot with GitHub's files drawn, which GitHub couldn't compare with the start. */
function snapshotOf(
  from: 'github' | 'local',
  state: Partial<DiffState> = {},
  drawn = true,
): Snapshot {
  return {
    state: { ...STATE, from, ...state },
    ready: drawn
      ? {
          at: STATE.at ?? '',
          comparison: null,
          compareFrom: START,
          from,
          entries: [],
          partial: false,
          // As the loader says it: GitHub's files only.
          uncompared: from === 'github',
        }
      : undefined,
    progress: { done: 0, of: 0 },
    whitespace: true,
  };
}

const RUN: PullTab = {
  id: 't1:83-84',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 84,
  run: { layers: [83, 84], start: START, from: 83 },
};
const LAYER: PullTab = { id: 't1:84', kind: 'pull', owner: 'rozed-dev', repo: 'e2e', number: 84 };

/** The status's items, as their text and the hint each carries. */
function itemsOf(tab: PullTab, snapshot: Snapshot): { text: string; title: string | null }[] {
  loader.snapshot = snapshot;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<DiffStatus tab={tab} />));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return [...host.querySelectorAll('[title]')].map((each) => ({
    text: each.textContent ?? '',
    title: each.getAttribute('title'),
  }));
}

describe('the status bar over a run GitHub couldn’t compare', () => {
  it('says the run wasn’t compared, and what shows, while GitHub’s files are drawn', () => {
    const items = itemsOf(RUN, snapshotOf('github'));
    expect(items.map((item) => item.text)).toEqual(['GitHub’s diff', 'Run not compared']);
    expect(items[1]?.title).toBe(
      'GitHub couldn’t compare the run from where its bottom layer starts, so this is #84’s pull request as GitHub lists it until the local copy is ready.',
    );
  });

  it('says nothing of it once the local copy’s files are drawn, though main still says it', () => {
    // Main keeps `uncompared` once the local copy's files replace GitHub's.
    expect(itemsOf(RUN, snapshotOf('local')).map((item) => item.text)).toEqual([]);
  });

  it('says nothing of it before any files are drawn, which is what the bar over the run reads too', () => {
    expect(itemsOf(RUN, snapshotOf('github', {}, false)).map((item) => item.text)).toEqual([]);
  });

  it('says a layer’s diff includes the layers below, for a layer rather than a run', () => {
    const items = itemsOf(LAYER, snapshotOf('github'));
    expect(items.map((item) => item.text)).toEqual(['GitHub’s diff', 'Layers below included']);
  });
});
