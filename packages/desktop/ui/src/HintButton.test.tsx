// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, onTestFinished, test } from 'vitest';

import { testCommands, type Ran } from '../test/commands.ts';
import { holdRegistry } from './commands/control.ts';
import { Registry } from './commands/registry.ts';
import type { LineTarget } from './commands/targets.ts';
import { HintButton } from './HintButton.tsx';
import { MoreButton } from './MoreButton.tsx';
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

function held(): { registry: Registry; ran: Ran[] } {
  const ran: Ran[] = [];
  const registry = new Registry({ system: 'mac', commands: testCommands(ran) });
  release = holdRegistry(registry);
  return { registry, ran };
}

test('a hint is a button: its command’s label, then its key, and a click runs the command', () => {
  const { registry, ran } = held();
  const host = draw(<HintButton command="diff.comment" target={LINE} />);
  const button = host.querySelector('button')!;
  expect(button.textContent).toBe('Commentc');
  expect(button.lastElementChild?.tagName).toBe('KBD');
  expect(button.getAttribute('aria-keyshortcuts')).toBe('c');
  act(() => button.click());
  expect(ran).toEqual([['diff.comment', LINE]]);
  // The keymap file moves its key, and the hint follows.
  act(() => void registry.setKeymap('bind C diff.comment'));
  expect(button.querySelector('kbd')?.textContent).toBe('C');
});

test('a hint whose command can’t run is dimmed, says why, and runs nothing', () => {
  const { ran } = held();
  const host = draw(<HintButton command="diff.comment">Comment on the line</HintButton>);
  const button = host.querySelector('button')!;
  expect(button.textContent).toBe('Comment on the linec');
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(document.getElementById(button.getAttribute('aria-describedby')!)?.textContent).toBe(
    "Comment doesn't apply here.",
  );
  act(() => button.click());
  expect(ran).toEqual([]);
  expect(draw(<HintButton command="diff.nothing" />).querySelector('button')).toBeNull();
});

test('the more button opens its surface’s right-click menu under itself', () => {
  const heard: [number, number][] = [];
  const host = draw(
    <div onContextMenu={(event) => heard.push([event.clientX, event.clientY])}>
      <MoreButton />
    </div>,
  );
  const button = host.querySelector('button')!;
  expect(button.getAttribute('aria-label')).toBe('More actions');
  expect(button.getAttribute('aria-haspopup')).toBe('menu');
  button.getBoundingClientRect = () => new DOMRect(40, 10, 22, 22);
  act(() => button.click());
  expect(heard).toEqual([[40, 32]]);
});
