// @vitest-environment jsdom
// The threads panel's keys with nothing listed: why Next and Previous can't move, there being no
// threads or a filter that matches none, and Clear filter, which lists every thread again and
// keeps focus in the list as its button goes.

import { afterEach, expect, test, vi } from 'vitest';

import type * as TabShared from '../../tab/window/shared.ts';
import type { PullTab } from '../../tab/window/shared.ts';
import type { ThreadRow, ThreadsView } from '../contract.ts';
import { canClearFilter, clearFilter, filterStore, rowsListed, setFilter } from './panel.ts';
import { listed } from './threads.ts';

const TAB: PullTab = {
  id: 'view-filter',
  kind: 'pull',
  owner: 'rozed-dev',
  repo: 'e2e',
  number: 94,
};

/** The tab on screen: none until a test shows one. */
const screen = vi.hoisted(() => ({ tab: undefined as unknown }));
vi.mock('../../tab/window/shared.ts', async (original) => ({
  ...(await original<typeof TabShared>()),
  activeTab: () => screen.tab,
}));

/** A thread of the pull request's, resolved or not. */
function row(resolved: boolean): ThreadRow {
  return {
    id: 'T1',
    path: 'src/retry.ts',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: null,
    line: 4,
    startLine: null,
    originalLine: 4,
    originalStartLine: null,
    outdated: false,
    resolved,
    currentOn: null,
    writtenOn: null,
    comments: [],
    viewerCanReply: true,
    viewerCanResolve: true,
    viewerCanUnresolve: true,
  };
}

/** The panel lists `rows`, read. */
function list(...rows: ThreadRow[]): void {
  const threads: ThreadsView = {
    id: TAB.id,
    status: 'ready',
    threads: rows,
    missing: 0,
    compared: null,
    problem: null,
  };
  listed.set(TAB.id, threads);
}

afterEach(() => {
  screen.tab = undefined;
  listed.set(TAB.id, undefined);
  setFilter('unresolved');
  document.body.replaceChildren();
});

test('Next and Previous say there are no threads yet, or that the filter matches none', () => {
  expect(rowsListed()).toBe('Open a pull request first');
  screen.tab = TAB;
  expect(rowsListed()).toBe('No threads yet');
  list();
  expect(rowsListed()).toBe('No threads yet');
  list(row(true));
  expect(rowsListed()).toBe('No matches');
  setFilter('all');
  expect(rowsListed()).toBe(true);
});

test('Clear filter lists every thread, and keeps focus in the list as its button goes', () => {
  screen.tab = TAB;
  list(row(true));
  expect(canClearFilter()).toBe(true);
  const panel = document.createElement('div');
  panel.dataset['loScope'] = 'threads';
  panel.tabIndex = -1;
  const button = document.createElement('button');
  panel.append(button);
  document.body.append(panel);
  button.focus();
  clearFilter();
  expect(filterStore.getState().filter).toBe('all');
  // The empty state goes with its button, once the panel draws what it lists now.
  button.remove();
  expect(document.activeElement).toBe(panel);
  expect(canClearFilter()).toBe('No filter to clear');
});
