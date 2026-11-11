import { defineCommands, handlers, Registry, type Target } from '@lo/ui/commands';
import { describe, expect, it } from 'vitest';

import { barItems, runFromBar } from './bar.ts';
import { systemOf } from './registry.ts';

const declarations = defineCommands('view', {
  inline: {
    label: 'Inline or side by side',
    group: 'Diff view',
    keys: ['g i'],
    bar: { menu: 'View', order: 10 },
  },
  threads: {
    label: 'Threads panel',
    group: 'Panels',
    keys: ['cmd+shift+\\'],
    targets: ['file'],
    bar: { menu: 'View', order: 20 },
  },
  hidden: { label: 'Not in a menu', group: 'View', keys: ['cmd+k'] },
});
const commands = handlers(declarations, {
  inline: { run() {} },
  threads: { run() {} },
  hidden: { run() {} },
});

describe('the app menu’s items', () => {
  const none: Target = { kind: 'none' };

  it('list the commands that declare a menu, with a key only when it’s a single chord', () => {
    const registry = new Registry({ system: 'mac', commands });
    expect(barItems(registry, { kind: 'file', file: 'a.ts' })).toEqual([
      {
        id: 'view.inline',
        label: 'Inline or side by side',
        menu: 'View',
        order: 10,
        enabled: true,
      },
      {
        id: 'view.threads',
        label: 'Threads panel',
        menu: 'View',
        order: 20,
        key: { key: '\\', meta: true, ctrl: false, alt: false, shift: true },
        enabled: true,
      },
    ]);
  });

  it('say whether each can run on what has focus', () => {
    const registry = new Registry({ system: 'mac', commands });
    expect(barItems(registry, none).map((item) => item.enabled)).toEqual([true, false]);
  });

  it('show the keys the keymap gives, in the system’s keys', () => {
    const registry = new Registry({ system: 'linux', commands });
    registry.setKeymap('bind ctrl+alt+t view.threads\nunbind cmd+shift+\\');
    expect(barItems(registry, none)[1]?.key).toEqual({
      key: 't',
      meta: false,
      ctrl: true,
      alt: true,
      shift: false,
    });
  });
});

describe('a click in the app menu', () => {
  it('runs only a command the menu lists', () => {
    const ran: string[] = [];
    const registry = new Registry({
      system: 'mac',
      commands: handlers(declarations, {
        inline: { run: () => void ran.push('inline') },
        threads: { run: () => void ran.push('threads') },
        hidden: { run: () => void ran.push('hidden') },
      }),
    });
    expect(runFromBar(registry, 'view.inline', { kind: 'none' })).toBe(true);
    expect(runFromBar(registry, 'view.hidden', { kind: 'none' })).toBe(
      "view.hidden isn't in the app menu.",
    );
    expect(runFromBar(registry, 'view.missing', { kind: 'none' })).toBe(
      "view.missing isn't in the app menu.",
    );
    // Still only where it can run.
    expect(runFromBar(registry, 'view.threads', { kind: 'none' })).toBe(
      "Threads panel doesn't apply here.",
    );
    expect(ran).toEqual(['inline']);
  });
});

it('tells the system from the browser’s platform', () => {
  expect(systemOf('MacIntel')).toBe('mac');
  expect(systemOf('Linux x86_64')).toBe('linux');
});
