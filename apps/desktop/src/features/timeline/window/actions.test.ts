// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import type { PullTab } from '../../tab/window/shared.ts';
import { revealHidden, stillHidden } from './actions.ts';
import type { Row } from './rows.ts';
import { focusedRows } from './store.ts';

const TAB: PullTab = { kind: 'pull', id: 't1', owner: 'rozed-dev', repo: 'e2e', number: 23 };

const HIDDEN: Row = {
  kind: 'comment',
  key: 'c1',
  id: 'IC_1',
  author: { login: 'mona', type: 'User' },
  at: '2026-11-06T12:00:00Z',
  body: 'Spam',
  url: 'https://github.com/rozed-dev/e2e/pull/23#issuecomment-1',
  byAuthor: false,
  hidden: 'spam',
  canUpdate: false,
  canDelete: false,
};

describe('revealHidden', () => {
  it('gives focus back to the list as the pressed "Show comment" goes', () => {
    const list = document.createElement('ol');
    list.tabIndex = 0;
    const row = document.createElement('li');
    row.dataset['key'] = HIDDEN.key;
    const button = document.createElement('button');
    row.append(button);
    list.append(row);
    document.body.append(list);
    button.focus();

    revealHidden({ tab: TAB, rows: [HIDDEN], list: () => list }, HIDDEN.key);
    // The comment shows, so its button goes.
    button.remove();

    expect(stillHidden(TAB.id, HIDDEN)).toBe(false);
    expect(document.activeElement).toBe(list);
    expect(focusedRows.get(TAB.id)).toBe(HIDDEN.key);
    list.remove();
  });
});
