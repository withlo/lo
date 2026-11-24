// @vitest-environment jsdom

import { afterEach, expect, test } from 'vitest';

import { testCommands, type Ran } from '../../test/commands.ts';
import { controlOf, heldRegistry, holdRegistry, runControl } from './control.ts';
import { listen } from './listener.ts';
import { Registry } from './registry.ts';
import type { LineTarget } from './targets.ts';

const LINE: LineTarget = { kind: 'line', at: { file: 'a.ts', side: 'new', line: 3 } };

let release: (() => void) | undefined;
afterEach(() => {
  release?.();
  release = undefined;
});

function held(): { registry: Registry; ran: Ran[]; refused: string[] } {
  const ran: Ran[] = [];
  const refused: string[] = [];
  const registry = new Registry({
    system: 'mac',
    commands: testCommands(ran),
    onRefused: (reason) => refused.push(reason),
  });
  release = holdRegistry(registry);
  return { registry, ran, refused };
}

test('a control shows its command’s label and its key as they are now', () => {
  const { registry } = held();
  expect(controlOf('diff.comment', LINE)).toEqual({
    id: 'diff.comment',
    label: 'Comment',
    keys: ['c'],
    shortcut: 'c',
    off: undefined,
  });
  registry.setKeymap('bind C diff.comment');
  expect(controlOf('diff.comment', LINE)?.keys).toEqual(['C']);
  expect(controlOf('diff.nothing', LINE)).toBeUndefined();
});

test('it runs its command on its target, as the key does, and says why where it can’t', () => {
  const { ran, refused } = held();
  expect(runControl('diff.comment', LINE)).toBe(true);
  expect(ran).toEqual([['diff.comment', LINE]]);
  // On nothing, a command that needs a line says so, and the registry reports it as a key's.
  expect(controlOf('diff.comment')?.off).toBe('Comment doesn’t apply here.');
  expect(runControl('diff.comment')).toBe('Comment doesn’t apply here.');
  expect(refused).toEqual(['Comment doesn’t apply here.']);
});

test('the registry the window’s keys go through is the one its controls run through', () => {
  expect(heldRegistry()).toBeUndefined();
  expect(controlOf('diff.comment', LINE)).toBeUndefined();
  const registry = new Registry({ system: 'mac', commands: testCommands() });
  const stop = listen(window, registry);
  expect(heldRegistry()).toBe(registry);
  stop();
  expect(heldRegistry()).toBeUndefined();
});
