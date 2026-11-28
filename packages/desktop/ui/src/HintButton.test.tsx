// @vitest-environment jsdom

import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, onTestFinished, test, vi } from 'vitest';

import { testCommands, type Ran } from '../test/commands.ts';
import { tipOf } from '../test/dom.ts';
import { CommandButton } from './CommandButton.tsx';
import { holdRegistry } from './commands/control.ts';
import { defineCommands, handlers } from './commands/declare.ts';
import { Registry } from './commands/registry.ts';
import type { LineTarget } from './commands/targets.ts';
import { HintButton } from './HintButton.tsx';
import { HintRow } from './HintRow.tsx';
import { menuOpener, MoreButton } from './MoreButton.tsx';
import { TOOLTIP_DELAY, TooltipGroup } from './Tooltip.tsx';
import { useControl } from './useControl.ts';

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
    'Comment doesn’t apply here.',
  );
  act(() => button.click());
  expect(ran).toEqual([]);
  expect(draw(<HintButton command="diff.nothing" />).querySelector('button')).toBeNull();
});

test('a hint whose command has nothing to say is dimmed with no tooltip, and follows the history', () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  const declarations = defineCommands('go', {
    back: { label: 'Back', group: 'Code', keys: ['ctrl+o'] },
  });
  const registry: Registry = new Registry({
    system: 'mac',
    commands: handlers(declarations, {
      back: { run() {}, enabled: () => registry.history.canBack() || '' },
    }),
  });
  release = holdRegistry(registry);
  const host = draw(<HintButton command="go.back" />);
  const button = host.querySelector('button')!;
  expect(button.getAttribute('aria-disabled')).toBe('true');
  expect(button.hasAttribute('aria-describedby')).toBe(false);
  act(() => {
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: host }));
    button.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: host }));
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    vi.advanceTimersByTime(TOOLTIP_DELAY);
  });
  expect(host.querySelector('.tooltip')).toBeNull();
  // Somewhere to go back to, and it's drawn again, ready.
  act(() => {
    registry.history.register('', 'diff', () => true);
    registry.history.record({ view: 'diff', at: { kind: 'none' } });
  });
  expect(button.hasAttribute('aria-disabled')).toBe(false);
});

/** The tooltip of the button `node` draws, once the pointer rests on it. */
function tipOn(node: ReactNode): string | undefined {
  return tipOf(draw(node).querySelector('button')!);
}

test('a command’s button has a tooltip only where it says more than the button does', () => {
  const declarations = defineCommands('app', {
    add: { label: 'Add', group: 'App', keys: [] },
    open: { label: 'Open the file', group: 'App', keys: ['cmd+o'] },
  });
  let can: true | string = true;
  const registry = new Registry({
    system: 'mac',
    commands: handlers(declarations, {
      add: { run() {}, enabled: () => can },
      open: { run() {} },
    }),
  });
  release = holdRegistry(registry);
  // Its words are its label, and it has no key: the tooltip would only say them again.
  expect(tipOn(<CommandButton command="app.add" />)).toBeUndefined();
  expect(tipOn(<CommandButton command="app.add">Add</CommandButton>)).toBeUndefined();
  // A key, shorter words, or words of its own, it gives in its tooltip.
  expect(tipOn(<CommandButton command="app.open" />)).toBe('Open the file⌘O');
  expect(tipOn(<CommandButton command="app.add">+</CommandButton>)).toBe('Add');
  expect(tipOn(<CommandButton command="app.add" hint="Add another" />)).toBe('Add another');
  // Why it can't run, always.
  can = 'Offline';
  expect(tipOn(<CommandButton command="app.add" />)).toBe('Offline');
});

test('a control is drawn again only when what it shows changes, not at each step of the history', () => {
  const { registry } = held();
  let draws = 0;
  function Counted() {
    draws += 1;
    return <span>{useControl('diff.comment', LINE)?.label}</span>;
  }
  draw(<Counted />);
  const before = draws;
  act(() => {
    registry.history.register('', 'diff', () => true);
    registry.history.record({ view: 'diff', at: { kind: 'none' } });
  });
  expect(draws).toBe(before);
  act(() => void registry.setKeymap('bind C diff.comment'));
  expect(draws).toBe(before + 1);
});

/** The row the HintRow test measures. */
function measured(element: HTMLElement): boolean {
  return element.hasAttribute('data-lo-hints');
}

test('a row of hints too narrow for their key chips gives them up, and gives each key in its hint’s tooltip', async () => {
  const { registry } = held();
  // The row is 200 px wide, and its hint takes 260 with its chip, 180 without.
  const room = { row: 200, chips: 260 };
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get(this: HTMLElement) {
      return measured(this) ? room.row : 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (!measured(this)) return 0;
      return this.hasAttribute('data-gave-up') ? 180 : room.chips;
    },
  });
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
    delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
    delete (HTMLElement.prototype as { scrollWidth?: number }).scrollWidth;
  });
  const host = draw(
    <HintRow data-lo-hints="">
      <HintButton command="diff.comment" target={LINE} />
    </HintRow>,
  );
  const row = host.querySelector<HTMLElement>('[data-lo-hints]')!;
  const button = row.querySelector('button')!;
  expect(row.getAttribute('data-gave-up')).toBe('keys');
  // The chip is still there for the stylesheet to hide, and the key is still the button's.
  expect(button.querySelector('kbd')?.textContent).toBe('c');
  expect(button.getAttribute('aria-keyshortcuts')).toBe('c');
  // The pointer resting on it brings its name and its key.
  act(() => {
    button.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, relatedTarget: host }));
    button.dispatchEvent(new MouseEvent('mouseenter', { relatedTarget: host }));
    button.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    vi.advanceTimersByTime(TOOLTIP_DELAY);
  });
  expect(host.querySelector('.tooltip')?.textContent).toBe('Commentc');
  // Where its chip fits, as once the keymap gives it a shorter key, the chip is back.
  room.chips = 190;
  // The row hears the change as its mutations are told, after the change.
  await act(() => {
    registry.setKeymap('bind C diff.comment');
    return Promise.resolve();
  });
  expect(row.hasAttribute('data-gave-up')).toBe(false);
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

test('the more button is the menu’s opener while its surface hears it, and no longer', () => {
  const openers: (Element | undefined)[] = [];
  const host = draw(
    <div onContextMenu={() => openers.push(menuOpener())}>
      <MoreButton />
    </div>,
  );
  const button = host.querySelector('button')!;
  act(() => button.click());
  expect(openers).toEqual([button]);
  expect(menuOpener()).toBeUndefined();
});

test('a shy more button keeps its room and its place in `Tab`’s order', () => {
  const host = draw(<MoreButton shy />);
  const button = host.querySelector('button')!;
  // Hidden by the stylesheet's `shy`, which a scope's hover, keyboard or focus shows: never taken
  // out of the page or out of reach.
  expect(button.parentElement?.classList.contains('shy')).toBe(true);
  expect(button.tabIndex).toBe(0);
  expect(button.closest('[hidden], [inert], [aria-hidden="true"]')).toBeNull();
});
