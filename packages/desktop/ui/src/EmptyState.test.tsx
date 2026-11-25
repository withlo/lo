// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

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

test('an empty state is an icon, its title, one line and its commands as buttons with keys', () => {
  const ran = held();
  const host = draw(
    <EmptyState
      icon="message-square"
      title="No comments yet"
      line="Comments on this line are listed here."
      actions={[{ command: 'diff.comment', target: LINE, label: 'Add comment' }]}
    />,
  );
  // The icon is the title's, so a screen reader hears the words alone. The title is no heading.
  expect(host.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(host.querySelector('h1, h2, h3, h4, [role="heading"]')).toBeNull();
  expect([...host.querySelectorAll('p')].map((each) => each.textContent)).toEqual([
    'No comments yet',
    'Comments on this line are listed here.',
  ]);
  const button = host.querySelector('button')!;
  expect(button.textContent).toBe('Add commentc');
  expect(button.getAttribute('aria-keyshortcuts')).toBe('c');
  act(() => button.click());
  expect(ran).toEqual([['diff.comment', LINE]]);
});

test('a button whose command can’t run is dimmed, says why, and runs nothing', () => {
  const ran = held();
  const host = draw(
    <EmptyState icon="message-square" title="No comments yet" actions={['diff.comment']} />,
  );
  expect(host.querySelectorAll('p')).toHaveLength(1);
  const button = host.querySelector('button')!;
  // With no label of its own, it takes the command's.
  expect(button.textContent).toBe('Commentc');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
    'Comment doesn’t apply here.',
  );
  act(() => button.click());
  expect(ran).toEqual([]);
});

test('with no commands, or one the registry doesn’t have, it draws no button', () => {
  held();
  expect(
    draw(<EmptyState icon="search-x" title="No matches" />).querySelector('button'),
  ).toBeNull();
  expect(
    draw(
      <EmptyState icon="search-x" title="No matches" actions={['diff.nothing']} />,
    ).querySelector('button'),
  ).toBeNull();
});

test('what its actions act on sits between its line and its buttons', () => {
  held();
  const host = draw(
    <EmptyState
      icon="file-text"
      title="No overview yet"
      line="One line."
      actions={['diff.comment']}
    >
      <pre>The prompt</pre>
    </EmptyState>,
  );
  const order = [...host.querySelectorAll('p, pre, button')].map((element) => element.localName);
  expect(order).toEqual(['p', 'p', 'pre', 'button']);
});

test('a button busy with what it started says what it’s doing, and runs nothing more', () => {
  const ran = held();
  const action = { command: 'diff.comment', target: LINE, label: 'Check again' } as const;
  const resting = draw(
    <EmptyState
      icon="file-text"
      title="No overview yet"
      actions={[{ ...action, busy: false, working: 'Checking…' }]}
    />,
  ).querySelector('button')!;
  expect(resting.getAttribute('aria-busy')).toBeNull();
  // Both faces are drawn, one hidden, so it's as wide busy as at rest.
  expect(resting.textContent).toBe('Check againcChecking…');
  const busy = draw(
    <EmptyState
      icon="file-text"
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
    said(
      draw(
        <EmptyState
          icon="file-text"
          title="No overview yet"
          actions={[{ ...action, copied: null }]}
        />,
      ),
    ),
  ).toEqual({ shown: ['Copy prompt'], heard: '' });
  expect(
    said(
      draw(
        <EmptyState
          icon="file-text"
          title="No overview yet"
          actions={[{ ...action, copied: 'copied' }]}
        />,
      ),
    ),
  ).toEqual({ shown: ['Copied'], heard: 'Copied' });
  expect(
    said(
      draw(
        <EmptyState
          icon="file-text"
          title="No overview yet"
          actions={[{ ...action, copied: 'failed' }]}
        />,
      ),
    ),
  ).toEqual({ shown: ['Couldn’t copy'], heard: 'Couldn’t copy' });
});

/** The size of `host`'s icon, by its class, and each button's look and size. */
function shape(host: HTMLElement) {
  return {
    icon: host.querySelector('svg')?.getAttribute('class'),
    buttons: [...host.querySelectorAll('button')].map((button) => ({
      primary: button.className.includes('bg-accent'),
      small: button.className.includes('h-control-h-sm'),
    })),
  };
}

test('in a view the icon is 24 px and the first button the main one; in a panel all are small', () => {
  held();
  const actions = ['diff.comment', { command: 'diff.comment', target: LINE }] as const;
  expect(
    shape(draw(<EmptyState icon="file-diff" title="No files changed" actions={actions} />)),
  ).toEqual({
    icon: 'lo-i lo-i--lg text-icon-muted',
    buttons: [
      { primary: true, small: false },
      { primary: false, small: false },
    ],
  });
  expect(
    shape(
      draw(<EmptyState fit="panel" icon="file-diff" title="No files changed" actions={actions} />),
    ),
  ).toEqual({
    icon: 'lo-i lo-i--lg text-icon-muted',
    buttons: [
      { primary: false, small: true },
      { primary: false, small: true },
    ],
  });
});

test('in a list the icon is 16 px beside its words, and its buttons are small', () => {
  held();
  const host = draw(
    <EmptyState
      fit="list"
      icon="user-round"
      title="No accounts"
      line="Public pull requests open without one."
      actions={[{ command: 'diff.comment', target: LINE }]}
    />,
  );
  expect(shape(host)).toEqual({
    icon: 'lo-i text-icon-muted',
    buttons: [{ primary: false, small: true }],
  });
  expect(host.textContent).toBe('No accountsPublic pull requests open without one.Commentc');
});

test('a row is a 14 px icon and its title alone, which nothing focuses or selects', () => {
  held();
  const host = draw(<EmptyState fit="row" icon="search-x" title="No commands match “zzzz”" />);
  expect(shape(host)).toEqual({ icon: 'lo-i lo-i--sm text-icon-muted', buttons: [] });
  expect(host.textContent).toBe('No commands match “zzzz”');
  expect(host.querySelector('[tabindex], [role="option"]')).toBeNull();
});

test('a button with focus that goes as its box drops under 160 px leaves focus on the box', async () => {
  held();
  // jsdom lays nothing out: the box is as wide as `width` says, and resized when told.
  let width = 400;
  let resized: (() => void) | undefined;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    },
  );
  const measured = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(() => new DOMRect(0, 0, width, 360));
  onTestFinished(() => {
    measured.mockRestore();
    vi.unstubAllGlobals();
  });
  const host = draw(
    <div data-lo-scope="threads">
      <EmptyState
        fit="panel"
        icon="message-square"
        title="No threads yet"
        actions={[{ command: 'diff.comment', target: LINE }]}
      />
    </div>,
  );
  host.querySelector('button')!.focus();
  width = 120;
  await act(async () => resized?.());
  const box = host.querySelector<HTMLElement>('[data-lo-empty]')!;
  expect(host.querySelector('button')).toBeNull();
  expect(document.activeElement).toBe(box);
  // The reader didn't put it there, so it draws no ring, and it's no stop for Tab once it goes.
  expect(box.hasAttribute('data-lo-caught')).toBe(true);
  act(() => box.blur());
  expect(box.hasAttribute('tabindex')).toBe(false);
});
