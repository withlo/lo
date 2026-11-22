// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, onTestFinished, test } from 'vitest';

import { testCommands, type Ran } from '../test/commands.ts';
import { holdRegistry } from './commands/control.ts';
import { Registry } from './commands/registry.ts';
import type { LineTarget } from './commands/targets.ts';
import { EmptyState } from './EmptyState.tsx';
import { TooltipGroup } from './Tooltip.tsx';

const LINE: LineTarget = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 3 } };

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
});

function draw(node: ReactNode): HTMLElement {
  const host = document.createElement('div');
  host.className = 'lo-app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<TooltipGroup>{node}</TooltipGroup>));
  onTestFinished(() => {
    act(() => root.unmount());
    host.remove();
  });
  return host;
}

function held(): Ran[] {
  const ran: Ran[] = [];
  release = holdRegistry(new Registry({ system: 'mac', commands: testCommands(ran) }));
  return ran;
}

test('an empty state is a heading, one line and its commands as buttons with their keys', () => {
  const ran = held();
  const host = draw(
    <EmptyState
      title="No comments yet"
      line="Comments on this line are listed here."
      actions={[{ command: 'diff.comment', target: LINE, label: 'Add comment' }]}
    />,
  );
  expect(host.querySelector('h2')?.textContent).toBe('No comments yet');
  expect(host.querySelector('p')?.textContent).toBe('Comments on this line are listed here.');
  const button = host.querySelector('button')!;
  expect(button.textContent).toBe('Add commentc');
  expect(button.getAttribute('aria-keyshortcuts')).toBe('c');
  act(() => button.click());
  expect(ran).toEqual([['diff.comment', LINE]]);
});

test('a button whose command can’t run is dimmed, says why, and runs nothing', () => {
  const ran = held();
  const host = draw(<EmptyState title="No comments yet" actions={['diff.comment']} />);
  expect(host.querySelector('p')).toBeNull();
  const button = host.querySelector('button')!;
  // With no label of its own, it takes the command's.
  expect(button.textContent).toBe('Commentc');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
    "Comment doesn't apply here.",
  );
  act(() => button.click());
  expect(ran).toEqual([]);
});

test('with no commands, or one the registry doesn’t have, it draws no button', () => {
  held();
  expect(draw(<EmptyState title="No matches" />).querySelector('button')).toBeNull();
  expect(
    draw(<EmptyState title="No matches" actions={['diff.nothing']} />).querySelector('button'),
  ).toBeNull();
});

test('what its actions act on sits between its line and its buttons', () => {
  held();
  const host = draw(
    <EmptyState title="No overview yet" line="One line." actions={['diff.comment']}>
      <pre>The prompt</pre>
    </EmptyState>,
  );
  const order = [...host.querySelectorAll('p, pre, button')].map((element) => element.localName);
  expect(order).toEqual(['p', 'pre', 'button']);
});

test('a button busy with what it started says what it’s doing, and runs nothing more', () => {
  const ran = held();
  const action = { command: 'diff.comment', target: LINE, label: 'Check again' } as const;
  const resting = draw(
    <EmptyState
      title="No overview yet"
      actions={[{ ...action, busy: false, working: 'Checking…' }]}
    />,
  ).querySelector('button')!;
  expect(resting.getAttribute('aria-busy')).toBeNull();
  // Both faces are drawn, one hidden, so it's as wide busy as at rest.
  expect(resting.textContent).toBe('Check againcChecking…');
  const busy = draw(
    <EmptyState
      title="No overview yet"
      actions={[{ ...action, busy: true, working: 'Checking…' }]}
    />,
  ).querySelector('button')!;
  expect(busy.getAttribute('aria-busy')).toBe('true');
  act(() => busy.click());
  expect(ran).toEqual([]);
});

/** The face `host`'s button shows, and what its live region says. */
function said(host: HTMLElement) {
  return {
    shown: [...host.querySelectorAll('button .inline-grid > span')]
      .filter((face) => !face.classList.contains('invisible'))
      .map((face) => face.textContent),
    heard: host.querySelector('[role="status"]')?.textContent,
  };
}

test('a button that copies reads what its last copy came to, as wide as its label', () => {
  held();
  const action = { command: 'diff.comment', target: LINE, label: 'Copy prompt' } as const;
  expect(
    said(draw(<EmptyState title="No overview yet" actions={[{ ...action, copied: null }]} />)),
  ).toEqual({ shown: ['Copy prompt'], heard: '' });
  expect(
    said(draw(<EmptyState title="No overview yet" actions={[{ ...action, copied: 'copied' }]} />)),
  ).toEqual({ shown: ['Copied'], heard: 'Copied' });
  expect(
    said(draw(<EmptyState title="No overview yet" actions={[{ ...action, copied: 'failed' }]} />)),
  ).toEqual({ shown: ['Couldn’t copy'], heard: 'Couldn’t copy' });
});
