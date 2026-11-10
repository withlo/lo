import { expect, test } from 'vitest';

import type { Thread } from '../threads.ts';
import { DEFAULT_PANEL_FILTER, panel, type PanelFilter } from './panel.ts';

function thread(id: string, resolved: boolean, authors: (string | undefined)[]): Thread {
  return {
    id,
    path: '',
    subject: 'LINE',
    side: 'RIGHT',
    startSide: undefined,
    line: undefined,
    startLine: undefined,
    originalLine: undefined,
    originalStartLine: undefined,
    outdated: false,
    resolved,
    currentOn: undefined,
    writtenOn: undefined,
    comments: authors.map((author) => ({
      id: 'PRRC_1',
      author,
      body: 'Why?',
      state: 'SUBMITTED',
      createdAt: '1970-01-01T00:00:00Z',
      url: 'https://github.com/octo/repo/pull/1#discussion_r1',
      hidden: undefined,
      viewerCanUpdate: false,
      viewerCanDelete: false,
    })),
    viewerCanReply: false,
    viewerCanResolve: false,
    viewerCanUnresolve: false,
  };
}

const THREADS = [
  thread('started', false, ['alice', 'bob']),
  thread('replied', true, ['bob', 'Alice']),
  thread('others', false, ['bob', undefined]),
  thread('resolved', true, ['carol']),
];

function listed(filter: PanelFilter): string[] {
  return panel(THREADS, filter, 'alice').map((shown) => shown.id);
}

test('it lists unresolved threads by default', () => {
  expect(listed(DEFAULT_PANEL_FILTER)).toEqual(['started', 'others']);
});

test('it can list every thread', () => {
  expect(listed('all')).toEqual(['started', 'replied', 'others', 'resolved']);
});

test('yours are threads you started or replied in', () => {
  // Logins ignore case, as GitHub's do.
  expect(listed('yours')).toEqual(['started', 'replied']);
});
